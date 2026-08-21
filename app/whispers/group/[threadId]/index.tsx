import Ionicons from '@expo/vector-icons/Ionicons';
import { Audio, AVPlaybackStatus } from 'expo-av';
import { BlurView } from 'expo-blur';
import * as FileSystem from 'expo-file-system/legacy';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { decode as atob } from 'base-64';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import BackButton from '@/components/BackButton';
import MessageTimeReveal from '@/components/MessageTimeReveal';
import Touchable from '@/components/Touchable';
import { SafeAreaView } from 'react-native-safe-area-context';

import Avatar from '@/components/Avatar';
import GroupAvatarDisplay from '@/components/GroupAvatarDisplay';
import { FrequencyLogoLoader } from '@/components/branding/FrequencyLogo';
import {
  FrequencyBubble as Bubble,
  FrequencyColors as C,
  FrequencyRadius as R,
  FrequencySpacing as S,
} from '@/constants/frequencyTheme';
import {
  fetchGroupThread,
  fetchGroupThreadMembers,
  fetchGroupThreadMessages,
  fetchListenedMessageIds,
  formatSeenBy,
  getGroupDisplayName,
  getSeenByMembers,
  markGroupMessageListened,
  markGroupThreadRead,
  sendGroupWhisperMessage,
  type GroupMember,
  type GroupThreadMessage,
  type WhisperGroupThread,
} from '@/lib/groupWhispers';
import { error as hapticError, light, medium, success } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';
import { downsampleWaveform, getFallbackWaveform, meteringToAmplitude } from '@/lib/waveform';
import { useMessageTimeReveal } from '@/hooks/useMessageTimeReveal';
import { useWaveformScrub } from '@/hooks/useWaveformScrub';

const CAPTION_MAX_LENGTH = 60;
const SWIPE_MAX_DISTANCE = 72;
const REPLY_THRESHOLD = 60;
const QUOTE_BAR_COUNT = 13;
const QUOTE_AVATAR = 18;
const REPLY_RAIL_WIDTH = 3;
const REPLY_RAIL_GAP = 12;

const REPLY_PREVIEW_LAYOUT_ANIMATION = {
  duration: 220,
  create: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
  },
  update: {
    type: LayoutAnimation.Types.easeInEaseOut,
  },
  delete: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
    duration: 170,
  },
};

function animateReplyPreviewChange() {
  LayoutAnimation.configureNext(REPLY_PREVIEW_LAYOUT_ANIMATION);
}

