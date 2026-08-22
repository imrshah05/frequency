import Ionicons from '@expo/vector-icons/Ionicons';
import { Audio, AVPlaybackStatus } from 'expo-av';
import { BlurView } from 'expo-blur';
import * as FileSystem from 'expo-file-system/legacy';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { decode as atob } from 'base-64';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  LayoutAnimation,
  PanResponder,
  Platform,
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
import Avatar from '../../components/Avatar';
import { FrequencyLogoLoader } from '@/components/branding/FrequencyLogo';
import {
  FrequencyBubble as Bubble,
  FrequencyColors as C,
  FrequencyRadius as R,
  FrequencySpacing as S,
} from '../../constants/frequencyTheme';
import { supabase } from '../../lib/supabase';
import { prefetchAudioUrls, withAudioUrl } from '@/lib/audioUrls';
import { resolveDisplayUsername } from '../../lib/profiles';
import { getFallbackWaveform, downsampleWaveform, meteringToAmplitude } from '../../lib/waveform';
import { getOtherWhisperUserId, WhisperThread } from '../../lib/whispers';
import { error as hapticError, light, medium, success } from '@/lib/haptics';
import { requestTuneIn } from '@/lib/tuneIns';
import { useMessageTimeReveal } from '@/hooks/useMessageTimeReveal';
import { useWaveformScrub } from '@/hooks/useWaveformScrub';

const CAPTION_MAX_LENGTH = 60;
const SWIPE_MAX_DISTANCE = 72;
const REPLY_THRESHOLD = 60;

// Enough bars to read as a particular voice rather than a generic squiggle,
// few enough to stay a single quiet line.
const QUOTE_BAR_COUNT = 13;

// The quoted sender's face, at label scale.
const QUOTE_AVATAR = 18;

// The rail beside a reply, and the gutter between it and the bubble. The
// gutter is wide enough that the rail reads as a separate mark rather than
// as part of the bubble's edge.
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

type WhisperMessage = {
  id: string;
  thread_id: string;
  sender_id: string;
  receiver_id: string;
  audio_url: string | null;
  duration: number | null;
  caption: string | null;
  waveform: number[] | null;
  message_type?: 'voice' | 'shared_echo';
  shared_voice_note_id?: string | null;
  audio_path?: string | null;
  reply_to_message_id?: string | null;
  replyPreview?: WhisperReplyPreview | null;
  created_at: string;
  read_at: string | null;
};

type WhisperReplyPreview = {
  id: string;
  sender_id: string;
  username: string;
  duration: number | null;
  caption: string | null;
  waveform: number[] | null;
};

type ProfileRow = {
  id?: string;
  username: string | null;
  avatar_url: string | null;
};

type SharedEcho = {
  id: string;
  title: string;
  creatorId: string;
  creatorUsername: string;
  audioPath: string | null | undefined;
  waveform?: number[] | null;
  canHear: boolean;
  tuneInStatus: 'none' | 'pending' | 'accepted' | 'declined';
};

type EchoEventType = 'play_started' | 'completed' | 'replayed';

