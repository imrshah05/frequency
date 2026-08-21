import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Keyboard,
  Pressable,
  Animated,
  Easing,
  Dimensions,
} from 'react-native';
import BackButton from '@/components/BackButton';
import Touchable from '@/components/Touchable';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system/legacy';
import { decode as atob } from 'base-64';
import { supabase } from '@/lib/supabase';
import {
  createResonance,
  formatBlendNames,
  formatBlendSummary,
  formatResonanceDate,
  getLocalDateString,
} from '@/lib/resonance';
import { downsampleWaveform, meteringToAmplitude } from '@/lib/waveform';
import { error as hapticError, selection, success } from '@/lib/haptics';
import {
  FrequencyColors as C,
  FrequencyRadius as R,
  FrequencySpacing as S,
} from '@/constants/frequencyTheme';
import {
  ResonanceEmotions,
  type ResonanceEmotion,
  type ResonanceEmotionBlend,
  type ResonanceEmotionCategory,
} from '@/constants/resonanceEmotions';
import EmotionPill from '@/components/EmotionPill';
import FrequencyWaveform from '@/components/FrequencyWaveform';
import ResonanceAura from '@/components/ResonanceAura';
import ResonanceOrb from '@/components/ResonanceOrb';
import SegmentedControl, { type SegmentOption } from '@/components/SegmentedControl';

const ORB_SIZE = 128;
// Matches the non-ripple wrapper ResonanceOrb reserves around the sphere, so
// the aura can be centred on the orb rather than on the stage.
const ORB_STAGE_SIZE = ORB_SIZE * 1.2;
const AURA_SIZE = Math.min(Dimensions.get('window').width * 1.6, 560);

const CATEGORY_OPTIONS: [
  SegmentOption<ResonanceEmotionCategory>,
  SegmentOption<ResonanceEmotionCategory>,
] = [
  { key: 'positive', label: 'Positive' },
  { key: 'negative', label: 'Negative' },
];

const MIN_RECORDING_MS = 1000;
const STICKY_NOTE_MAX_LENGTH = 240;
const BLEND_TAP_BUMP = 1;
const RECORD_START_THRESHOLD_MS = 150;
const RECORD_BUTTON_IDLE_SCALE = 1;
const RECORD_BUTTON_TOUCH_SCALE = 0.94;
const RECORD_BUTTON_ACTIVE_SCALE = 1.045;

type Step = 'blend' | 'record' | 'saved';
type BlendWeight = { emotion: ResonanceEmotion; weight: number };

function playHaptic(label: string, trigger: () => Promise<void>) {
  void trigger().catch((error) => {
    console.warn(`[Record Resonance] ${label} haptic failed`, error);
  });
}

function emotionInfo(emotion: ResonanceEmotion) {
  return ResonanceEmotions.find((option) => option.key === emotion);
}