type GroupReplyPreview = {
  id: string;
  sender_id: string;
  username: string;
  duration: number;
  caption: string | null;
  waveform: number[] | null;
};

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.max(0, seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function buildReplyPreview(
  message: GroupThreadMessage | undefined,
  usernameById: Map<string, string>
): GroupReplyPreview | null {
  if (!message) return null;

  return {
    id: message.id,
    sender_id: message.sender_id,
    username: usernameById.get(message.sender_id) ?? 'frequency',
    duration: message.duration,
    caption: message.caption,
    waveform: message.waveform,
  };
}

/**
 * The one line above a reply, on the same rules as a 1:1 Whisper: nobody
 * is named when the thread already makes it obvious who is meant.
 *
 * A 1:1 can drop every name, because "them" has exactly one possible
 * meaning. A group cannot -- "you replied to them" among twelve people
 * names nobody -- so a @username appears in the one case a 1:1 never has:
 * when the Echo being answered belongs to neither you nor the person
 * answering it.
 */
function describeReply(
  replierId: string,
  quotedSenderId: string,
  currentUserId: string,
  quotedUsername: string
) {
  const mine = replierId === currentUserId;

  if (quotedSenderId === replierId) {
    return mine ? 'You replied to yourself' : 'Replied to themselves';
  }

  if (quotedSenderId === currentUserId) return 'Replied to you';

  return mine ? `You replied to @${quotedUsername}` : `Replied to @${quotedUsername}`;
}

function pickThumbnailBars(waveform: number[] | null | undefined, count = 5) {
  const bars = waveform && waveform.length > 0 ? waveform : getFallbackWaveform();
  const step = bars.length / count;

  return Array.from({ length: count }, (_, index) =>
    bars[Math.min(bars.length - 1, Math.floor(index * step))]
  );
}

function base64ToArrayBuffer(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

function MiniWaveform({
  waveform,
  active,
  progress,
  compact = false,
  showProgress = true,
  onSeek,
  onLongPress,
  tint = Bubble.theirs.wave,
  playedTint = Bubble.theirs.wavePlayed,
}: {
  waveform?: number[] | null;
  active: boolean;
  progress: number;
  compact?: boolean;
  showProgress?: boolean;
  onSeek?: (fraction: number) => void;
  onLongPress?: () => void;
  tint?: string;
  playedTint?: string;
}) {
  const bars = waveform && waveform.length > 0 ? waveform : getFallbackWaveform();
  const visibleBars = bars.slice(0, compact ? 20 : 24);
  const playedIndex = Math.floor(Math.max(0, Math.min(1, progress)) * visibleBars.length);
  const { containerRef, onLayout, panHandlers } = useWaveformScrub(
    onSeek,
    undefined,
    undefined,
    onLongPress
  );

  return (
    <View
      ref={containerRef}
      style={[styles.waveform, compact && styles.compactWaveform]}
      onLayout={onLayout}
      {...panHandlers}
    >
      {visibleBars.map((amplitude, index) => {
        const played = showProgress && active && index <= playedIndex;
        const opacity = showProgress ? (active ? (played ? 1 : 0.36) : 0.78) : 0.78;

        return (
          <View
            key={`${amplitude}-${index}`}
            style={[
              styles.waveBar,
              compact && styles.compactWaveBar,
              {
                height: compact ? 5 + amplitude * 24 : 7 + amplitude * 34,
                backgroundColor: played ? playedTint : tint,
                opacity,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

function SoftAppear({
  children,
  rotate = '0deg',
  translateFrom = 8,
  scaleFrom,
  duration = 220,
  style,
}: {
  children: ReactNode;
  rotate?: string;
  translateFrom?: number;
  scaleFrom?: number;
  duration?: number;
  style?: any;
}) {
  const presence = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(presence, {
      toValue: 1,
      duration,
      useNativeDriver: true,
    }).start();
  }, [presence, duration]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: presence,
          transform: [
            {
              translateY: presence.interpolate({
                inputRange: [0, 1],
                outputRange: [translateFrom, 0],
              }),
            },
            ...(scaleFrom !== undefined
              ? [
                  {
                    scale: presence.interpolate({
                      inputRange: [0, 1],
                      outputRange: [scaleFrom, 1],
                    }),
                  },
                ]
              : []),
            { rotate },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

function TinyWaveform({ waveform }: { waveform?: number[] | null }) {
  const bars = useMemo(() => pickThumbnailBars(waveform, QUOTE_BAR_COUNT), [waveform]);
  const barPresence = useRef(bars.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    Animated.stagger(
      22,
      barPresence.map((value) =>
        Animated.timing(value, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        })
      )
    ).start();
    // Bars are sampled once per message and should only animate in on first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.tinyWaveform}>
      {bars.map((amplitude, index) => (
        <Animated.View
          key={index}
          style={[
            styles.tinyWaveBar,
            { height: 4 + amplitude * 9, opacity: barPresence[index] },
          ]}
        />
      ))}
    </View>
  );
}

/**
 * Swipe an Echo to answer it.
 *
 * The direction is not decorative: your own Echoes pull left, everyone
 * else's pull right. Quoting yourself and quoting someone else are
 * different acts, and a bubble that already sits on the right has nowhere
 * to go but inward, so the gesture matches the side it lives on.
 */
function SwipeReplyRow({
  children,
  grouped = false,
  last = false,
  replyEligible = false,
  direction = 'right',
  onReply,
}: {
  children: ReactNode;
  grouped?: boolean;
  last?: boolean;
  replyEligible?: boolean;
  direction?: 'left' | 'right';
  onReply?: () => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const pullsLeft = direction === 'left';
  // Everything below measures the drag as distance travelled the allowed
  // way, so one set of thresholds covers both directions.
  const sign = pullsLeft ? -1 : 1;
  const replyProgress = translateX.interpolate({
    inputRange: pullsLeft ? [-REPLY_THRESHOLD, 0] : [0, REPLY_THRESHOLD],
    outputRange: pullsLeft ? [1, 0] : [0, 1],
    extrapolate: 'clamp',
  });

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          replyEligible &&
          gesture.dx * sign > 8 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.3,
        onPanResponderMove: (_, gesture) => {
          if (!replyEligible) return;
          const travelled = Math.min(SWIPE_MAX_DISTANCE, Math.max(0, gesture.dx * sign));
          translateX.setValue(travelled * sign);
        },
        onPanResponderRelease: (_, gesture) => {
          if (replyEligible && gesture.dx * sign >= REPLY_THRESHOLD) onReply?.();
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            tension: 120,
            friction: 13,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            tension: 120,
            friction: 13,
          }).start();
        },
      }),
    [onReply, replyEligible, sign, translateX]
  );

  return (
    <View
      style={[
        styles.swipeReplyRow,
        grouped && styles.groupedSwipeReplyRow,
        last && styles.lastSwipeReplyRow,
      ]}
    >
      {replyEligible && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.replyGestureIndicator,
            pullsLeft ? styles.replyGestureIndicatorLeft : styles.replyGestureIndicatorRight,
            {
              opacity: replyProgress,
              transform: [{ scale: replyProgress.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] }) }],
            },
          ]}
        >
          {/* The mirrored glyph, so the arrow curves the way the finger
              is travelling rather than against it. */}
          <Ionicons
            name={pullsLeft ? 'arrow-redo-outline' : 'arrow-undo-outline'}
            size={18}
            color={C.accentSoft}
          />
        </Animated.View>
      )}
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

export default function GroupWhisperThreadScreen() {
  const params = useLocalSearchParams<{ threadId?: string | string[] }>();
  const threadId = useMemo(() => {
    const raw = params.threadId;
    return Array.isArray(raw) ? raw[0] ?? '' : raw ?? '';
  }, [params.threadId]);

  const [currentUserId, setCurrentUserId] = useState('');
  const [thread, setThread] = useState<WhisperGroupThread | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [messages, setMessages] = useState<GroupThreadMessage[]>([]);
  const [listenedIds, setListenedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recordingIntent, setRecordingIntent] = useState(false);
  const [isLockedRecording, setIsLockedRecording] = useState(false);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [caption, setCaption] = useState('');
  const [composerHeight, setComposerHeight] = useState(0);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [waveform, setWaveform] = useState<number[] | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [isSoundPlaying, setIsSoundPlaying] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const { revealedMessageId, revealMessageTime } = useMessageTimeReveal();

  const soundRef = useRef<Audio.Sound | null>(null);
  const playingIdRef = useRef<string | null>(null);
  const seekingRef = useRef(false);
  const pendingSeekRef = useRef<{ message: GroupThreadMessage; fraction: number } | null>(null);
  const durationMillisRef = useRef<number | null>(null);
  const waveformSamplesRef = useRef<number[]>([]);
  const listRef = useRef<FlatList<GroupThreadMessage>>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const isStartingRecordingRef = useRef(false);
  const pendingStopRef = useRef(false);
  const isLockedRecordingRef = useRef(false);
  const recordButtonScale = useRef(new Animated.Value(1)).current;
  const recordingPulse = useRef(new Animated.Value(0)).current;

  const membersById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const usernameById = useMemo(
    () => new Map(members.map((member) => [member.id, member.username])),
    [members]
  );
  const replyTarget = useMemo(
    () => messages.find((message) => message.id === replyTargetId) ?? null,
    [messages, replyTargetId]
  );
  const seenByMembersByMessageId = useMemo(() => {
    const map = new Map<string, GroupMember[]>();
    messages.forEach((message) => {
      map.set(message.id, getSeenByMembers(message, members));
    });
    return map;
  }, [messages, members]);
  const displayName = useMemo(
    () => (thread ? getGroupDisplayName(members, currentUserId, thread.title) : ''),
    [thread, members, currentUserId]
  );
  const clusterMembers = useMemo(
    () =>
      members
        .filter((member) => member.id !== currentUserId)
        .slice(0, 2)
        .map((member) => ({ username: member.username, avatarUrl: member.avatarUrl })),
    [members, currentUserId]
  );
  const clusterExtraCount = Math.max(
    0,
    members.filter((member) => member.id !== currentUserId).length - 2
  );
  const recordingActive = recordingIntent || !!recording;

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;

    if (recordingActive) {
      timer = setInterval(() => setSeconds((prev) => prev + 1), 1000);
    }

    return () => clearInterval(timer);
  }, [recordingActive]);

  useEffect(() => {
    if (!recordingActive) {
      recordingPulse.stopAnimation();
      Animated.timing(recordingPulse, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }).start();
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(recordingPulse, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(recordingPulse, {
          toValue: 0,
          duration: 900,
          useNativeDriver: true,
        }),
      ])
    );

    animation.start();

    return () => animation.stop();
  }, [recordingActive, recordingPulse]);

  async function stopCurrentSound() {
    try {
      if (soundRef.current) {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
      }
    } catch {
      // Best effort cleanup before swapping sounds.
    }

    soundRef.current = null;
    playingIdRef.current = null;
    durationMillisRef.current = null;
    setPlayingId(null);
    setIsSoundPlaying(false);
    setPlaybackProgress(0);
  }

  const loadThread = useCallback(async () => {
    if (!threadId) return;

    setLoading(true);

    const { data: userData } = await supabase.auth.getUser();
    const me = userData.user?.id ?? '';

    if (!me) {
      setLoading(false);
      return;
    }

    try {
      const [nextThread, nextMembers, nextMessages] = await Promise.all([
        fetchGroupThread(threadId),
        fetchGroupThreadMembers(threadId),
        fetchGroupThreadMessages(threadId),
      ]);

      if (!nextThread) {
        Alert.alert('Group Whisper', 'This group no longer exists.');
        router.replace('/(tabs)/whispers');
        return;
      }

      const messageIds = nextMessages.map((message) => message.id);
      const nextListenedIds = await fetchListenedMessageIds(messageIds, me);

      setCurrentUserId(me);
      setThread(nextThread);
      setMembers(nextMembers);
      setMessages(nextMessages);
      setListenedIds(nextListenedIds);

      // Opening the thread clears the inbox/tab-bar unread signal, same as
      // 1:1 Whispers -- independent of whether any Echo actually gets
      // tapped-to-play this visit.
      void markGroupThreadRead(threadId, me).catch(() => {});
    } catch (err) {
      void hapticError();
      Alert.alert(
        'Whisper Error',
        err instanceof Error ? err.message : 'Could not load this group.'
      );
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useFocusEffect(
    useCallback(() => {
      loadThread();

      return () => {
        stopCurrentSound();
      };
    }, [loadThread])
  );

  useFocusEffect(
    useCallback(() => {
      if (!threadId || !currentUserId) return;

      const channel = supabase
        .channel(`whisper-group-thread-${threadId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'whisper_group_messages',
            filter: `group_thread_id=eq.${threadId}`,
          },
          (payload) => {
            const inserted = payload.new as GroupThreadMessage;
            if (!inserted.id) return;

            setMessages((current) => {
              if (current.some((message) => message.id === inserted.id)) return current;
              return [...current, inserted];
            });
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'whisper_group_participants',
            filter: `group_thread_id=eq.${threadId}`,
          },
          (payload) => {
            const updated = payload.new as { user_id: string; last_read_at: string | null };
            if (!updated.user_id) return;

            setMembers((current) =>
              current.map((member) =>
                member.id === updated.user_id
                  ? { ...member, lastReadAt: updated.last_read_at }
                  : member
              )
            );
          }
        )
        .subscribe();

      return () => {
        void supabase.removeChannel(channel);
      };
    }, [threadId, currentUserId])
  );

  async function playMessage(message: GroupThreadMessage, seekFraction?: number) {
    await stopCurrentSound();
    setPlayingId(message.id);
    playingIdRef.current = message.id;
    setPlaybackProgress(Math.max(0, Math.min(1, seekFraction ?? 0)));

    if (message.sender_id !== currentUserId && !listenedIds.has(message.id)) {
      setListenedIds((current) => new Set(current).add(message.id));
      void markGroupMessageListened(message.id, currentUserId);
    }

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
    });

    const { sound, status: initialStatus } = await Audio.Sound.createAsync({
      uri: message.audio_url,
    });

    soundRef.current = sound;
    durationMillisRef.current =
      initialStatus.isLoaded && initialStatus.durationMillis
        ? initialStatus.durationMillis
        : null;

    await sound.setVolumeAsync(1.0);
    await sound.setProgressUpdateIntervalAsync(100);

    if (seekFraction != null && durationMillisRef.current) {
      await sound.setPositionAsync(
        Math.max(0, Math.min(1, seekFraction)) * durationMillisRef.current
      );
    }

    await sound.playAsync();
    setIsSoundPlaying(true);

    sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
      if (!status.isLoaded) return;

      if (status.durationMillis) {
        durationMillisRef.current = status.durationMillis;
      }

      if (playingIdRef.current === message.id && !seekingRef.current) {
        setPlaybackProgress(
          status.durationMillis ? status.positionMillis / status.durationMillis : 0
        );
      }

      if (status.didJustFinish) {
        stopCurrentSound();
      }
    });
  }

  async function toggleMessage(message: GroupThreadMessage) {
    if (playingIdRef.current === message.id && soundRef.current) {
      const status = await soundRef.current.getStatusAsync();
      if (status.isLoaded) {
        if (status.isPlaying) {
          await soundRef.current.pauseAsync();
          setIsSoundPlaying(false);
        } else {
          await soundRef.current.playAsync();
          setIsSoundPlaying(true);
        }
        return;
      }
    }

    await playMessage(message);
  }

  async function seekMessage(message: GroupThreadMessage, fraction: number) {
    const clamped = Math.max(0, Math.min(1, fraction));

    if (playingIdRef.current !== message.id || !soundRef.current) {
      await playMessage(message, clamped);
      return;
    }

    setPlaybackProgress(clamped);

    if (seekingRef.current) {
      pendingSeekRef.current = { message, fraction: clamped };
      return;
    }

    seekingRef.current = true;
    try {
      if (durationMillisRef.current) {
        await soundRef.current.setPositionAsync(clamped * durationMillisRef.current);
      }
    } catch {
      // A superseded seek rejects with "Seeking interrupted" — safe to ignore.
    } finally {
      seekingRef.current = false;
      const pending = pendingSeekRef.current;
      pendingSeekRef.current = null;
      if (pending) {
        void seekMessage(pending.message, pending.fraction);
      }
    }
  }

  function showSeenByList(readerMembers: GroupMember[]) {
    Alert.alert('Heard By', formatSeenBy(readerMembers.map((member) => member.username), true));
  }

  async function startRecording() {
    try {
      if (
        recordingRef.current ||
        isStartingRecordingRef.current ||
        composerDisabled ||
        recordedUri
      ) {
        return false;
      }

      isStartingRecordingRef.current = true;
      pendingStopRef.current = false;
      isLockedRecordingRef.current = false;
      setIsLockedRecording(false);
      setRecordingIntent(true);
      setSeconds(0);
      setRecordedUri(null);
      setWaveform(null);

      const permission = await Audio.requestPermissionsAsync();

      if (!permission.granted) {
        setRecordingIntent(false);
        void hapticError();
        Alert.alert('Permission needed', 'Please allow microphone access.');
        return false;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const nextRecording = new Audio.Recording();
      waveformSamplesRef.current = [];

      await nextRecording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);

      nextRecording.setProgressUpdateInterval(90);
      nextRecording.setOnRecordingStatusUpdate((status) => {
        const metering = (status as Audio.RecordingStatus & { metering?: number }).metering;

        if (typeof metering === 'number') {
          waveformSamplesRef.current.push(meteringToAmplitude(metering));
        }
      });

      await nextRecording.startAsync();

      recordingRef.current = nextRecording;
      setRecording(nextRecording);
      void medium();

      if (pendingStopRef.current && !isLockedRecordingRef.current) {
        pendingStopRef.current = false;
        await stopRecording();
      }

      return true;
    } catch (err: any) {
      setRecordingIntent(false);
      void hapticError();
      Alert.alert('Recording Error', err.message);
      return false;
    } finally {
      isStartingRecordingRef.current = false;
    }
  }

  async function stopRecording() {
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
      isLockedRecordingRef.current = false;
      setIsLockedRecording(false);

      await activeRecording.stopAndUnloadAsync();
      const uri = activeRecording.getURI();
      const nextWaveform = downsampleWaveform(waveformSamplesRef.current);

      setRecordedUri(uri);
      setWaveform(nextWaveform);
      setRecordingIntent(false);
      setRecording(null);
      void medium();
    } catch (err: any) {
      recordingRef.current = null;
      pendingStopRef.current = false;
      isLockedRecordingRef.current = false;
      setIsLockedRecording(false);
      setRecordingIntent(false);
      setRecording(null);
      void hapticError();
      Alert.alert('Stop Error', err.message);
    }
  }

  function lockRecording() {
    if (!recordingActive && !isStartingRecordingRef.current) return;

    isLockedRecordingRef.current = true;
    pendingStopRef.current = false;
    setIsLockedRecording(true);
  }

  function animateRecordButton(toValue: number) {
    Animated.timing(recordButtonScale, {
      toValue,
      duration: 120,
      useNativeDriver: true,
    }).start();
  }

  const micPanResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => !composerDisabled && !recordedUri,
    onMoveShouldSetPanResponder: (_, gesture) =>
      !composerDisabled && !recordedUri && (Math.abs(gesture.dy) > 6 || Math.abs(gesture.dx) > 6),
    onPanResponderGrant: () => {
      if (composerDisabled || recordedUri) return;
      animateRecordButton(1.06);
      void startRecording();
    },
    onPanResponderMove: (_, gesture) => {
      if (gesture.dy < -44) {
        lockRecording();
      }
    },
    onPanResponderRelease: () => {
      animateRecordButton(1);
      if (isLockedRecordingRef.current) return;
      void stopRecording();
    },
    onPanResponderTerminate: () => {
      animateRecordButton(1);
      if (isLockedRecordingRef.current) return;
      void stopRecording();
    },
  });

  function resetComposer() {
    setRecordedUri(null);
    setCaption('');
    setSeconds(0);
    setWaveform(null);
    waveformSamplesRef.current = [];
  }

  function selectReplyTarget(message: GroupThreadMessage) {
    animateReplyPreviewChange();
    setReplyTargetId(message.id);
    void light();
  }

  function scrollToMessage(messageId: string) {
    const index = messages.findIndex((message) => message.id === messageId);

    if (index < 0) return;

    listRef.current?.scrollToIndex({
      index,
      animated: true,
      viewPosition: 0.5,
    });
    setHighlightedMessageId(messageId);
    // Only clears its own highlight: jumping to a second quote before this
    // fires must not have its highlight cut short by the first timer.
    setTimeout(() => {
      setHighlightedMessageId((current) => (current === messageId ? null : current));
    }, 900);
  }

  async function sendWhisper() {
    if (!recordedUri || !currentUserId || !threadId || sending) return;

    void light();

    try {
      setSending(true);

      const base64Audio = await FileSystem.readAsStringAsync(recordedUri, {
        encoding: 'base64',
      } as any);
      const audioBuffer = base64ToArrayBuffer(base64Audio);
      const fileName = `whispers/group/${currentUserId}/${Date.now()}.m4a`;

      const { error: uploadError } = await supabase.storage
        .from('voice-notes')
        .upload(fileName, audioBuffer, {
          contentType: 'audio/mp4',
          upsert: false,
        });

      if (uploadError) {
        void hapticError();
        Alert.alert('Upload Error', uploadError.message);
        setSending(false);
        return;
      }

      const { data: publicUrlData } = supabase.storage.from('voice-notes').getPublicUrl(fileName);
      const cleanCaption = caption.trim();

      const sentMessage = await sendGroupWhisperMessage({
        threadId,
        senderId: currentUserId,
        audioUrl: publicUrlData.publicUrl,
        duration: Math.max(1, seconds),
        caption: cleanCaption || null,
        waveform,
        replyToMessageId: replyTargetId,
      });

      if (sentMessage.reply_to_message_id) {
        sentMessage.replyPreview = buildReplyPreview(replyTarget ?? undefined, usernameById);
      }
      setMessages((prev) => [...prev, sentMessage]);
      resetComposer();
      animateReplyPreviewChange();
      setReplyTargetId(null);
      setSending(false);
      void success();
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch (err: any) {
      void hapticError();
      Alert.alert('Unexpected Error', err.message);
      setSending(false);
    }
  }

  const composerDisabled = sending || loading;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <SafeAreaView
        edges={['top']}
        style={styles.safeHeader}
        onLayout={(event) => {
          const nextHeight = event.nativeEvent.layout.height;

          if (nextHeight > 0 && nextHeight !== headerHeight) {
            setHeaderHeight(nextHeight);
          }
        }}
      >
        <View style={styles.header}>
          <BackButton />

          <GroupAvatarDisplay
            avatarUrl={thread?.avatar_url ?? null}
            members={clusterMembers}
            extraCount={clusterExtraCount}
            size={36}
          />

          <View style={styles.headerIdentity}>
            <Text style={styles.headerName} numberOfLines={1} ellipsizeMode="tail">
              {displayName}
            </Text>
            <Text style={styles.headerSubtitle}>
              {members.length} {members.length === 1 ? 'person' : 'people'}
            </Text>
          </View>

          <Touchable
            style={styles.iconButton}
            activeOpacity={0.78}
            onPress={() =>
              router.push({
                pathname: '/whispers/group/[threadId]/members',
                params: { threadId },
              })
            }
          >
            <Ionicons name="information-circle-outline" size={26} color={C.text} />
          </Touchable>
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={styles.loadingState}>
          <FrequencyLogoLoader size={44} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.messagesContent,
            { paddingTop: headerHeight + 8, paddingBottom: composerHeight + 16 },
          ]}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No Echoes yet.</Text>
              <Text style={styles.emptyCopy}>
                Whoever speaks first starts the thread.
              </Text>
            </View>
          }
          renderItem={({ item, index }) => {
            const sender = membersById.get(item.sender_id);
            const isMine = item.sender_id === currentUserId;
            const isLoadedMessage = playingId === item.id;
            const isPlayingMessage = isLoadedMessage && isSoundPlaying;
            const isUnheard = !isMine && !listenedIds.has(item.id);
            const previousMessageSameSender =
              index > 0 && messages[index - 1]?.sender_id === item.sender_id;
            const nextMessageSameSender =
              index < messages.length - 1 && messages[index + 1]?.sender_id === item.sender_id;
            const isFirstInGroup = !previousMessageSameSender;
            const isLastInGroup = !nextMessageSameSender;
            const isLastMessage = index === messages.length - 1;
            const hasCaption = !!item.caption?.trim();
            const readerMembers = seenByMembersByMessageId.get(item.id) ?? [];
            const replyPreview = item.replyPreview ?? (
              item.reply_to_message_id
                ? buildReplyPreview(
                    messages.find((message) => message.id === item.reply_to_message_id),
                    usernameById
                  )
                : null
            );
            const senderAvatar = (
              <Avatar
                avatarUrl={sender?.avatarUrl ?? null}
                initial={sender?.username ?? 'frequency'}
                size={36}
                textSize={14}
                style={[styles.messageAvatar, isMine && styles.myMessageAvatar]}
              />
            );
            const voiceBubble = (
              <Touchable
                style={[
                  styles.voiceBubble,
                  isMine && styles.myVoiceBubble,
                  !isFirstInGroup && (isMine ? styles.myGroupedTopBubble : styles.theirGroupedTopBubble),
                  !isLastInGroup && (isMine ? styles.myGroupedBottomBubble : styles.theirGroupedBottomBubble),
                  highlightedMessageId === item.id && styles.highlightedVoiceBubble,
                ]}
                activeOpacity={0.86}
                onPress={() => toggleMessage(item)}
                onLongPress={() => revealMessageTime(item.id)}
              >
                <View style={styles.voiceAudioRow}>
                  <View style={styles.playSlot}>
                    <View style={[styles.playButton, isMine && styles.myPlayButton]}>
                      <Ionicons
                        name={isPlayingMessage ? 'pause' : 'play'}
                        size={18}
                        color="#0B100D"
                      />
                    </View>
                  </View>

                  <MiniWaveform
                    waveform={item.waveform}
                    active={isLoadedMessage}
                    progress={isLoadedMessage ? playbackProgress : 0}
                    compact
                    onSeek={(fraction) => {
                      void seekMessage(item, fraction);
                    }}
                    onLongPress={() => revealMessageTime(item.id)}
                    tint={isMine ? Bubble.mine.wave : Bubble.theirs.wave}
                    playedTint={isMine ? Bubble.mine.wavePlayed : Bubble.theirs.wavePlayed}
                  />

                  <View style={styles.durationSlot}>
                    <Text style={styles.duration}>{formatDuration(item.duration)}</Text>
                  </View>
                </View>

                <MessageTimeReveal
                  createdAt={item.created_at}
                  visible={revealedMessageId === item.id}
                />
              </Touchable>
            );

            return (
              <SwipeReplyRow
                grouped={nextMessageSameSender}
                last={isLastMessage}
                replyEligible
                direction={isMine ? 'left' : 'right'}
                onReply={() => selectReplyTarget(item)}
              >
                <View style={[styles.messageRow, isMine && styles.myMessageRow]}>
                  {!isMine && senderAvatar}

                  <View
                    style={[
                      styles.messageStack,
                      hasCaption && styles.messageStackWithSticky,
                      isMine && styles.myMessageStack,
                    ]}
                  >
                    {/* Your own runs need no label -- the side they sit on
                        already says who spoke, and the time is a hold away. */}
                    {isFirstInGroup && !isMine && (
                      <View style={styles.senderLabelRow}>
                        <Text style={styles.senderLabelName} numberOfLines={1}>
                          @{sender?.username ?? 'frequency'}
                        </Text>
                        {isUnheard && <View style={styles.unreadDot} />}
                      </View>
                    )}

                    {replyPreview ? (
                      <View style={styles.replyGroup}>
                        <Text
                          style={[styles.replyLabel, isMine && styles.myReplyLabel]}
                          numberOfLines={1}
                        >
                          {describeReply(
                            item.sender_id,
                            replyPreview.sender_id,
                            currentUserId,
                            replyPreview.username
                          )}
                        </Text>

                        <View style={[styles.quotedRow, isMine && styles.myQuotedRow]}>
                          <View style={styles.replyRail} />

                          <Touchable
                            style={[
                              styles.quotedBubble,
                              replyPreview.sender_id === currentUserId
                                ? styles.myQuotedBubble
                                : styles.theirQuotedBubble,
                            ]}
                            activeOpacity={0.62}
                            accessibilityRole="button"
                            accessibilityLabel={`Jump to the voice message from @${replyPreview.username}`}
                            onPress={() => scrollToMessage(replyPreview.id)}
                          >
                            <Ionicons
                              name="play"
                              size={15}
                              color={
                                replyPreview.sender_id === currentUserId
                                  ? Bubble.mine.control
                                  : Bubble.theirs.control
                              }
                            />

                            <MiniWaveform
                              waveform={replyPreview.waveform}
                              active={false}
                              progress={0}
                              compact
                              showProgress={false}
                              tint={
                                replyPreview.sender_id === currentUserId
                                  ? Bubble.mine.wave
                                  : Bubble.theirs.wave
                              }
                            />

                            <Text
                              style={[
                                styles.quotedDuration,
                                replyPreview.sender_id === currentUserId &&
                                  styles.myQuotedDuration,
                              ]}
                            >
                              {formatDuration(replyPreview.duration)}
                            </Text>
                          </Touchable>
                        </View>

                        {voiceBubble}
                      </View>
                    ) : (
                      voiceBubble
                    )}

                    {hasCaption && (
                      <SoftAppear
                        rotate={isMine ? '1.2deg' : '-1.2deg'}
                        translateFrom={6}
                        style={[
                          styles.voiceStickyNote,
                          isMine ? styles.myVoiceStickyNote : styles.theirVoiceStickyNote,
                        ]}
                      >
                        <View style={styles.tape} />
                        <Text style={styles.stickyText}>{item.caption}</Text>
                      </SoftAppear>
                    )}

                    {readerMembers.length > 0 && (
                      <Touchable
                        activeOpacity={0.7}
                        onPress={() => showSeenByList(readerMembers)}
                        style={[styles.seenByRow, isMine && styles.seenByRowMine]}
                      >
                        {readerMembers.slice(0, 3).map((member, memberIndex) => (
                          <Avatar
                            key={member.id}
                            avatarUrl={member.avatarUrl}
                            initial={member.username}
                            size={16}
                            textSize={8}
                            borderColor={C.background}
                            style={[
                              styles.seenByAvatar,
                              memberIndex > 0 && styles.seenByAvatarStacked,
                            ]}
                          />
                        ))}

                        {readerMembers.length > 3 && (
                          <View style={styles.seenByExtra}>
                            <Text style={styles.seenByExtraText}>+{readerMembers.length - 3}</Text>
                          </View>
                        )}
                      </Touchable>
                    )}
                  </View>

                  {isMine && senderAvatar}
                </View>
              </SwipeReplyRow>
            );
          }}
        />
      )}

      <View
        style={styles.composer}
        pointerEvents="box-none"
        onLayout={(event) => {
          const nextHeight = event.nativeEvent.layout.height;

          if (nextHeight > 0 && nextHeight !== composerHeight) {
            setComposerHeight(nextHeight);
          }
        }}
      >
        {replyTarget && (
          <SoftAppear
            translateFrom={8}
            scaleFrom={0.98}
            duration={220}
            style={styles.activeReplyAppear}
          >
            <BlurView
              intensity={22}
              tint="systemThinMaterialDark"
              experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
              style={styles.activeReplyBlur}
            >
              <View style={styles.activeReplyGlass}>
                <View style={styles.quoteRail} />

                <Avatar
                  avatarUrl={membersById.get(replyTarget.sender_id)?.avatarUrl ?? null}
                  initial={usernameById.get(replyTarget.sender_id) ?? 'frequency'}
                  size={QUOTE_AVATAR}
                  textSize={9}
                />

                <Text style={styles.activeReplySender} numberOfLines={1}>
                  Replying to @{usernameById.get(replyTarget.sender_id) ?? 'frequency'}
                </Text>

                <View style={styles.activeReplyQuoted}>
                  {replyTarget.caption?.trim() ? (
                    <Text style={styles.quoteCaption} numberOfLines={1}>
                      {replyTarget.caption.trim()}
                    </Text>
                  ) : (
                    <>
                      <TinyWaveform waveform={replyTarget.waveform} />
                      <Text style={styles.quoteDuration}>
                        {formatDuration(replyTarget.duration)}
                      </Text>
                    </>
                  )}
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Cancel reply to @${usernameById.get(replyTarget.sender_id) ?? 'frequency'}`}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={() => {
                    animateReplyPreviewChange();
                    setReplyTargetId(null);
                  }}
                  style={({ pressed }) => [
                    styles.cancelReplyButton,
                    pressed && styles.cancelReplyButtonPressed,
                  ]}
                >
                  <Ionicons name="close" size={12} color={C.text} />
                </Pressable>
              </View>
            </BlurView>
          </SoftAppear>
        )}
        {recordedUri ? (
          <View style={styles.previewPanel}>
            <View style={styles.previewBubble}>
              <View style={styles.playButton}>
                <Ionicons name="checkmark" size={18} color="#0B100D" />
              </View>
              <MiniWaveform waveform={waveform} active={false} progress={0} />
              <Text style={styles.duration}>{formatDuration(seconds)}</Text>
            </View>

            <TextInput
              style={styles.captionInput}
              value={caption}
              onChangeText={(text) => setCaption(text.slice(0, CAPTION_MAX_LENGTH))}
              placeholder="Add a tiny note..."
              placeholderTextColor={C.faint}
              maxLength={CAPTION_MAX_LENGTH}
              selectionColor={C.accent}
            />

            <View style={styles.previewActions}>
              <Touchable
                style={styles.secondaryButton}
                activeOpacity={0.78}
                disabled={composerDisabled}
                onPress={resetComposer}
              >
                <Text style={styles.secondaryButtonText}>Record Again</Text>
              </Touchable>

              <Touchable
                style={[styles.sendButton, composerDisabled && styles.disabledButton]}
                activeOpacity={0.86}
                disabled={composerDisabled}
                onPress={sendWhisper}
              >
                <Ionicons name="arrow-up" size={22} color="#0B100D" />
              </Touchable>
            </View>
          </View>
        ) : (
          <View style={styles.recordDock}>
            <Animated.View
              {...micPanResponder.panHandlers}
              style={[
                styles.recordButtonWrap,
                {
                  transform: [
                    { scale: recordButtonScale },
                    {
                      scale: recordingPulse.interpolate({
                        inputRange: [0, 1],
                        outputRange: recordingActive ? [1, 1.04] : [1, 1],
                      }),
                    },
                  ],
                },
              ]}
            >
              <View style={[styles.recordButton, recordingActive && styles.stopButton]}>
                <Ionicons name="mic" size={28} color={recordingActive ? C.text : '#0B100D'} />
              </View>
            </Animated.View>

            <View style={styles.recordCenter}>
              <View style={styles.recordCenterTop}>
                <Text style={styles.recordTimer}>{formatDuration(seconds)}</Text>
                <MiniWaveform waveform={waveform} active={recordingActive} progress={0} compact />
              </View>
              {(isLockedRecording || recordingActive) && (
                <Text style={styles.recordHint}>
                  {isLockedRecording
                    ? 'Locked. Tap stop when done.'
                    : 'Release to finish'}
                </Text>
              )}
            </View>

            <Touchable
              style={[styles.lockButton, isLockedRecording && styles.lockButtonActive]}
              activeOpacity={0.82}
              disabled={composerDisabled || (!recordingActive && !isLockedRecording)}
              onPress={() => {
                if (isLockedRecording) {
                  void stopRecording();
                  return;
                }
                lockRecording();
              }}
            >
              <Ionicons
                name={isLockedRecording ? 'square' : 'lock-closed-outline'}
                size={26}
                color={isLockedRecording ? C.text : C.accent}
              />
            </Touchable>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.background,
  },

  safeHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: C.background,
    zIndex: 2,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 18,
    gap: 10,
  },

  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },

  headerIdentity: {
    flex: 1,
    minWidth: 0,
  },

  headerName: {
    color: C.text,
    fontSize: 18,
    fontWeight: '900',
  },

  headerSubtitle: {
    color: C.muted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },

  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  messagesContent: {
    flexGrow: 1,
    paddingHorizontal: 22,
    paddingTop: 8,
    paddingBottom: 16,
  },

  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 88,
  },

  emptyTitle: {
    color: C.text,
    fontSize: 20,
    fontWeight: '800',
  },

  emptyCopy: {
    color: C.muted,
    fontSize: 15,
    marginTop: 8,
    textAlign: 'center',
  },

  swipeReplyRow: {
    position: 'relative',
    marginBottom: 10,
  },

  groupedSwipeReplyRow: {
    marginBottom: 8,
  },

  lastSwipeReplyRow: {
    marginBottom: 0,
  },

  // The edge is set by the two variants below rather than here, so a
  // direction change swaps one style instead of overriding an offset with
  // undefined.
  replyGestureIndicator: {
    position: 'absolute',
    top: 26,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(107,168,130,0.12)',
  },

  replyGestureIndicatorRight: {
    left: 12,
  },

  // A left pull uncovers the far edge, so the mark waits there instead.
  replyGestureIndicatorLeft: {
    right: 12,
  },

  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },

  myMessageRow: {
    justifyContent: 'flex-end',
  },

  messageAvatar: {
    marginRight: 10,
    marginTop: 16,
  },

  myMessageAvatar: {
    marginLeft: 10,
    marginRight: 0,
  },

  messageStack: {
    maxWidth: '78%',
    alignItems: 'flex-start',
    position: 'relative',
  },

  messageStackWithSticky: {
    paddingBottom: 18,
  },

  myMessageStack: {
    alignItems: 'flex-end',
  },

  senderLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
    marginLeft: 4,
  },

  senderLabelName: {
    color: C.text,
    fontSize: 13,
    fontWeight: '800',
  },

  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: C.accent,
  },

  voiceBubble: {
    minWidth: 220,
    maxWidth: '100%',
    minHeight: 76,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderRadius: 28,
    backgroundColor: Bubble.theirs.background,
    borderWidth: 1,
    borderColor: Bubble.theirs.border,
  },

  // In a group "theirs" covers everyone else, so the green still means
  // exactly one thing: this one is yours.
  myVoiceBubble: {
    alignSelf: 'flex-end',
    backgroundColor: Bubble.mine.background,
    borderColor: Bubble.mine.border,
  },

  highlightedVoiceBubble: {
    borderColor: C.accentSoft,
    backgroundColor: 'rgba(107,168,130,0.22)',
  },

  replyGroup: {
    maxWidth: '100%',
  },

  replyLabel: {
    marginLeft: REPLY_RAIL_WIDTH + REPLY_RAIL_GAP,
    marginBottom: 6,
    color: C.muted,
    fontSize: 13,
    fontWeight: '600',
  },

  myReplyLabel: {
    alignSelf: 'flex-end',
    marginLeft: 0,
  },

  quotedRow: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: REPLY_RAIL_GAP,
    marginBottom: 8,
  },

  myQuotedRow: {
    alignSelf: 'flex-end',
  },

  replyRail: {
    width: REPLY_RAIL_WIDTH,
    borderRadius: 999,
    backgroundColor: 'rgba(168,205,183,0.28)',
  },

  quotedBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1,
    opacity: 0.88,
  },

  myQuotedBubble: {
    backgroundColor: Bubble.mine.background,
    borderColor: Bubble.mine.border,
  },

  theirQuotedBubble: {
    backgroundColor: Bubble.theirs.background,
    borderColor: Bubble.theirs.border,
  },

  quotedDuration: {
    color: C.muted,
    fontSize: 13,
    fontWeight: '700',
  },

  myQuotedDuration: {
    color: 'rgba(237,248,233,0.82)',
  },

  theirGroupedTopBubble: {
    borderTopLeftRadius: 22,
  },

  theirGroupedBottomBubble: {
    borderBottomLeftRadius: 22,
  },

  myGroupedTopBubble: {
    borderTopRightRadius: 22,
  },

  myGroupedBottomBubble: {
    borderBottomRightRadius: 22,
  },

  voiceAudioRow: {
    minHeight: 48,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  playSlot: {
    width: 44,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },

  playButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Bubble.theirs.control,
  },

  // Brighter than the sage one, which would sink into your own green fill.
  myPlayButton: {
    backgroundColor: Bubble.mine.control,
  },

  waveform: {
    flex: 1,
    minWidth: 0,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    overflow: 'hidden',
  },

  compactWaveform: {
    flex: 0,
    width: 112,
    height: 36,
    justifyContent: 'flex-start',
    gap: 3,
  },

  waveBar: {
    width: 3,
    borderRadius: 999,
  },

  compactWaveBar: {
    width: 2,
  },

  durationSlot: {
    width: 46,
    flexShrink: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },

  duration: {
    color: C.text,
    fontSize: 18,
    fontWeight: '800',
    width: 46,
    textAlign: 'right',
  },

  voiceStickyNote: {
    position: 'absolute',
    bottom: 0,
    marginTop: 0,
    minHeight: 40,
    maxWidth: '78%',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 6,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    zIndex: 2,
  },

  theirVoiceStickyNote: {
    left: 112,
    marginLeft: 0,
    backgroundColor: '#EDF8E9',
  },

  myVoiceStickyNote: {
    right: 76,
    marginRight: 0,
    backgroundColor: '#EDF8E9',
  },

  tape: {
    position: 'absolute',
    top: -7,
    left: -8,
    width: 34,
    height: 11,
    borderRadius: 3,
    backgroundColor: 'rgba(107,168,130,0.62)',
    transform: [{ rotate: '-9deg' }],
  },

  stickyText: {
    color: '#18211B',
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '800',
  },

  seenByRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginTop: 6,
  },

  seenByRowMine: {
    alignSelf: 'flex-end',
  },

  seenByAvatar: {
    borderWidth: 1.5,
  },

  seenByAvatarStacked: {
    marginLeft: -6,
  },

  seenByExtra: {
    marginLeft: -6,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.elevated,
    borderWidth: 1.5,
    borderColor: C.background,
  },

  seenByExtraText: {
    color: C.text,
    fontSize: 8,
    fontWeight: '800',
  },

  composer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 24,
  },

  activeReplyAppear: {
    marginBottom: 10,
  },

  activeReplyBlur: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(226,237,232,0.12)',
    borderTopColor: 'rgba(226,237,232,0.22)',
  },

  activeReplyGlass: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(24,33,27,0.80)',
  },

  quoteRail: {
    alignSelf: 'stretch',
    width: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(168,205,183,0.55)',
  },

  activeReplySender: {
    flexShrink: 1,
    color: C.text,
    fontSize: 12,
    fontWeight: '600',
  },

  // Pushed to the far end of the bar, so the sentence reads left to right
  // and the Echo being answered sits nearest the composer.
  activeReplyQuoted: {
    flexShrink: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 'auto',
  },

  quoteCaption: {
    flexShrink: 1,
    minWidth: 0,
    color: C.muted,
    fontSize: 12,
    fontStyle: 'italic',
  },

  quoteDuration: {
    color: C.faint,
    fontSize: 11,
    fontWeight: '700',
  },

  tinyWaveform: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: 13,
  },

  tinyWaveBar: {
    width: 2,
    borderRadius: 999,
    backgroundColor: C.accent,
  },

  cancelReplyButton: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: 'rgba(226,237,232,0.06)',
  },

  cancelReplyButtonPressed: {
    backgroundColor: 'rgba(226,237,232,0.16)',
  },

  recordDock: {
    minHeight: 112,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 56,
    backgroundColor: '#09110E',
    borderWidth: 1,
    borderColor: 'rgba(107,168,130,0.18)',
  },

  recordButtonWrap: {
    width: 76,
    height: 76,
    borderRadius: 38,
  },

  recordButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.accent,
    shadowColor: C.accent,
    shadowOpacity: 0.34,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },

  stopButton: {
    backgroundColor: 'rgba(36,49,39,0.98)',
    borderWidth: 1,
    borderColor: 'rgba(107,168,130,0.32)',
  },

  recordCenter: {
    flex: 1,
    minWidth: 0,
  },

  recordCenterTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },

  recordTimer: {
    color: C.text,
    fontSize: 26,
    fontWeight: '800',
    minWidth: 60,
  },

  recordHint: {
    color: C.faint,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 12,
  },

  lockButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },

  lockButtonActive: {
    backgroundColor: 'rgba(107,168,130,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(107,168,130,0.28)',
  },

  previewPanel: {
    gap: S.sm,
    padding: 16,
    borderRadius: 32,
    backgroundColor: '#09110E',
    borderWidth: 1,
    borderColor: 'rgba(107,168,130,0.18)',
  },

  previewBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 56,
    paddingHorizontal: 16,
    borderRadius: R.lg,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.divider,
  },

  captionInput: {
    color: C.text,
    fontSize: 15,
    paddingHorizontal: 4,
  },

  previewActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
  },

  secondaryButton: {
    flex: 1,
    height: 48,
    borderRadius: R.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.divider,
  },

  secondaryButtonText: {
    color: C.text,
    fontSize: 14,
    fontWeight: '700',
  },

  sendButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.accent,
  },

  disabledButton: {
    opacity: 0.5,
  },
});
