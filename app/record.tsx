import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Animated,
  Easing,
} from 'react-native';
import BackButton from '@/components/BackButton';
import Touchable from '@/components/Touchable';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system/legacy';
import { decode as atob } from 'base-64';
import { supabase } from '../lib/supabase';
import {
  FrequencyColors as C,
  FrequencyRadius as R,
  FrequencySpacing as S,
} from '../constants/frequencyTheme';
import FrequencyWaveform from '@/components/FrequencyWaveform';
import { fetchUsernameForUser } from '@/lib/profiles';
import { downsampleWaveform, meteringToAmplitude } from '@/lib/waveform';
import { error as hapticError, success } from '@/lib/haptics';

const RECORD_START_THRESHOLD_MS = 150;
const MIN_RECORDING_MS = 1000;
const RECORD_BUTTON_IDLE_SCALE = 1;
const RECORD_BUTTON_TOUCH_SCALE = 0.94;
const RECORD_BUTTON_ACTIVE_SCALE = 1.045;

function playHaptic(label: string, trigger: () => Promise<void>) {
  void trigger().catch((error) => {
    console.warn(`[Record Echo] ${label} haptic failed`, error);
  });
}

export default function RecordScreen() {
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [title, setTitle] = useState('');
  const [uploading, setUploading] = useState(false);
  const [waveform, setWaveform] = useState<number[] | null>(null);
  const [recordingHint, setRecordingHint] = useState<string | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [previewProgress, setPreviewProgress] = useState(0);
  const waveformSamplesRef = useRef<number[]>([]);
  const previewSoundRef = useRef<Audio.Sound | null>(null);
  const previewDurationMillisRef = useRef<number | null>(null);
  // How long the recording actually ran, measured at stop. The preview
  // player's decoded duration is more accurate and wins when it exists,
  // but an Echo can be posted without ever hitting preview, so this is
  // the fallback. Echo Impact needs a real duration to express how much
  // of an Echo a listener actually heard.
  const recordedDurationMillisRef = useRef<number | null>(null);
  const previewSeekingRef = useRef(false);
  const previewPendingSeekRef = useRef<number | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const recordingStartedAtRef = useRef(0);
  const isStartingRecordingRef = useRef(false);
  const pendingStopRef = useRef(false);
  const isPressingRecordRef = useRef(false);
  const liveHapticFiredRef = useRef(false);
  const recordStartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waveformBreath = useRef(new Animated.Value(0)).current;
  const controlsPresence = useRef(new Animated.Value(1)).current;
  const recordButtonScale = useRef(new Animated.Value(1)).current;
  const recordRingPulse = useRef(new Animated.Value(0)).current;

  const recordingActive = !!recording;
  const visualState = recordingActive ? 'recording' : recordedUri ? 'ready' : 'idle';

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;

    if (recordingActive) {
      timer = setInterval(() => setSeconds((prev) => prev + 1), 1000);
    }

    return () => clearInterval(timer);
  }, [recordingActive]);

  useEffect(() => {
    return () => {
      void previewSoundRef.current?.stopAsync().catch(() => {});
      void previewSoundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!recordingActive) {
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
  }, [recordingActive, waveformBreath]);

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

  useEffect(() => {
    return () => {
      if (recordStartTimeoutRef.current) {
        clearTimeout(recordStartTimeoutRef.current);
      }
    };
  }, []);

  function fireLiveRecordingHaptic() {
    if (liveHapticFiredRef.current) return;

    liveHapticFiredRef.current = true;
    console.log('[Record Echo] firing live haptic');
    void Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Success
    )
      .then(() => {
        console.log('[Record Echo] live haptic completed');
      })
      .catch((error) => {
        console.warn('[Record Echo] live haptic failed', error);
      });
  }

  function playRecordingEndHaptic() {
    playHaptic('finish', () =>
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    );
  }

  function playDiscardedRecordingHaptic() {
    playHaptic('discard', () =>
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
    );
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
      } catch (error) {
        console.warn('[Record Echo] released start cleanup failed', error);
      }
    }
  }

  function formatTime(totalSeconds: number) {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  async function stopPreviewSound() {
    try {
      if (previewSoundRef.current) {
        await previewSoundRef.current.stopAsync();
        await previewSoundRef.current.unloadAsync();
      }
    } catch {
      // Best effort cleanup before swapping sounds.
    }

    previewSoundRef.current = null;
    previewDurationMillisRef.current = null;
    previewSeekingRef.current = false;
    previewPendingSeekRef.current = null;
    setIsPreviewPlaying(false);
    setPreviewProgress(0);
  }

  async function togglePreviewPlayback() {
    try {
      if (previewSoundRef.current) {
        const status = await previewSoundRef.current.getStatusAsync();
        if (status.isLoaded) {
          if (status.isPlaying) {
            await previewSoundRef.current.pauseAsync();
            setIsPreviewPlaying(false);
          } else {
            await previewSoundRef.current.playAsync();
            setIsPreviewPlaying(true);
          }
          return;
        }
      }

      if (!recordedUri) return;

      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const { sound, status: initialStatus } = await Audio.Sound.createAsync({
        uri: recordedUri,
      });
      previewSoundRef.current = sound;
      previewDurationMillisRef.current =
        initialStatus.isLoaded && initialStatus.durationMillis
          ? initialStatus.durationMillis
          : null;
      await sound.setProgressUpdateIntervalAsync(100);

      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) return;

        if (status.durationMillis) {
          previewDurationMillisRef.current = status.durationMillis;
        }

        if (!previewSeekingRef.current) {
          setPreviewProgress(
            status.durationMillis ? status.positionMillis / status.durationMillis : 0
          );
        }

        if (status.didJustFinish) {
          setIsPreviewPlaying(false);
          setPreviewProgress(0);
        }
      });

      await sound.playAsync();
      setIsPreviewPlaying(true);
    } catch (error: any) {
      void hapticError();
      Alert.alert('Playback Error', error.message);
    }
  }

  async function seekPreviewPlayback(fraction: number) {
    const sound = previewSoundRef.current;
    if (!sound || !previewDurationMillisRef.current) return;

    const clamped = Math.max(0, Math.min(1, fraction));
    setPreviewProgress(clamped);

    if (previewSeekingRef.current) {
      previewPendingSeekRef.current = clamped;
      return;
    }

    previewSeekingRef.current = true;
    try {
      await sound.setPositionAsync(clamped * previewDurationMillisRef.current);
    } catch {
      // A superseded seek rejects with "Seeking interrupted" — safe to ignore.
    } finally {
      previewSeekingRef.current = false;
      const pending = previewPendingSeekRef.current;
      previewPendingSeekRef.current = null;
      if (pending != null) {
        void seekPreviewPlayback(pending);
      }
    }
  }

  function base64ToArrayBuffer(base64: string) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    return bytes.buffer;
  }

  async function startRecording() {
    try {
      if (recordingRef.current || isStartingRecordingRef.current || uploading) {
        return false;
      }

      isStartingRecordingRef.current = true;
      pendingStopRef.current = false;
      liveHapticFiredRef.current = false;
      await stopPreviewSound();
      setSeconds(0);
      setRecordedUri(null);
      setWaveform(null);
      setRecordingHint(null);

      console.log('[Record Echo] recorder start requested');
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
      console.log('[Record Echo] recorder active');
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

  // Seconds, matching the whisper_messages.duration convention. Null
  // rather than 0 when nothing was measured -- an unknown duration is
  // honest, a zero one would make every listen read as 0% heard.
  function recordedDurationSeconds() {
    const millis = previewDurationMillisRef.current ?? recordedDurationMillisRef.current;

    if (!millis || millis <= 0) return null;

    return Math.max(1, Math.round(millis / 1000));
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

      recordedDurationMillisRef.current = shouldDiscard ? null : recordedForMs;

      try {
        await activeRecording.stopAndUnloadAsync();
      } catch (error) {
        if (shouldDiscard) {
          setRecording(null);
          setRecordedUri(null);
          setWaveform(null);
          setSeconds(0);
          waveformSamplesRef.current = [];
          setRecordingHint('Hold a little longer to record an Echo.');
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
      console.log('[Record Echo] recording stopped');
      animateRecordButtonScale(RECORD_BUTTON_IDLE_SCALE);

      if (shouldDiscard) {
        setRecordedUri(null);
        setWaveform(null);
        setSeconds(0);
        waveformSamplesRef.current = [];
        setRecordingHint('Hold a little longer to record an Echo.');
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
    if (recordedUri || uploading) return;
    console.log('[Record Echo] press in');
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
    if (recordedUri || uploading) return;
    console.log('[Record Echo] press out');

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

  async function uploadEcho() {
    try {
      if (!recordedUri) {
        Alert.alert('No recording', 'Record something first.');
        return;
      }

      if (!title.trim()) {
        Alert.alert('Add title', 'Give your Echo a short title.');
        return;
      }

      setUploading(true);

      const { data: userData, error: userError } = await supabase.auth.getUser();

      if (userError || !userData.user) {
        void hapticError();
        Alert.alert('Login needed', 'Please log in again.');
        setUploading(false);
        return;
      }

      const user = userData.user;

      const base64Audio = await FileSystem.readAsStringAsync(recordedUri, {
        encoding: 'base64',
      } as any);

      const audioBuffer = base64ToArrayBuffer(base64Audio);
      const fileName = `${user.id}/${Date.now()}.m4a`;

      const { error: uploadError } = await supabase.storage
        .from('voice-notes')
        .upload(fileName, audioBuffer, {
          contentType: 'audio/mp4',
          upsert: false,
        });

      if (uploadError) {
        void hapticError();
        Alert.alert('Upload Error', uploadError.message);
        setUploading(false);
        return;
      }

      const { data: publicUrlData } = supabase.storage
        .from('voice-notes')
        .getPublicUrl(fileName);

      const username = await fetchUsernameForUser(user.id, user.email);

      const { error: dbError } = await supabase
        .from('voice_notes')
        .insert({
          user_id: user.id,
          username,
          audio_url: publicUrlData.publicUrl,
          caption: title.trim(),
          waveform,
          duration: recordedDurationSeconds(),
        })
        .select('id, user_id')
        .single();

      if (dbError) {
        void hapticError();
        Alert.alert('Database Error', dbError.message);
        setUploading(false);
        return;
      }

      setRecordedUri(null);
      setTitle('');
      setSeconds(0);
      setWaveform(null);
      waveformSamplesRef.current = [];
      setUploading(false);
      void success();

      router.back();
    } catch (error: any) {
      void hapticError();
      Alert.alert('Unexpected Error', error.message);
      setUploading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.content}>
        <BackButton variant="close" style={styles.backButton} />

        <View style={styles.header}>
          <Text style={styles.title}>New Echo</Text>
          <Text style={styles.subtitle}>{"Say what's on your mind."}</Text>
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
                  void togglePreviewPlayback();
                }}
              >
                <Ionicons
                  name={isPreviewPlaying ? 'pause' : 'play'}
                  size={19}
                  color="#0B100D"
                />
              </Touchable>

              <View style={styles.previewWaveformWrap}>
                <FrequencyWaveform
                  active
                  progress={previewProgress}
                  waveform={waveform}
                  onSeek={(fraction) => {
                    void seekPreviewPlayback(fraction);
                  }}
                />
              </View>
            </View>
          ) : (
            <FrequencyWaveform active={false} waveform={waveform} />
          )}
        </Animated.View>

        <Text style={styles.timer}>
          {formatTime(seconds)}
        </Text>

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
                  disabled={uploading}
                >
                  <Ionicons
                    name={recordingActive ? 'mic' : 'mic-outline'}
                    size={66}
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
            <Text style={[styles.recordHint, recordingHint && styles.noticeHint]}>
              {recordingActive
                ? 'Release to finish'
                : recordingHint ?? 'Press and hold to record'}
            </Text>
          )}

          {!recordedUri && (
            <Text style={styles.recordHelperText}>
              Hold a little longer for a better Echo
            </Text>
          )}

          {recordedUri && (
            <View style={styles.readyPanel}>
              <TextInput
                style={styles.input}
                placeholder="Give this Echo a title..."
                placeholderTextColor={C.faint}
                value={title}
                onChangeText={setTitle}
              />

              <View style={styles.readyActions}>
                <Touchable
                  style={styles.outlineButton}
                  onPress={() => {
                    void startRecording();
                  }}
                  disabled={uploading}
                  activeOpacity={0.82}
                >
                  <Text style={styles.outlineButtonText}>Record Again</Text>
                </Touchable>

                <Touchable
                  style={styles.postButton}
                  onPress={uploadEcho}
                  disabled={uploading}
                  activeOpacity={0.86}
                >
                  <Text style={styles.postButtonText}>
                    {uploading ? 'Posting...' : 'Post Echo →'}
                  </Text>
                </Touchable>
              </View>
            </View>
          )}
        </Animated.View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.background,
  },

  content: {
    flex: 1,
    backgroundColor: C.background,
    paddingHorizontal: 28,
    paddingTop: 58,
    paddingBottom: 24,
  },

  backButton: {
    alignSelf: 'flex-start',
    marginBottom: 22,
  },

  header: {
    marginBottom: 28,
  },

  title: {
    color: C.text,
    fontSize: 44,
    fontWeight: '800',
    letterSpacing: -1.2,
  },

  subtitle: {
    color: C.muted,
    fontSize: 19,
    marginTop: 10,
  },

  waveformStage: {
    alignSelf: 'center',
    width: '70%',
    minWidth: 250,
    height: 86,
    backgroundColor: 'transparent',
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
    fontSize: 54,
    fontWeight: '800',
    letterSpacing: -1,
    marginBottom: 16,
  },

  controls: {
    alignItems: 'center',
  },

  recordButtonWrap: {
    width: 188,
    height: 188,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 0,
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
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },

  noticeHint: {
    color: C.accent,
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

  input: {
    backgroundColor: 'rgba(21,27,24,0.78)',
    color: C.text,
    paddingHorizontal: 18,
    paddingVertical: 17,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.divider,
    fontSize: 17,
    marginBottom: 16,
  },

  postButton: {
    flex: 1,
    backgroundColor: C.accent,
    paddingVertical: 16,
    borderRadius: R.md,
    alignItems: 'center',
  },

  postButtonText: {
    color: '#0B100D',
    fontSize: 17,
    fontWeight: '800',
  },
});