// Distributes 100 points across weights proportionally, rounding to whole
// percentages while keeping the total exactly 100 (any rounding remainder
// goes to the entries with the largest fractional part).
function normalizeBlendWeights(weights: BlendWeight[]): ResonanceEmotionBlend[] {
  const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
  if (totalWeight === 0) return [];

  const floored = weights.map((w) => {
    const exact = (w.weight / totalWeight) * 100;
    return { emotion: w.emotion, percentage: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });

  const deficit = 100 - floored.reduce((sum, f) => sum + f.percentage, 0);
  const byRemainderDesc = [...floored].sort((a, b) => b.remainder - a.remainder);

  for (let i = 0; i < deficit; i++) {
    byRemainderDesc[i % byRemainderDesc.length].percentage += 1;
  }

  return floored.map((f) => ({ emotion: f.emotion, percentage: f.percentage }));
}

function base64ToArrayBuffer(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}

export default function ResonanceScreen() {
  const [step, setStep] = useState<Step>('blend');
  const [category, setCategory] = useState<ResonanceEmotionCategory>('positive');
  const [blendWeights, setBlendWeights] = useState<BlendWeight[]>([]);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [waveform, setWaveform] = useState<number[] | null>(null);
  const [stickyNote, setStickyNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [resultPlaying, setResultPlaying] = useState(false);
  const [resultProgress, setResultProgress] = useState(0);
  const [recordingHint, setRecordingHint] = useState<string | null>(null);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const recordingStartedAtRef = useRef(0);
  const waveformSamplesRef = useRef<number[]>([]);
  const resultSoundRef = useRef<Audio.Sound | null>(null);
  const resultDurationMillisRef = useRef<number | null>(null);
  const resultSeekingRef = useRef(false);
  const resultPendingSeekRef = useRef<number | null>(null);
  const isStartingRecordingRef = useRef(false);
  const pendingStopRef = useRef(false);
  const isPressingRecordRef = useRef(false);
  const liveHapticFiredRef = useRef(false);
  const recordStartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waveformBreath = useRef(new Animated.Value(0)).current;
  const controlsPresence = useRef(new Animated.Value(1)).current;
  const continueReveal = useRef(new Animated.Value(0)).current;
  const recordButtonScale = useRef(new Animated.Value(1)).current;
  const recordRingPulse = useRef(new Animated.Value(0)).current;

  const blend = useMemo(() => normalizeBlendWeights(blendWeights), [blendWeights]);
  const recordingActive = !!recording;
  const visualState = recordingActive ? 'recording' : recordedUri ? 'ready' : 'idle';
  const hasBlend = blend.length > 0;

  // Resonance is a once-a-day ritual, so the question meets you where the day
  // actually is instead of always asking the same thing.
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'How are you\nthis morning?';
    if (hour < 17) return 'How are you\nthis afternoon?';
    if (hour < 22) return 'How are you\nthis evening?';
    return 'How are you\ntonight?';
  }, []);

  // Nothing to continue to until an emotion is picked, so the button arrives
  // instead of sitting there greyed out.
  useEffect(() => {
    Animated.timing(continueReveal, {
      toValue: hasBlend ? 1 : 0,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [continueReveal, hasBlend]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;

    if (recordingActive) {
      timer = setInterval(() => setSeconds((prev) => prev + 1), 1000);
    }

    return () => clearInterval(timer);
  }, [recordingActive]);

  useEffect(() => {
    return () => {
      recordingRef.current?.stopAndUnloadAsync().catch(() => {});
      resultSoundRef.current?.unloadAsync().catch(() => {});
      if (recordStartTimeoutRef.current) {
        clearTimeout(recordStartTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (step !== 'record' || !recordingActive) {
      waveformBreath.stopAnimation();
      Animated.timing(waveformBreath, {
        toValue: 0,
        duration: 260,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(waveformBreath, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(waveformBreath, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    animation.start();

    return () => animation.stop();
  }, [recordingActive, step, waveformBreath]);

  useEffect(() => {
    controlsPresence.setValue(0.92);
    Animated.spring(controlsPresence, {
      toValue: 1,
      damping: 18,
      stiffness: 130,
      mass: 0.7,
      useNativeDriver: true,
    }).start();
  }, [controlsPresence, visualState]);

  useEffect(() => {
    if (!recordingActive) {
      recordRingPulse.stopAnimation();
      Animated.timing(recordRingPulse, {
        toValue: 0,
        duration: 260,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(recordRingPulse, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(recordRingPulse, {
          toValue: 0,
          duration: 1200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    animation.start();

    return () => animation.stop();
  }, [recordRingPulse, recordingActive]);

  function formatTime(totalSeconds: number) {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function tapEmotion(emotion: ResonanceEmotion) {
    void selection();

    setBlendWeights((current) => {
      const existingIndex = current.findIndex((w) => w.emotion === emotion);

      if (existingIndex >= 0) {
        return current.map((w, index) =>
          index === existingIndex ? { ...w, weight: w.weight + BLEND_TAP_BUMP } : w
        );
      }

      return [...current, { emotion, weight: 1 }];
    });
  }

  function removeEmotion(emotion: ResonanceEmotion) {
    void selection();
    setBlendWeights((current) => current.filter((w) => w.emotion !== emotion));
  }

  function goToRecordStep() {
    if (blend.length === 0) return;
    void selection();
    setStep('record');
  }

  function fireLiveRecordingHaptic() {
    if (liveHapticFiredRef.current) return;
    liveHapticFiredRef.current = true;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }

  function playRecordingEndHaptic() {
    playHaptic('finish', () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
  }

  function playDiscardedRecordingHaptic() {
    playHaptic('discard', () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
  }

  function animateRecordButtonScale(toValue: number) {
    Animated.spring(recordButtonScale, {
      toValue,
      damping: 18,
      stiffness: 190,
      mass: 0.7,
      useNativeDriver: true,
    }).start();
  }

  async function cancelReleasedStart(recordingToDiscard?: Audio.Recording) {
    pendingStopRef.current = false;
    recordingRef.current = null;
    setRecording(null);
    animateRecordButtonScale(RECORD_BUTTON_IDLE_SCALE);

    if (recordingToDiscard) {
      try {
        await recordingToDiscard.stopAndUnloadAsync();
      } catch {
        // Best effort cleanup for a start that was released before it finished.
      }
    }
  }

  async function stopResultSound() {
    try {
      if (resultSoundRef.current) {
        await resultSoundRef.current.stopAsync();
        await resultSoundRef.current.unloadAsync();
      }
    } catch {
      // Best effort cleanup before swapping sounds.
    }

    resultSoundRef.current = null;
    resultDurationMillisRef.current = null;
    resultSeekingRef.current = false;
    resultPendingSeekRef.current = null;
    setResultPlaying(false);
    setResultProgress(0);
  }

  async function startRecording() {
    try {
      if (recordingRef.current || isStartingRecordingRef.current || saving) {
        return false;
      }

      isStartingRecordingRef.current = true;
      pendingStopRef.current = false;
      liveHapticFiredRef.current = false;
      await stopResultSound();
      setSeconds(0);
      setRecordedUri(null);
      setWaveform(null);
      setRecordingHint(null);

      const permission = await Audio.requestPermissionsAsync();

      if (!permission.granted) {
        void hapticError();
        animateRecordButtonScale(RECORD_BUTTON_IDLE_SCALE);
        Alert.alert('Permission needed', 'Please allow microphone access.');
        return false;
      }

      if (!isPressingRecordRef.current && !recordedUri) {
        await cancelReleasedStart();
        return false;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      if (!isPressingRecordRef.current && !recordedUri) {
        await cancelReleasedStart();
        return false;
      }

      const newRecording = new Audio.Recording();
      waveformSamplesRef.current = [];

      await newRecording.prepareToRecordAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      if (!isPressingRecordRef.current && !recordedUri) {
        await cancelReleasedStart();
        return false;
      }

      newRecording.setProgressUpdateInterval(90);
      newRecording.setOnRecordingStatusUpdate((status) => {
        const metering = (status as Audio.RecordingStatus & { metering?: number })
          .metering;

        if (typeof metering === 'number') {
          waveformSamplesRef.current.push(meteringToAmplitude(metering));
        }
      });

      await newRecording.startAsync();

      if (!isPressingRecordRef.current && !recordedUri) {
        await cancelReleasedStart(newRecording);
        return false;
      }

      recordingStartedAtRef.current = Date.now();
      recordingRef.current = newRecording;
      setRecording(newRecording);
      fireLiveRecordingHaptic();
      animateRecordButtonScale(RECORD_BUTTON_ACTIVE_SCALE);

      if (pendingStopRef.current) {
        pendingStopRef.current = false;
        await stopRecording({ discardIfTooShort: true });
      }

      return true;
    } catch (error: any) {
      recordingRef.current = null;
      pendingStopRef.current = false;
      liveHapticFiredRef.current = false;
      animateRecordButtonScale(RECORD_BUTTON_IDLE_SCALE);
      void hapticError();
      Alert.alert('Recording Error', error.message);
      return false;
    } finally {
      isStartingRecordingRef.current = false;
    }
  }

  async function stopRecording(options: { discardIfTooShort?: boolean } = {}) {
    try {
      const activeRecording = recordingRef.current;

      if (!activeRecording) {
        if (isStartingRecordingRef.current) {
          pendingStopRef.current = true;
        }
        return;
      }

      recordingRef.current = null;
      pendingStopRef.current = false;
      const recordedForMs = Date.now() - recordingStartedAtRef.current;
      const shouldDiscard =
        options.discardIfTooShort === true && recordedForMs < MIN_RECORDING_MS;

      try {
        await activeRecording.stopAndUnloadAsync();
      } catch (error) {
        if (shouldDiscard) {
          setRecording(null);
          setRecordedUri(null);
          setWaveform(null);
          setSeconds(0);
          waveformSamplesRef.current = [];
          setRecordingHint('Hold a little longer to record a Resonance.');
          animateRecordButtonScale(RECORD_BUTTON_IDLE_SCALE);
          playDiscardedRecordingHaptic();
          liveHapticFiredRef.current = false;
          return;
        }

        throw error;
      }

      const uri = activeRecording.getURI();
      const generatedWaveform = downsampleWaveform(waveformSamplesRef.current);

      setRecording(null);
      animateRecordButtonScale(RECORD_BUTTON_IDLE_SCALE);

      if (shouldDiscard) {
        setRecordedUri(null);
        setWaveform(null);
        setSeconds(0);
        waveformSamplesRef.current = [];
        setRecordingHint('Hold a little longer to record a Resonance.');
        playDiscardedRecordingHaptic();
        liveHapticFiredRef.current = false;
        return;
      }

      setRecordedUri(uri);
      setWaveform(generatedWaveform);
      setRecordingHint(null);
      playRecordingEndHaptic();
      liveHapticFiredRef.current = false;
    } catch (error: any) {
      setRecording(null);
      liveHapticFiredRef.current = false;
      animateRecordButtonScale(RECORD_BUTTON_IDLE_SCALE);
      void hapticError();
      Alert.alert('Stop Error', error.message);
    }
  }

  function handleRecordPressIn() {
    if (recordedUri || saving) return;
    if (
      isPressingRecordRef.current ||
      recordingRef.current ||
      isStartingRecordingRef.current
    ) {
      return;
    }

    isPressingRecordRef.current = true;
    pendingStopRef.current = false;
    liveHapticFiredRef.current = false;
    animateRecordButtonScale(RECORD_BUTTON_TOUCH_SCALE);

    recordStartTimeoutRef.current = setTimeout(() => {
      recordStartTimeoutRef.current = null;

      if (!isPressingRecordRef.current) return;
      void startRecording();
    }, RECORD_START_THRESHOLD_MS);
  }

  function handleRecordPressOut() {
    if (recordedUri || saving) return;

    isPressingRecordRef.current = false;

    if (recordStartTimeoutRef.current) {
      clearTimeout(recordStartTimeoutRef.current);
      recordStartTimeoutRef.current = null;
      pendingStopRef.current = false;
      animateRecordButtonScale(RECORD_BUTTON_IDLE_SCALE);
      return;
    }

    animateRecordButtonScale(RECORD_BUTTON_IDLE_SCALE);
    void stopRecording({ discardIfTooShort: true });
  }

  async function saveResonance() {
    try {
      if (blend.length === 0 || !recordedUri) return;

      setSaving(true);

      const { data: userData, error: userError } = await supabase.auth.getUser();

      if (userError || !userData.user) {
        void hapticError();
        Alert.alert('Login needed', 'Please log in again.');
        setSaving(false);
        return;
      }

      const userId = userData.user.id;
      const base64Audio = await FileSystem.readAsStringAsync(recordedUri, {
        encoding: 'base64',
      } as any);
      const audioBuffer = base64ToArrayBuffer(base64Audio);
      const audioPath = `${userId}/${Date.now()}.m4a`;

      const { error: uploadError } = await supabase.storage
        .from('resonance-audio')
        .upload(audioPath, audioBuffer, {
          contentType: 'audio/mp4',
          upsert: false,
        });

      if (uploadError) {
        void hapticError();
        Alert.alert('Upload Error', uploadError.message);
        setSaving(false);
        return;
      }

      await createResonance({
        userId,
        emotions: blend,
        audioPath,
        waveform,
        stickyNote: stickyNote.trim() || null,
      });

      void success();
      setSaving(false);
      setStep('saved');
    } catch (error: any) {
      setSaving(false);
      void hapticError();
      Alert.alert('Unexpected Error', error.message);
    }
  }

  async function toggleResultPlayback() {
    try {
      if (resultSoundRef.current) {
        if (resultPlaying) {
          await resultSoundRef.current.pauseAsync();
          setResultPlaying(false);
        } else {
          await resultSoundRef.current.playAsync();
          setResultPlaying(true);
        }
        return;
      }

      if (!recordedUri) return;

      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const { sound, status: initialStatus } = await Audio.Sound.createAsync({ uri: recordedUri });
      resultSoundRef.current = sound;
      resultDurationMillisRef.current =
        initialStatus.isLoaded && initialStatus.durationMillis
          ? initialStatus.durationMillis
          : null;
      await sound.setProgressUpdateIntervalAsync(100);

      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) return;

        if (status.durationMillis) {
          resultDurationMillisRef.current = status.durationMillis;
        }

        if (!resultSeekingRef.current) {
          setResultProgress(
            status.durationMillis ? status.positionMillis / status.durationMillis : 0
          );
        }

        if (status.didJustFinish) {
          setResultPlaying(false);
          setResultProgress(0);
        }
      });

      await sound.playAsync();
      setResultPlaying(true);
    } catch (error: any) {
      void hapticError();
      Alert.alert('Playback Error', error.message);
    }
  }

  async function seekResultPlayback(fraction: number) {
    const sound = resultSoundRef.current;
    if (!sound || !resultDurationMillisRef.current) return;

    const clamped = Math.max(0, Math.min(1, fraction));
    setResultProgress(clamped);

    if (resultSeekingRef.current) {
      resultPendingSeekRef.current = clamped;
      return;
    }

    resultSeekingRef.current = true;
    try {
      await sound.setPositionAsync(clamped * resultDurationMillisRef.current);
    } catch {
      // A superseded seek rejects with "Seeking interrupted" — safe to ignore.
    } finally {
      resultSeekingRef.current = false;
      const pending = resultPendingSeekRef.current;
      resultPendingSeekRef.current = null;
      if (pending != null) {
        void seekResultPlayback(pending);
      }
    }
  }

  async function closeResult() {
    await resultSoundRef.current?.unloadAsync().catch(() => {});
    resultSoundRef.current = null;
    router.back();
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        <Pressable onPress={Keyboard.dismiss}>
        {step === 'blend' && (
          <>
            <View style={styles.header}>
              <Text style={styles.eyebrow}>{formatResonanceDate(getLocalDateString())}</Text>
              <Text style={styles.title}>{greeting}</Text>
            </View>

            <View style={styles.previewStage}>
              <ResonanceAura blend={blend} size={AURA_SIZE} style={styles.aura} />
              <ResonanceOrb blend={blend} size={ORB_SIZE} ripple={false} />

              <Text style={styles.previewCaption}>
                {hasBlend ? formatBlendNames(blend) : 'Tap an emotion to begin.'}
              </Text>

              <Text style={styles.previewHint}>
                {hasBlend ? 'Tap again to feel it more.' : 'Tap more than one to blend them.'}
              </Text>
            </View>

            <View style={styles.categorySwitch}>
              <SegmentedControl
                options={CATEGORY_OPTIONS}
                value={category}
                onChange={setCategory}
              />
            </View>

            <View style={styles.pillGrid}>
              {ResonanceEmotions.filter((option) => option.category === category).map((option) => (
                <EmotionPill
                  key={option.key}
                  option={option}
                  percentage={blend.find((entry) => entry.emotion === option.key)?.percentage ?? null}
                  onPress={() => tapEmotion(option.key)}
                  onRemove={() => removeEmotion(option.key)}
                />
              ))}
            </View>

            <Animated.View
              pointerEvents={hasBlend ? 'auto' : 'none'}
              style={{
                opacity: continueReveal,
                transform: [
                  {
                    translateY: continueReveal.interpolate({
                      inputRange: [0, 1],
                      outputRange: [10, 0],
                    }),
                  },
                ],
              }}
            >
              <Touchable
                style={styles.continueButton}
                activeOpacity={0.86}
                disabled={!hasBlend}
                onPress={goToRecordStep}
              >
                <Text style={styles.continueButtonText}>Continue →</Text>
              </Touchable>
            </Animated.View>
          </>
        )}

        {step === 'record' && (
          <>
            <BackButton
              style={styles.backButton}
              onPress={() => setStep('blend')}
              disabled={recordingActive || saving}
            />

            <View style={styles.header}>
              <Text style={styles.title}>Say something about your day.</Text>
              {blend.length > 0 && (
                <View style={styles.moodChip}>
                  <View style={styles.moodChipDots}>
                    {blend.map((entry) => (
                      <View
                        key={entry.emotion}
                        style={[
                          styles.moodChipDot,
                          { backgroundColor: emotionInfo(entry.emotion)?.color },
                        ]}
                      />
                    ))}
                  </View>
                  <Text style={styles.moodChipText}>{formatBlendSummary(blend)}</Text>
                </View>
              )}
            </View>

            <Animated.View
              style={[
                styles.waveformStage,
                {
                  opacity: waveformBreath.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.84, 1],
                  }),
                  transform: [
                    {
                      scaleY: waveformBreath.interpolate({
                        inputRange: [0, 1],
                        outputRange: [1, 1.08],
                      }),
                    },
                  ],
                },
              ]}
            >
              {recordedUri ? (
                <View style={styles.previewRow}>
                  <Touchable
                    style={styles.previewPlayButton}
                    activeOpacity={0.84}
                    onPress={() => {
                      void toggleResultPlayback();
                    }}
                  >
                    <Ionicons
                      name={resultPlaying ? 'pause' : 'play'}
                      size={19}
                      color="#0B100D"
                    />
                  </Touchable>

                  <View style={styles.previewWaveformWrap}>
                    <FrequencyWaveform
                      active
                      progress={resultProgress}
                      waveform={waveform}
                      onSeek={(fraction) => {
                        void seekResultPlayback(fraction);
                      }}
                    />
                  </View>
                </View>
              ) : (
                <FrequencyWaveform active={false} waveform={waveform} />
              )}
            </Animated.View>

            <Text style={styles.timer}>{formatTime(seconds)}</Text>

            <Animated.View
              style={[
                styles.controls,
                {
                  opacity: controlsPresence,
                  transform: [{ scale: controlsPresence }],
                },
              ]}
            >
              {!recordedUri && (
                <View style={styles.recordButtonWrap}>
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.recordOuterRing,
                      recordingActive && styles.recordOuterRingActive,
                      {
                        opacity: recordRingPulse.interpolate({
                          inputRange: [0, 1],
                          outputRange: recordingActive ? [0.62, 0.28] : [0.48, 0.48],
                        }),
                        transform: [
                          {
                            scale: recordRingPulse.interpolate({
                              inputRange: [0, 1],
                              outputRange: recordingActive ? [1, 1.13] : [1, 1],
                            }),
                          },
                        ],
                      },
                    ]}
                  />

                  <Animated.View
                    style={[
                      styles.recordGlow,
                      recordingActive && styles.recordGlowActive,
                      { transform: [{ scale: recordButtonScale }] },
                    ]}
                  >
                    <Pressable
                      style={[
                        styles.recordCircleButton,
                        recordingActive && styles.recordCircleButtonActive,
                      ]}
                      onPressIn={handleRecordPressIn}
                      onPressOut={handleRecordPressOut}
                      disabled={saving}
                    >
                      <Ionicons
                        name={recordingActive ? 'mic' : 'mic-outline'}
                        size={56}
                        color="#0B100D"
                      />
                    </Pressable>
                  </Animated.View>
                </View>
              )}

              {!recordedUri && recordingActive && (
                <Text style={styles.recordingLabel}>Recording...</Text>
              )}

              {!recordedUri && (
                <Text style={styles.recordHint}>
                  {recordingActive
                    ? 'Release to finish'
                    : recordingHint ?? 'Press and hold to record'}
                </Text>
              )}

              {!recordedUri && (
                <Text style={styles.recordHelperText}>
                  Hold a little longer for a better Resonance
                </Text>
              )}

              {recordedUri && (
                <View style={styles.readyPanel}>
                  <TextInput
                    style={styles.input}
                    placeholder="Add a sticky note (optional)..."
                    placeholderTextColor={C.faint}
                    value={stickyNote}
                    onChangeText={setStickyNote}
                    maxLength={STICKY_NOTE_MAX_LENGTH}
                    multiline
                  />

                  <View style={styles.readyActions}>
                    <Touchable
                      style={styles.outlineButton}
                      onPress={() => {
                        void startRecording();
                      }}
                      disabled={saving}
                      activeOpacity={0.82}
                    >
                      <Text style={styles.outlineButtonText}>Record Again</Text>
                    </Touchable>

                    <Touchable
                      style={styles.saveButton}
                      onPress={saveResonance}
                      disabled={saving}
                      activeOpacity={0.86}
                    >
                      <Text style={styles.saveButtonText}>
                        {saving ? 'Saving...' : 'Save Resonance'}
                      </Text>
                    </Touchable>
                  </View>
                </View>
              )}
            </Animated.View>
          </>
        )}

        {step === 'saved' && blend.length > 0 && (
          <View style={styles.savedPanel}>
            <ResonanceOrb blend={blend} size={132} style={styles.savedOrb} />
            <Text style={styles.savedBlendSummary}>{formatBlendSummary(blend)}</Text>
            <Text style={styles.savedDate}>{formatResonanceDate(getLocalDateString())}</Text>

            <Text style={styles.savedText}>Your Resonance for today is saved.</Text>

            {recordedUri && (
              <View style={styles.replayRow}>
                <Touchable
                  style={styles.replayButton}
                  activeOpacity={0.84}
                  onPress={toggleResultPlayback}
                >
                  <Ionicons
                    name={resultPlaying ? 'pause' : 'play'}
                    size={20}
                    color="#0B100D"
                  />
                </Touchable>

                <View style={styles.replayWaveformWrap}>
                  <FrequencyWaveform
                    active
                    progress={resultProgress}
                    waveform={waveform}
                    onSeek={(fraction) => {
                      void seekResultPlayback(fraction);
                    }}
                  />
                </View>
              </View>
            )}

            <Touchable
              style={styles.closeButton}
              activeOpacity={0.86}
              onPress={closeResult}
            >
              <Text style={styles.closeButtonText}>Close</Text>
            </Touchable>
          </View>
        )}
        </Pressable>
      </ScrollView>

    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.background,
  },

  content: {
    flexGrow: 1,
    backgroundColor: C.background,
    paddingHorizontal: 28,
    paddingTop: 58,
    paddingBottom: 24,
  },

  backButton: {
    alignSelf: 'flex-start',
    marginBottom: 16,
  },

  header: {
    marginBottom: S.xl,
  },

  eyebrow: {
    color: C.faint,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 10,
  },

  title: {
    color: C.text,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.8,
    lineHeight: 40,
  },

  moodChip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
  },

  moodChipDots: {
    flexDirection: 'row',
    gap: 4,
    marginRight: 8,
  },

  moodChipDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },

  moodChipText: {
    color: C.muted,
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
  },

  previewStage: {
    alignItems: 'center',
    marginBottom: S.xl,
  },

  aura: {
    // Centred on the orb itself, not on the stage, so the glow reads as light
    // the orb is casting.
    top: ORB_STAGE_SIZE / 2 - AURA_SIZE / 2,
  },

  previewCaption: {
    color: C.text,
    fontSize: 17,
    fontWeight: '700',
    marginTop: 14,
    textAlign: 'center',
  },

  previewHint: {
    color: C.faint,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 6,
    textAlign: 'center',
  },

  categorySwitch: {
    marginBottom: S.lg,
  },

  pillGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },

  continueButton: {
    backgroundColor: C.accent,
    paddingVertical: 16,
    borderRadius: R.md,
    alignItems: 'center',
    marginTop: S.xl,
  },

  continueButtonText: {
    color: '#0B100D',
    fontSize: 16,
    fontWeight: '800',
  },

  waveformStage: {
    alignSelf: 'center',
    width: '70%',
    minWidth: 250,
    height: 86,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },

  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
    width: '100%',
  },

  previewPlayButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.accent,
  },

  previewWaveformWrap: {
    flex: 1,
    overflow: 'hidden',
  },

  timer: {
    color: C.text,
    textAlign: 'center',
    fontSize: 44,
    fontWeight: '800',
    letterSpacing: -1,
    marginBottom: 24,
  },

  controls: {
    alignItems: 'center',
  },

  recordButtonWrap: {
    width: 188,
    height: 188,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },

  recordOuterRing: {
    position: 'absolute',
    width: 176,
    height: 176,
    borderRadius: 88,
    borderWidth: 2,
    borderColor: 'rgba(107,168,130,0.46)',
    backgroundColor: 'rgba(107,168,130,0.035)',
  },

  recordOuterRingActive: {
    borderColor: 'rgba(143,205,164,0.62)',
    backgroundColor: 'rgba(107,168,130,0.06)',
  },

  recordGlow: {
    width: 154,
    height: 154,
    borderRadius: 77,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: C.accent,
    shadowOpacity: 0.36,
    shadowRadius: 34,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },

  recordGlowActive: {
    shadowOpacity: 0.58,
    shadowRadius: 42,
  },

  recordCircleButton: {
    width: 152,
    height: 152,
    borderRadius: 76,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(226,237,232,0.32)',
    overflow: 'hidden',
  },

  recordCircleButtonActive: {
    backgroundColor: '#86C79B',
    borderColor: 'rgba(226,237,232,0.48)',
  },

  recordingLabel: {
    color: C.accent,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginTop: -2,
    marginBottom: 6,
    textTransform: 'uppercase',
  },

  recordHint: {
    color: C.accent,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },

  recordHelperText: {
    color: C.muted,
    fontSize: 15,
    fontWeight: '600',
    marginTop: 10,
    textAlign: 'center',
    flexShrink: 1,
  },

  readyPanel: {
    width: '100%',
    marginTop: S.sm,
  },

  input: {
    backgroundColor: 'rgba(21,27,24,0.78)',
    color: C.text,
    paddingHorizontal: 18,
    paddingVertical: 17,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.divider,
    fontSize: 16,
    minHeight: 56,
    marginBottom: 16,
  },

  readyActions: {
    flexDirection: 'row',
    gap: 12,
  },

  outlineButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: R.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.divider,
    backgroundColor: 'rgba(21,27,24,0.58)',
  },

  outlineButtonText: {
    color: C.text,
    fontSize: 16,
    fontWeight: '800',
  },

  saveButton: {
    flex: 1,
    backgroundColor: C.accent,
    paddingVertical: 16,
    borderRadius: R.md,
    alignItems: 'center',
  },

  saveButtonText: {
    color: '#0B100D',
    fontSize: 16,
    fontWeight: '800',
  },

  savedPanel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 40,
  },

  savedOrb: {
    // ResonanceOrb reserves extra transparent space around the sphere for
    // its ripple, so pull the label up rather than adding more margin.
    marginBottom: -16,
  },

  savedBlendSummary: {
    color: C.text,
    fontSize: 19,
    fontWeight: '800',
    textAlign: 'center',
    paddingHorizontal: S.md,
  },

  savedDate: {
    color: C.muted,
    fontSize: 16,
    fontWeight: '600',
    marginTop: 8,
  },

  savedText: {
    color: C.text,
    fontSize: 18,
    fontWeight: '700',
    marginTop: 28,
    textAlign: 'center',
  },

  replayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
    width: '100%',
    maxWidth: 280,
    marginTop: 24,
  },

  replayButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.accent,
  },

  replayWaveformWrap: {
    flex: 1,
    overflow: 'hidden',
  },

  closeButton: {
    marginTop: 36,
    width: '100%',
    paddingVertical: 16,
    borderRadius: R.md,
    alignItems: 'center',
    backgroundColor: C.accent,
  },

  closeButtonText: {
    color: '#0B100D',
    fontSize: 16,
    fontWeight: '800',
  },
});