function cleanUsername(username: string | null | undefined) {
  return String(username ?? 'frequency').replace(/^@/, '').trim() || 'frequency';
}

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.max(0, seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function buildReplyPreview(
  message: WhisperMessage | undefined,
  usernameById: Map<string, string>
): WhisperReplyPreview | null {
  if (!message || message.message_type !== 'voice') return null;

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
 * The one line above a reply, and deliberately name-free.
 *
 * A thread holds exactly two people whose faces are already beside every
 * bubble, so spelling out a @username says nothing the screen isn't
 * already saying -- it just makes the line long enough to read instead of
 * glance at.
 */
function describeReply(mine: boolean, quotedIsSender: boolean) {
  if (quotedIsSender) return mine ? 'You replied to yourself' : 'Replied to themselves';

  return mine ? 'You replied to them' : 'Replied to you';
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

function getMessageOpacity(index: number, messages: WhisperMessage[], isPlaying: boolean) {
  if (isPlaying) return 1;

  const distanceFromLatest = messages.length - 1 - index;

  if (distanceFromLatest === 0) return 1;
  if (distanceFromLatest === 1) return 0.92;
  return 0.84;
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

function PressScale({
  children,
  containerStyle,
  disabled,
  onPress,
  onLongPress,
  style,
}: {
  children: ReactNode;
  containerStyle?: any;
  disabled?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: any;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  function animate(toValue: number) {
    Animated.timing(scale, {
      toValue,
      duration: 120,
      useNativeDriver: true,
    }).start();
  }

  return (
    <Animated.View style={[containerStyle, { transform: [{ scale }] }]}>
      <Pressable
        disabled={disabled}
        onPress={onPress}
        onLongPress={onLongPress}
        onPressIn={() => animate(0.97)}
        onPressOut={() => animate(1)}
        style={style}
      >
        {children}
      </Pressable>
    </Animated.View>
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

/**
 * The quoted Whisper itself: its own waveform, shrunk to a silhouette.
 *
 * A voice note has no line of text to quote, so quoting one used to mean
 * describing it -- "Voice note · 0:01" -- which says almost nothing about
 * which note it was. Its shape does, and it reads at a glance.
 */
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
 * Swipe a message to answer it.
 *
 * The direction is not decorative: your own Whispers pull left, everyone
 * else's pull right. Quoting yourself and quoting the person you are
 * talking to are different acts, and a bubble that already sits on the
 * right has nowhere to go but inward, so the gesture matches the side the
 * message lives on.
 */
function SwipeReplyRow({
  children,
  shared = false,
  grouped = false,
  beforeShared = false,
  last = false,
  replyEligible = false,
  direction = 'right',
  onReply,
}: {
  children: ReactNode;
  shared?: boolean;
  grouped?: boolean;
  beforeShared?: boolean;
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
        shared && styles.sharedSwipeReplyRow,
        beforeShared && styles.beforeSharedSwipeReplyRow,
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
      <Animated.View
        style={{ transform: [{ translateX }] }}
        {...panResponder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}

export default function WhisperThreadScreen() {
  const params = useLocalSearchParams<{
    threadId?: string | string[];
    otherUserId?: string | string[];
  }>();
  const threadId = useMemo(() => {
    const raw = params.threadId;
    return Array.isArray(raw) ? raw[0] ?? '' : raw ?? '';
  }, [params.threadId]);
  const paramOtherUserId = useMemo(() => {
    const raw = params.otherUserId;
    return Array.isArray(raw) ? raw[0] ?? '' : raw ?? '';
  }, [params.otherUserId]);

  const [currentUserId, setCurrentUserId] = useState('');
  const [currentUsername, setCurrentUsername] = useState('frequency');
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState<string | null>(null);
  const [otherUserId, setOtherUserId] = useState(paramOtherUserId);
  const [otherUsername, setOtherUsername] = useState('frequency');
  const [otherAvatarUrl, setOtherAvatarUrl] = useState<string | null>(null);
  const [messages, setMessages] = useState<WhisperMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recordingIntent, setRecordingIntent] = useState(false);
  const [isLockedRecording, setIsLockedRecording] = useState(false);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [caption, setCaption] = useState('');
  const [composerHeight, setComposerHeight] = useState(0);
  const [waveform, setWaveform] = useState<number[] | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [isSoundPlaying, setIsSoundPlaying] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [sharedEchoesById, setSharedEchoesById] = useState<Record<string, SharedEcho>>({});
  const [requestingTuneInId, setRequestingTuneInId] = useState<string | null>(null);
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const { revealedMessageId, revealMessageTime } = useMessageTimeReveal();

  const soundRef = useRef<Audio.Sound | null>(null);
  const playingIdRef = useRef<string | null>(null);
  const seekingRef = useRef(false);
  const pendingSeekRef = useRef<{
    playbackId: string;
    audioPath: string | null | undefined;
    voiceNoteId?: string;
    fraction: number;
  } | null>(null);
  const durationMillisRef = useRef<number | null>(null);
  const sharedEchoPlaybackRef = useRef<{
    voiceNoteId: string;
    completed: boolean;
  } | null>(null);
  const playedSharedEchoIdsRef = useRef<Record<string, boolean>>({});
  const waveformSamplesRef = useRef<number[]>([]);
  const listRef = useRef<FlatList<WhisperMessage>>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const isStartingRecordingRef = useRef(false);
  const pendingStopRef = useRef(false);
  const recordingStartedAtRef = useRef(0);
  const isLockedRecordingRef = useRef(false);
  const recordButtonScale = useRef(new Animated.Value(1)).current;
  const recordingPulse = useRef(new Animated.Value(0)).current;
  const recordingActive = recordingIntent || !!recording;
  const usernameById = useMemo(
    () => new Map([[currentUserId, currentUsername], [otherUserId, otherUsername]]),
    [currentUserId, currentUsername, otherUserId, otherUsername]
  );
  const replyTarget = useMemo(
    () => messages.find((message) => message.id === replyTargetId) ?? null,
    [messages, replyTargetId]
  );

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

  useEffect(
    () => () => {
      const activeRecording = recordingRef.current;
      recordingRef.current = null;

      if (activeRecording) {
        void activeRecording.stopAndUnloadAsync().catch(() => {
          // Best effort cleanup when leaving an active recording screen.
        });
      }
    },
    []
  );

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
    sharedEchoPlaybackRef.current = null;
    setPlayingId(null);
    setIsSoundPlaying(false);
    setPlaybackProgress(0);
  }

  async function insertEchoEvent(voiceNoteId: string, eventType: EchoEventType) {
    if (!currentUserId) return;

    await supabase.from('echo_events').insert({
      voice_note_id: voiceNoteId,
      user_id: currentUserId,
      event_type: eventType,
    });
  }

  async function recordSharedEchoPlaybackStarted(voiceNoteId: string) {
    try {
      if (!currentUserId) return;

      const playedInSession = !!playedSharedEchoIdsRef.current[voiceNoteId];
      let playedBefore = playedInSession;

      if (!playedBefore) {
        const { count } = await supabase
          .from('echo_events')
          .select('*', { count: 'exact', head: true })
          .eq('voice_note_id', voiceNoteId)
          .eq('user_id', currentUserId)
          .eq('event_type', 'play_started');

        playedBefore = (count ?? 0) > 0;
      }

      await insertEchoEvent(voiceNoteId, 'play_started');
      playedSharedEchoIdsRef.current[voiceNoteId] = true;

      if (playedBefore) {
        await insertEchoEvent(voiceNoteId, 'replayed');
      }
    } catch {
      // Echo Impact tracking should not interrupt Whispers playback.
    }
  }

  async function recordSharedEchoCompleted(voiceNoteId: string) {
    try {
      await insertEchoEvent(voiceNoteId, 'completed');
    } catch {
      // Echo Impact tracking should not interrupt Whispers playback.
    }
  }

  async function loadSharedEchoes(messageRows: WhisperMessage[], viewerId: string) {
    const sharedEchoIds = [
      ...new Set(
        messageRows
          .filter((message) => message.message_type === 'shared_echo')
          .map((message) => message.shared_voice_note_id)
          .filter(Boolean) as string[]
      ),
    ];

    if (sharedEchoIds.length === 0) {
      setSharedEchoesById({});
      return;
    }

    const { data: echoData } = await supabase
      .from('voice_notes')
      .select('id, user_id, username, audio_url, audio_path, caption, waveform')
      .in('id', sharedEchoIds);

    const echoRows = (echoData ?? []) as {
      id: string;
      user_id: string;
      username: string | null;
      audio_url: string;
      audio_path?: string | null;
      caption: string | null;
      waveform?: number[] | null;
    }[];
    const creatorIds = [...new Set(echoRows.map((echo) => echo.user_id))];

    const [{ data: profileData }, { data: tuneInData }] = await Promise.all([
      creatorIds.length > 0
        ? supabase
            .from('profiles')
            .select('id, username')
            .in('id', creatorIds)
        : Promise.resolve({ data: [] }),
      creatorIds.length > 0
        ? supabase
            .from('tune_ins')
            .select('frequency_owner_id, status')
            .eq('listener_id', viewerId)
            .in('frequency_owner_id', creatorIds)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [] }),
    ]);

    const profileById = new Map(
      ((profileData ?? []) as ProfileRow[]).map((profile) => [profile.id, profile])
    );
    const tuneInStatusByOwnerId: Record<string, SharedEcho['tuneInStatus']> = {};
    ((tuneInData ?? []) as {
      frequency_owner_id: string;
      status: SharedEcho['tuneInStatus'];
    }[]).forEach((tuneIn) => {
      if (!tuneInStatusByOwnerId[tuneIn.frequency_owner_id]) {
        tuneInStatusByOwnerId[tuneIn.frequency_owner_id] = tuneIn.status;
      }
    });

    const nextSharedEchoes = echoRows.reduce<Record<string, SharedEcho>>((acc, echo) => {
      const tuneInStatus = tuneInStatusByOwnerId[echo.user_id] ?? 'none';
      const creatorUsername = cleanUsername(
        profileById.get(echo.user_id)?.username ?? echo.username
      );

      acc[echo.id] = {
        id: echo.id,
        title: echo.caption?.trim() || 'Untitled Echo',
        creatorId: echo.user_id,
        creatorUsername,
        audioPath: echo.audio_path,
        waveform: echo.waveform,
        canHear: viewerId === echo.user_id || tuneInStatus === 'accepted',
        tuneInStatus,
      };

      return acc;
    }, {});

    void prefetchAudioUrls(Object.values(nextSharedEchoes).map((echo) => echo.audioPath));
    setSharedEchoesById(nextSharedEchoes);
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

    const { data: threadData, error: threadError } = await supabase
      .from('whisper_threads')
      .select('*')
      .eq('id', threadId)
      .maybeSingle();

    if (threadError || !threadData) {
      Alert.alert('Whisper Error', threadError?.message ?? 'Thread not found.');
      setLoading(false);
      return;
    }

    const thread = threadData as WhisperThread;
    const nextOtherUserId = getOtherWhisperUserId(thread, me);

    const [{ data: profileData }, { data: messageData, error: messagesError }] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, username, avatar_url')
        .in('id', [me, nextOtherUserId]),
      supabase
        .from('whisper_messages')
        .select('*')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true }),
    ]);

    if (messagesError) {
      Alert.alert('Whisper Error', messagesError.message);
      setLoading(false);
      return;
    }

    setCurrentUserId(me);
    setOtherUserId(nextOtherUserId);
    const profilesById = new Map(
      ((profileData ?? []) as ProfileRow[]).map((profile) => [profile.id, profile])
    );
    const currentProfile = profilesById.get(me);
    const otherProfile = profilesById.get(nextOtherUserId);

    setCurrentUsername(cleanUsername(resolveDisplayUsername({
      username: currentProfile?.username,
      email: userData.user?.email,
    })));
    setCurrentAvatarUrl(currentProfile?.avatar_url ?? null);
    setOtherUsername(cleanUsername(otherProfile?.username));
    setOtherAvatarUrl(otherProfile?.avatar_url ?? null);
    const nextMessages = (messageData ?? []) as WhisperMessage[];
    const nextMessageById = new Map(nextMessages.map((message) => [message.id, message]));
    const loadedUsernameById = new Map([
      [me, cleanUsername(currentProfile?.username)],
      [nextOtherUserId, cleanUsername(otherProfile?.username)],
    ]);
    nextMessages.forEach((message) => {
      if (message.reply_to_message_id) {
        message.replyPreview = buildReplyPreview(
          nextMessageById.get(message.reply_to_message_id),
          loadedUsernameById
        );
      }
    });
    void prefetchAudioUrls(nextMessages.map((message) => message.audio_path));
    setMessages(nextMessages);
    setLoading(false);
    await loadSharedEchoes(nextMessages, me);

    await supabase
      .from('whisper_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('thread_id', threadId)
      .eq('receiver_id', me)
      .is('read_at', null);
  }, [threadId]);

  useFocusEffect(
    useCallback(() => {
      loadThread();

      return () => {
        stopCurrentSound();
      };
    }, [loadThread])
  );

  useEffect(() => {
    if (!threadId || !currentUserId) return;

    const channel = supabase
      .channel(`whisper-thread-${threadId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'whisper_messages',
          filter: `thread_id=eq.${threadId}`,
        },
        (payload) => {
          const inserted = payload.new as WhisperMessage;
          if (!inserted.id) return;

          setMessages((current) => {
            if (current.some((message) => message.id === inserted.id)) return current;
            return [
              ...current,
              {
                ...inserted,
                replyPreview: inserted.reply_to_message_id
                  ? buildReplyPreview(
                      current.find((message) => message.id === inserted.reply_to_message_id),
                      usernameById
                    )
                  : null,
              },
            ];
          });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [currentUserId, threadId, usernameById]);

  function selectReplyTarget(message: WhisperMessage) {
    if (message.message_type !== 'voice' || !message.audio_url) return;
    animateReplyPreviewChange();
    setReplyTargetId(message.id);
    void light();
  }

  function scrollToMessage(messageId: string) {
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
    setHighlightedMessageId(messageId);
    setTimeout(() => {
      setHighlightedMessageId((current) => (current === messageId ? null : current));
    }, 900);
  }

  async function playAudio(
    playbackId: string,
    audioPath: string | null | undefined,
    voiceNoteId?: string,
    seekFraction?: number
  ) {
    await stopCurrentSound();
    setPlayingId(playbackId);
    playingIdRef.current = playbackId;
    setPlaybackProgress(Math.max(0, Math.min(1, seekFraction ?? 0)));

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
    });

    const created = await withAudioUrl(audioPath, (uri) =>
      Audio.Sound.createAsync({ uri })
    );

    if (!created) {
      setPlayingId(null);
      playingIdRef.current = null;
      return;
    }

    const { sound, status: initialStatus } = created;

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

    if (voiceNoteId) {
      sharedEchoPlaybackRef.current = {
        voiceNoteId,
        completed: false,
      };
      void recordSharedEchoPlaybackStarted(voiceNoteId);
    }

    sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
      if (!status.isLoaded) return;

      if (status.durationMillis) {
        durationMillisRef.current = status.durationMillis;
      }

      if (playingIdRef.current === playbackId && !seekingRef.current) {
        setPlaybackProgress(
          status.durationMillis ? status.positionMillis / status.durationMillis : 0
        );
      }

      if (status.didJustFinish) {
        if (
          voiceNoteId &&
          sharedEchoPlaybackRef.current?.voiceNoteId === voiceNoteId &&
          !sharedEchoPlaybackRef.current.completed
        ) {
          sharedEchoPlaybackRef.current.completed = true;
          void recordSharedEchoCompleted(voiceNoteId);
        }

        stopCurrentSound();
      }
    });
  }

  async function toggleAudio(
    playbackId: string,
    audioPath: string | null | undefined,
    voiceNoteId?: string
  ) {
    if (playingIdRef.current === playbackId && soundRef.current) {
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

    await playAudio(playbackId, audioPath, voiceNoteId);
  }

  async function seekAudio(
    playbackId: string,
    audioPath: string | null | undefined,
    voiceNoteId: string | undefined,
    fraction: number
  ) {
    const clamped = Math.max(0, Math.min(1, fraction));

    if (playingIdRef.current !== playbackId || !soundRef.current) {
      await playAudio(playbackId, audioPath, voiceNoteId, clamped);
      return;
    }

    setPlaybackProgress(clamped);

    if (seekingRef.current) {
      pendingSeekRef.current = { playbackId, audioPath, voiceNoteId, fraction: clamped };
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
        void seekAudio(pending.playbackId, pending.audioPath, pending.voiceNoteId, pending.fraction);
      }
    }
  }

  async function playMessage(message: WhisperMessage) {
    if (!message.audio_url) return;

    await toggleAudio(message.id, message.audio_path);
  }

  async function requestTuneInForEcho(echo: SharedEcho) {
    if (requestingTuneInId || echo.tuneInStatus === 'pending') return;

    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    if (!user) {
      void hapticError();
      Alert.alert('Login needed', 'Please log in again.');
      return;
    }

    if (user.id === echo.creatorId) return;

    setRequestingTuneInId(echo.id);

    try {
      const result = await requestTuneIn(echo.creatorId);

      setSharedEchoesById((current) => ({
        ...current,
        [echo.id]: {
          ...echo,
          tuneInStatus: result.status,
        },
      }));
      setRequestingTuneInId(null);
      if (result.status === 'pending') void light();
    } catch (error) {
      setRequestingTuneInId(null);
      void hapticError();
      Alert.alert(
        'Tune In Error',
        error instanceof Error ? error.message : 'Could not send request.'
      );
    }
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
      recordingStartedAtRef.current = Date.now();
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

      await nextRecording.prepareToRecordAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      nextRecording.setProgressUpdateInterval(90);
      nextRecording.setOnRecordingStatusUpdate((status) => {
        const metering = (status as Audio.RecordingStatus & { metering?: number })
          .metering;

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
    } catch (error: any) {
      setRecordingIntent(false);
      void hapticError();
      Alert.alert('Recording Error', error.message);
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
    } catch (error: any) {
      recordingRef.current = null;
      pendingStopRef.current = false;
      isLockedRecordingRef.current = false;
      setIsLockedRecording(false);
      setRecordingIntent(false);
      setRecording(null);
      void hapticError();
      Alert.alert('Stop Error', error.message);
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
      !composerDisabled &&
      !recordedUri &&
      (Math.abs(gesture.dy) > 6 || Math.abs(gesture.dx) > 6),
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

      if (isLockedRecordingRef.current) {
        return;
      }

      void stopRecording();
    },
    onPanResponderTerminate: () => {
      animateRecordButton(1);

      if (isLockedRecordingRef.current) {
        return;
      }

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

  async function sendWhisper() {
    if (!recordedUri || !currentUserId || !otherUserId || sending) return;

    void light();

    try {
      setSending(true);

      const base64Audio = await FileSystem.readAsStringAsync(recordedUri, {
        encoding: 'base64',
      } as any);
      const audioBuffer = base64ToArrayBuffer(base64Audio);
      const fileName = `whispers/${currentUserId}/${Date.now()}.m4a`;

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

      const { data: publicUrlData } = supabase.storage
        .from('voice-notes')
        .getPublicUrl(fileName);

      const cleanCaption = caption.trim();
      const { data: message, error: messageError } = await supabase
        .from('whisper_messages')
        .insert({
          thread_id: threadId,
          sender_id: currentUserId,
          receiver_id: otherUserId,
          audio_url: publicUrlData.publicUrl,
          audio_path: fileName,
          duration: Math.max(1, seconds),
          caption: cleanCaption || null,
          waveform,
          reply_to_message_id: replyTargetId,
        })
        .select('*')
        .single();

      if (messageError) {
        void hapticError();
        Alert.alert('Whisper Error', messageError.message);
        setSending(false);
        return;
      }

      const sentMessage = message as WhisperMessage;
      sentMessage.replyPreview = buildReplyPreview(replyTarget ?? undefined, usernameById);
      setMessages((prev) => [...prev, sentMessage]);
      resetComposer();
      animateReplyPreviewChange();
      setReplyTargetId(null);
      setSending(false);
      void success();
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch (error: any) {
      void hapticError();
      Alert.alert('Unexpected Error', error.message);
      setSending(false);
    }
  }

  const composerDisabled = sending || loading;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <SafeAreaView edges={['top']} style={styles.safeHeader}>
        <View style={styles.header}>
          <BackButton style={styles.backButton} />

          <Avatar
            avatarUrl={otherAvatarUrl}
            initial={otherUsername}
            size={48}
            textSize={20}
            style={styles.headerAvatar}
          />

          <View style={styles.headerIdentity}>
            <Text style={styles.headerName} numberOfLines={1} ellipsizeMode="tail">
              @{otherUsername}
            </Text>
          </View>
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
          contentContainerStyle={[styles.messagesContent, { paddingBottom: composerHeight + 16 }]}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item, index }) => {
            const mine = item.sender_id === currentUserId;
            const hasCaption = !!item.caption?.trim();
            const sharedEcho = item.shared_voice_note_id
              ? sharedEchoesById[item.shared_voice_note_id]
              : null;
            const previousMessageSameSender =
              index > 0 && messages[index - 1]?.sender_id === item.sender_id;
            const nextMessage = messages[index + 1];
            const nextMessageSameSender =
              index < messages.length - 1 && nextMessage?.sender_id === item.sender_id;
            const nextMessageIsSharedEcho = nextMessage?.message_type === 'shared_echo';
            const isFirstInGroup = !previousMessageSameSender;
            const isLastInGroup = !nextMessageSameSender;
            const isLoadedMessage = playingId === item.id;
            const isPlayingMessage = isLoadedMessage && isSoundPlaying;
            const showSentAt = revealedMessageId === item.id;
            const revealSentAt = () => revealMessageTime(item.id);
            const isLastMessage = index === messages.length - 1;
            const senderUsername = mine ? currentUsername : otherUsername;
            const senderAvatarUrl = mine ? currentAvatarUrl : otherAvatarUrl;
            const senderAvatar = (
              <Avatar
                avatarUrl={senderAvatarUrl}
                initial={senderUsername}
                size={36}
                textSize={14}
                style={[styles.messageAvatar, mine && styles.myMessageAvatar]}
              />
            );
            const replyPreview = item.replyPreview ?? (
              item.reply_to_message_id
                ? buildReplyPreview(
                    messages.find((message) => message.id === item.reply_to_message_id),
                    usernameById
                  )
                : null
            );

            if (item.message_type === 'shared_echo') {
              const canHear = !!sharedEcho?.canHear;
              const isPlayingSharedEcho = isPlayingMessage;
              const tuneInPending = sharedEcho?.tuneInStatus === 'pending';

              return (
              <SwipeReplyRow
                shared
                grouped={nextMessageSameSender}
                last={isLastMessage}
                replyEligible={false}
              >
                  <View style={[styles.messageRow, styles.sharedMessageRow, mine && styles.myMessageRow]}>
                    {!mine && senderAvatar}

                    <View style={[styles.sharedMessageStack, mine && styles.myMessageStack]}>
                      <SoftAppear style={styles.sharedEchoAppear}>
                        <Pressable
                          style={[styles.sharedEchoCard, mine && styles.mySharedEchoCard]}
                          onLongPress={revealSentAt}
                        >
                          <View pointerEvents="none" style={styles.sharedEchoGlow} />
                        <View style={styles.sharedEchoTop}>
                          <View style={styles.sharedEchoMeta}>
                            <Text style={styles.sharedEchoLabel} numberOfLines={1}>
                              SHARED ECHO
                            </Text>
                            <Text
                              style={styles.sharedEchoCreator}
                              numberOfLines={1}
                              ellipsizeMode="tail"
                            >
                              @{sharedEcho?.creatorUsername ?? 'frequency'}
                            </Text>
                          </View>

                          <View style={styles.sharedEchoMark}>
                            <Ionicons
                              name={
                                canHear
                                  ? 'radio-outline'
                                  : item.shared_voice_note_id && !sharedEcho
                                    ? 'close-circle-outline'
                                    : 'lock-closed-outline'
                              }
                              size={18}
                              color={C.text}
                            />
                          </View>
                        </View>

                        <Text style={styles.sharedEchoTitle} numberOfLines={2}>
                          {item.shared_voice_note_id && !sharedEcho
                            ? 'This Echo is no longer available'
                            : sharedEcho?.title ?? 'Echo unavailable'}
                        </Text>

                        {canHear && sharedEcho ? (
                          <PressScale
                            containerStyle={styles.sharedEchoPlayWrap}
                            style={styles.sharedEchoPlay}
                            onPress={() => toggleAudio(item.id, sharedEcho.audioPath, sharedEcho.id)}
                            onLongPress={revealSentAt}
                          >
                            <View style={styles.sharedEchoPlayButton}>
                              <Ionicons
                                name={isPlayingSharedEcho ? 'pause' : 'play'}
                                size={18}
                                color="#0B100D"
                              />
                            </View>
                            <MiniWaveform
                              waveform={sharedEcho.waveform}
                              active={isLoadedMessage}
                              progress={isLoadedMessage ? playbackProgress : 0}
                              onSeek={(fraction) => {
                                void seekAudio(item.id, sharedEcho.audioPath, sharedEcho.id, fraction);
                              }}
                              onLongPress={revealSentAt}
                            />
                          </PressScale>
                        ) : (
                          <View style={styles.lockedEcho}>
                            <Text style={styles.lockedEchoText}>
                              {item.shared_voice_note_id && !sharedEcho
                                ? 'This Echo is no longer available.'
                                : `Tune into @${sharedEcho?.creatorUsername ?? 'frequency'} to hear this Echo.`}
                            </Text>
                            {sharedEcho && currentUserId !== sharedEcho.creatorId && (
                              <Touchable
                                style={[
                                  styles.tuneInButton,
                                  tuneInPending && styles.tuneInButtonPending,
                                ]}
                                activeOpacity={0.84}
                                disabled={tuneInPending || requestingTuneInId === sharedEcho.id}
                                onPress={() => requestTuneInForEcho(sharedEcho)}
                              >
                                <Text style={styles.tuneInButtonText}>
                                  {tuneInPending ? 'Requested' : 'Tune In'}
                                </Text>
                              </Touchable>
                            )}
                          </View>
                        )}

                        <MessageTimeReveal createdAt={item.created_at} visible={showSentAt} />
                        </Pressable>
                      </SoftAppear>

                      {hasCaption && (
                        <SoftAppear
                          rotate={mine ? '1.2deg' : '-1.2deg'}
                          style={[
                            styles.stickyNote,
                            styles.sharedEchoStickyNote,
                            mine ? styles.myStickyNote : styles.theirStickyNote,
                          ]}
                        >
                          <View style={styles.tape} />
                          <Text style={styles.stickyText}>{item.caption}</Text>
                        </SoftAppear>
                      )}
                    </View>
                    {mine && senderAvatar}
                  </View>
                </SwipeReplyRow>
              );
            }

            const voiceBubble = (
              <PressScale
                style={[
                  styles.voiceBubble,
                  mine && styles.myVoiceBubble,
                  !isFirstInGroup && (mine ? styles.myGroupedTopBubble : styles.theirGroupedTopBubble),
                  !isLastInGroup && (mine ? styles.myGroupedBottomBubble : styles.theirGroupedBottomBubble),
                  highlightedMessageId === item.id && styles.highlightedVoiceBubble,
                  { opacity: getMessageOpacity(index, messages, isPlayingMessage) },
                ]}
                onPress={() => playMessage(item)}
                onLongPress={revealSentAt}
              >
                <View style={styles.voiceAudioRow}>
                  <View style={styles.playSlot}>
                    <View style={[styles.playButton, mine && styles.myPlayButton]}>
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
                    onSeek={
                      item.audio_url
                        ? (fraction) => {
                            void seekAudio(item.id, item.audio_path as string, undefined, fraction);
                          }
                        : undefined
                    }
                    onLongPress={revealSentAt}
                    tint={mine ? Bubble.mine.wave : Bubble.theirs.wave}
                    playedTint={mine ? Bubble.mine.wavePlayed : Bubble.theirs.wavePlayed}
                  />

                  <View style={styles.durationSlot}>
                    <Text style={styles.duration}>{formatDuration(item.duration ?? 0)}</Text>
                  </View>
                </View>

                <MessageTimeReveal createdAt={item.created_at} visible={showSentAt} />
              </PressScale>
            );

            return (
              <SwipeReplyRow
                grouped={nextMessageSameSender}
                beforeShared={nextMessageIsSharedEcho}
                last={isLastMessage}
                replyEligible
                direction={mine ? 'left' : 'right'}
                onReply={() => selectReplyTarget(item)}
              >
                <View style={[styles.messageRow, mine && styles.myMessageRow]}>
                  {!mine && senderAvatar}

                  <View
                    style={[
                      styles.messageStack,
                      hasCaption && styles.messageStackWithSticky,
                      mine && styles.myMessageStack,
                    ]}
                  >
                    {replyPreview ? (
                      <View style={styles.replyGroup}>
                        <Text
                          style={[styles.replyLabel, mine && styles.myReplyLabel]}
                          numberOfLines={1}
                        >
                          {describeReply(mine, replyPreview.sender_id === item.sender_id)}
                        </Text>

                        {/* The Whisper being answered, drawn as its own
                            smaller bubble in its sender's colour, with the
                            rail running down beside it. Tapping it jumps to
                            the original. */}
                        <View style={[styles.quotedRow, mine && styles.myQuotedRow]}>
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
                              {formatDuration(replyPreview.duration ?? 0)}
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
                        rotate={mine ? '1.2deg' : '-1.2deg'}
                        style={[
                          styles.stickyNote,
                          styles.voiceStickyNote,
                          mine ? styles.myVoiceStickyNote : styles.theirVoiceStickyNote,
                        ]}
                      >
                        <View style={[styles.tape, styles.voiceTape]} />
                        <Text style={styles.voiceStickyText}>{item.caption}</Text>
                      </SoftAppear>
                    )}
                  </View>
                  {mine && senderAvatar}
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
                  avatarUrl={
                    replyTarget.sender_id === currentUserId ? currentAvatarUrl : otherAvatarUrl
                  }
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
                        {formatDuration(replyTarget.duration ?? 0)}
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
              <View style={styles.playSlot}>
                <View style={styles.playButton}>
                  <Ionicons name="checkmark" size={20} color="#0B100D" />
                </View>
              </View>
              <MiniWaveform waveform={waveform} active={false} progress={0} />
              <View style={styles.durationSlot}>
                <Text style={styles.duration}>{formatDuration(seconds)}</Text>
              </View>
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
                <Ionicons
                  name={recordingActive ? 'mic' : 'mic'}
                  size={28}
                  color={recordingActive ? C.text : '#0B100D'}
                />
              </View>
            </Animated.View>

            <View style={styles.recordCenter}>
              <View style={styles.recordCenterTop}>
                <Text style={styles.recordTimer}>{formatDuration(seconds)}</Text>
                <MiniWaveform
                  waveform={waveform}
                  active={recordingActive}
                  progress={0}
                  compact
                  showProgress={false}
                />
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
    backgroundColor: 'transparent',
    zIndex: 2,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 22,
    backgroundColor: 'transparent',
  },

  backButton: {
    marginRight: 8,
  },

  headerAvatar: {
    borderWidth: 1,
    borderColor: 'rgba(107,168,130,0.24)',
  },

  headerIdentity: {
    flex: 1,
    minWidth: 0,
    marginLeft: 10,
  },

  headerName: {
    color: C.text,
    fontSize: 22,
    fontWeight: '900',
  },

  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  messagesContent: {
    paddingHorizontal: 22,
    paddingTop: 8,
    paddingBottom: 8,
  },

  swipeReplyRow: {
    marginBottom: 10,
  },

  sharedSwipeReplyRow: {
    marginBottom: 20,
  },

  beforeSharedSwipeReplyRow: {
    marginBottom: 24,
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

  sharedMessageRow: {
    width: '100%',
    marginBottom: 0,
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

  sharedMessageStack: {
    flex: 1,
    width: '100%',
    minWidth: 0,
    alignItems: 'flex-start',
  },

  sharedEchoAppear: {
    alignSelf: 'stretch',
    width: '100%',
  },

  myMessageStack: {
    alignItems: 'flex-end',
  },

  voiceBubble: {
    minWidth: 260,
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

  myVoiceBubble: {
    alignSelf: 'flex-end',
    backgroundColor: Bubble.mine.background,
    borderColor: Bubble.mine.border,
  },

  highlightedVoiceBubble: {
    borderColor: C.accentSoft,
    backgroundColor: 'rgba(107,168,130,0.22)',
  },

  // A reply is a label above the bubble and a rail beside it -- nothing
  // goes inside. Anything nested within the bubble reads as a second card
  // stacked in the first, which is what made replies feel cluttered.
  // No alignSelf: the stack already aligns its children to the speaker's
  // side, and pinning it here would drag your own replies to the left.
  replyGroup: {
    maxWidth: '100%',
  },

  // Indented past the rail's gutter so it lines up with the quoted
  // bubble's leading edge rather than with the rail.
  replyLabel: {
    marginLeft: REPLY_RAIL_WIDTH + REPLY_RAIL_GAP,
    marginBottom: 6,
    color: C.muted,
    fontSize: 13,
    fontWeight: '600',
  },

  quotedRow: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: REPLY_RAIL_GAP,
    marginBottom: 8,
  },

  // Your own quote hugs the same edge your bubbles do, so the pair reads
  // as one block instead of a quote adrift on the far side.
  myQuotedRow: {
    alignSelf: 'flex-end',
  },

  myReplyLabel: {
    alignSelf: 'flex-end',
    marginLeft: 0,
  },

  // Runs the full height of the quoted bubble, tying it to the reply
  // underneath so the two read as one exchange.
  replyRail: {
    width: REPLY_RAIL_WIDTH,
    borderRadius: 999,
    backgroundColor: 'rgba(168,205,183,0.28)',
  },

  // Smaller than a live bubble and slightly held back, so a quote never
  // competes with the Whisper actually being said. Its colour comes from
  // whoever recorded it, which is what makes the pairing legible at a
  // glance: green above neutral means they answered you.
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

  quoteRail: {
    alignSelf: 'stretch',
    width: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(168,205,183,0.55)',
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

  duration: {
    color: C.text,
    fontSize: 18,
    fontWeight: '800',
    width: 46,
    textAlign: 'right',
  },

  durationSlot: {
    width: 46,
    flexShrink: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },

  stickyNote: {
    marginTop: -10,
    maxWidth: 214,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(17,22,20,0.1)',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },

  theirStickyNote: {
    marginLeft: 88,
    backgroundColor: '#EDF8E9',
  },

  myStickyNote: {
    marginRight: 66,
    backgroundColor: '#EDF8E9',
  },

  tape: {
    position: 'absolute',
    top: -9,
    left: -5,
    width: 44,
    height: 14,
    borderRadius: 3,
    backgroundColor: 'rgba(107,168,130,0.56)',
    transform: [{ rotate: '-9deg' }],
  },

  stickyText: {
    color: '#18211B',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
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

  voiceTape: {
    top: -7,
    left: -8,
    width: 34,
    height: 11,
    borderRadius: 3,
    backgroundColor: 'rgba(107,168,130,0.62)',
  },

  voiceStickyText: {
    color: '#18211B',
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '800',
  },

  // Same two sides as a voice bubble. The play row inside stays dark on
  // both, so the Echo's own waveform needs no adjusting.
  sharedEchoCard: {
    width: '100%',
    alignSelf: 'stretch',
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 24,
    borderRadius: 32,
    backgroundColor: Bubble.theirs.background,
    borderWidth: 1,
    borderColor: Bubble.theirs.border,
    overflow: 'hidden',
  },

  mySharedEchoCard: {
    backgroundColor: Bubble.mine.background,
    borderColor: Bubble.mine.border,
  },

  sharedEchoGlow: {
    position: 'absolute',
    right: -36,
    bottom: -38,
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: 'rgba(107,168,130,0.12)',
  },

  sharedEchoTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingRight: 60,
  },

  sharedEchoMeta: {
    flex: 1,
    minWidth: 0,
  },

  sharedEchoLabel: {
    color: C.accentSoft,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  sharedEchoCreator: {
    color: C.muted,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 10,
  },

  sharedEchoMark: {
    position: 'absolute',
    top: 22,
    right: 24,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(226,237,232,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(226,237,232,0.08)',
  },

  sharedEchoTitle: {
    color: C.text,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '900',
    marginTop: 34,
  },

  sharedEchoStickyNote: {
    marginTop: -10,
    maxWidth: 226,
  },

  sharedEchoPlay: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 32,
    paddingHorizontal: 18,
    borderRadius: 36,
    backgroundColor: 'rgba(2,7,5,0.62)',
  },

  sharedEchoPlayWrap: {
    alignSelf: 'stretch',
  },

  sharedEchoPlayButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.accent,
  },

  lockedEcho: {
    marginTop: 20,
    padding: 14,
    borderRadius: 20,
    backgroundColor: 'rgba(17,22,20,0.48)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },

  lockedEchoText: {
    color: C.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },

  tuneInButton: {
    alignSelf: 'flex-start',
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 19,
    backgroundColor: C.accent,
    marginTop: 14,
  },

  tuneInButtonPending: {
    opacity: 0.58,
  },

  tuneInButtonText: {
    color: '#0B100D',
    fontSize: 13,
    fontWeight: '900',
  },

  composer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    backgroundColor: 'transparent',
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

  activeReplySender: {
    flexShrink: 1,
    color: C.text,
    fontSize: 12,
    fontWeight: '600',
  },

  // Pushed to the far end of the bar, so the sentence reads left to right
  // and the Whisper being answered sits nearest the composer.
  activeReplyQuoted: {
    flexShrink: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 'auto',
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
    gap: S.md,
    padding: 16,
    borderRadius: 32,
    backgroundColor: '#09110E',
    borderWidth: 1,
    borderColor: 'rgba(107,168,130,0.18)',
  },

  previewBubble: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    paddingHorizontal: 16,
    borderRadius: 28,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: 'rgba(107,168,130,0.28)',
  },

  captionInput: {
    height: 50,
    borderRadius: R.md,
    backgroundColor: C.background,
    borderWidth: 1,
    borderColor: C.divider,
    paddingHorizontal: 16,
    color: C.text,
    fontSize: 16,
    fontWeight: '600',
  },

  previewActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
  },

  secondaryButton: {
    flex: 1,
    height: 52,
    borderRadius: R.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.background,
    borderWidth: 1,
    borderColor: C.divider,
  },

  secondaryButtonText: {
    color: C.text,
    fontSize: 15,
    fontWeight: '800',
  },

  sendButton: {
    width: 56,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.accent,
  },

  disabledButton: {
    opacity: 0.55,
  },
});
