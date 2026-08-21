import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import { useCallback, useState, type ReactNode } from 'react';
import {
  Dimensions,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Touchable from '@/components/Touchable';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import Avatar from '../../components/Avatar';
import GroupAvatarDisplay from '@/components/GroupAvatarDisplay';
import SpringIn from '@/components/SpringIn';
import UnreadWhisperGlow from '@/components/UnreadWhisperGlow';
import WhisperWaveGlyph from '@/components/WhisperWaveGlyph';
import { OnboardingTarget } from '@/components/onboarding/OnboardingTarget';
import { useOnboarding } from '@/components/onboarding/OnboardingProvider';
import { ONBOARDING_TARGETS } from '@/lib/onboarding/events';
import { FrequencyLogo, FrequencyLogoLoader } from '@/components/branding/FrequencyLogo';
import { router, useFocusEffect } from 'expo-router';
import {
  FrequencyColors as C,
  FrequencySpacing as S,
} from '../../constants/frequencyTheme';
import { supabase } from '../../lib/supabase';
import {
  getOtherWhisperUserId,
  WhisperThread,
} from '../../lib/whispers';
import { fetchGroupInboxThreads } from '@/lib/groupWhispers';
import { selection } from '@/lib/haptics';

type WhisperMessage = {
  id: string;
  thread_id: string;
  sender_id: string;
  receiver_id: string;
  caption: string | null;
  message_type?: 'voice' | 'shared_echo';
  created_at: string;
  read_at: string | null;
  waveform: number[] | null;
  duration: number | null;
};

// Everything a row needs to draw the voice itself, shared by both thread
// kinds so renderItem never has to branch on `kind` for the preview line.
type VoicePreview = {
  // Only surfaces when there is no recording to describe -- a shared Echo.
  // A real recording is always drawn as waveform + length, never as text.
  preview: string;
  // Null for a shared Echo, which carries no recording of its own -- those
  // rows fall back to plain preview text, as before.
  waveform: number[] | null;
  duration: number | null;
  hasVoice: boolean;
};

type InboxItem = VoicePreview &
  (
    | {
        kind: '1:1';
        threadId: string;
        otherUserId: string;
        username: string;
        avatarUrl: string | null;
        timestamp: string;
        sortAt: string;
        unread: boolean;
      }
    | {
        kind: 'group';
        threadId: string;
        displayName: string;
        avatarUrl: string | null;
        avatarMembers: { username: string; avatarUrl: string | null }[];
        extraMemberCount: number;
        timestamp: string;
        sortAt: string;
        unread: boolean;
      }
  );

type ProfileRow = {
  id: string;
  username: string | null;
  avatar_url: string | null;
};

// An Echo passed along from the feed to talk about. It has no recording of
// its own, so the row says what happened rather than showing a waveform --
// and it says it whether or not a note came with it, because the note is
// the conversation, not the thing that arrived.
const SHARED_ECHO_PREVIEW = 'Sent an Echo';

// Only reached by a recording whose duration never made it into the row.
const VOICE_PREVIEW_FALLBACK = 'Voice whisper';

function cleanUsername(username: string | null | undefined) {
  return String(username ?? 'frequency').replace(/^@/, '').trim() || 'frequency';
}

function formatTimestamp(dateString: string | null) {
  if (!dateString) return '';

  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'Now';
  if (mins < 60) return `${mins}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;

  return new Date(dateString).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds));

  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// Avatar size shared with Search results, Mutuals and the people-suggestion
// rows, so every list row in the app sits on one avatar scale.
const ROW_AVATAR = 54;

const NEW_GROUP_BUTTON_SIZE = 44;

// The unread glow is drawn wider and taller than the row it sits behind, so
// its soft edge falls outside the row's bounds instead of ending on a visible
// seam. `content` insets the list by 28 on each side.
const GLOW_WIDTH = Dimensions.get('window').width - 56 + 72;
const GLOW_HEIGHT = 128;

// Dividers start where the copy starts, not at the screen edge -- the avatar
// column reads as a gutter rather than being cut through by a hairline. The
// +6 is the unread ring's border and padding on both sides, which widened
// the avatar column.
const DIVIDER_INSET = ROW_AVATAR + 6 + S.md;

// Scroll distance over which the header material fades in. Short enough that
// the frost is already there by the time the first row passes underneath.
const HEADER_MATERIAL_TRAVEL = 28;

// Close enough to the real measured height that the list's first paint lands
// in the right place; onLayout corrects it on the same frame.
const HEADER_HEIGHT_ESTIMATE = 182;

// Rows stagger, but a Whispers inbox can be long -- the delay is capped so
// row 30 never waits on a 30-step cascade to appear.
const ROW_STAGGER_MS = 45;
const ROW_STAGGER_CAP = 8;

// A press should answer instantly, so this is a much stiffer spring than the
// entrance one -- same heavily-damped family, no overshoot, just faster.
const PRESS_SPRING = { damping: 26, stiffness: 320, mass: 0.6 };

const AnimatedFlatList = Animated.createAnimatedComponent(FlatList<InboxItem>);

/**
 * Row press feedback: a slight settle rather than a flash. Reanimated (the
 * same library the entrance uses) so press and entrance can't fight each
 * other on different drivers.
 */
function PressableRow({
  children,
  onPress,
}: {
  children: ReactNode;
  onPress: () => void;
}) {
  const press = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 1 - press.value * 0.14,
    transform: [{ scale: 1 - press.value * 0.015 }],
  }));

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        press.value = withSpring(1, PRESS_SPRING);
      }}
      onPressOut={() => {
        press.value = withSpring(0, PRESS_SPRING);
      }}
    >
      <Animated.View style={animatedStyle}>{children}</Animated.View>
    </Pressable>
  );
}

export default function WhispersScreen() {
  const onboarding = useOnboarding();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);

  // The header is measured rather than hardcoded so the list's top inset stays
  // correct if the copy ever wraps on a narrow device.
  const [headerHeight, setHeaderHeight] = useState(HEADER_HEIGHT_ESTIMATE);
  const scrollY = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  // At rest the header sits on the plain background exactly as before; the
  // frost only appears once there is content passing underneath it.
  const headerMaterialStyle = useAnimatedStyle(() => ({
    opacity: Math.min(Math.max(scrollY.value, 0) / HEADER_MATERIAL_TRAVEL, 1),
  }));

  const loadInbox = useCallback(async () => {
    setLoading(true);

    const { data: userData } = await supabase.auth.getUser();
    const currentUserId = userData.user?.id;

    if (!currentUserId) {
      setItems([]);
      setLoading(false);
      return;
    }

    const { data: threadData } = await supabase
      .from('whisper_threads')
      .select('*')
      .or(`user_a_id.eq.${currentUserId},user_b_id.eq.${currentUserId}`)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });

    const threads = (threadData ?? []) as WhisperThread[];
    const threadIds = threads.map((thread) => thread.id);
    const otherUserIds = [
      ...new Set(threads.map((thread) => getOtherWhisperUserId(thread, currentUserId))),
    ];

    const [{ data: messageData }, { data: profileData }] = await Promise.all([
      threadIds.length > 0
        ? supabase
            .from('whisper_messages')
            .select(
              'id, thread_id, sender_id, receiver_id, caption, message_type, created_at, read_at, waveform, duration'
            )
            .in('thread_id', threadIds)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [] }),
      otherUserIds.length > 0
        ? supabase.from('profiles').select('id, username, avatar_url').in('id', otherUserIds)
        : Promise.resolve({ data: [] }),
    ]);

    const latestByThread = new Map<string, WhisperMessage>();
    const unreadThreadIds = new Set<string>();
    ((messageData ?? []) as WhisperMessage[]).forEach((message) => {
      if (!latestByThread.has(message.thread_id)) {
        latestByThread.set(message.thread_id, message);
      }

      if (message.receiver_id === currentUserId && message.read_at === null) {
        unreadThreadIds.add(message.thread_id);
      }
    });

    const profilesById = new Map(
      ((profileData ?? []) as ProfileRow[]).map((profile) => [profile.id, profile])
    );

    // A thread row exists from the moment someone opens a Whisper with you,
    // before anyone has actually said anything. Those aren't conversations
    // yet, so they don't belong in the inbox -- the thread stays in the
    // database and appears the moment a first Whisper lands.
    const oneOnOneItems: InboxItem[] = threads
      .filter((thread) => latestByThread.has(thread.id))
      .map((thread) => {
        const otherUserId = getOtherWhisperUserId(thread, currentUserId);
        const latest = latestByThread.get(thread.id)!;
        const profile = profilesById.get(otherUserId);
        const isSharedEcho = latest.message_type === 'shared_echo';

        return {
          kind: '1:1',
          threadId: thread.id,
          otherUserId,
          username: cleanUsername(profile?.username),
          avatarUrl: profile?.avatar_url ?? null,
          preview: isSharedEcho ? SHARED_ECHO_PREVIEW : VOICE_PREVIEW_FALLBACK,
          waveform: isSharedEcho ? null : latest.waveform,
          duration: isSharedEcho ? null : latest.duration,
          hasVoice: !isSharedEcho,
          timestamp: formatTimestamp(latest.created_at),
          sortAt: thread.last_message_at ?? latest.created_at,
          unread: unreadThreadIds.has(thread.id),
        };
      });

    const groupThreads = await fetchGroupInboxThreads(currentUserId).catch(() => []);
    const groupItems: InboxItem[] = groupThreads.map((thread) => ({
      kind: 'group',
      threadId: thread.threadId,
      displayName: thread.displayName,
      avatarUrl: thread.avatarUrl,
      avatarMembers: thread.avatarMembers,
      extraMemberCount: thread.extraMemberCount,
      // Groups have no shared-Echo message type, so every group row is a
      // recording -- this text only ever backstops a missing duration.
      preview: VOICE_PREVIEW_FALLBACK,
      waveform: thread.waveform,
      duration: thread.duration,
      hasVoice: true,
      timestamp: formatTimestamp(thread.sortAt),
      sortAt: thread.sortAt,
      unread: thread.unread,
    }));

    const nextItems = [...oneOnOneItems, ...groupItems].sort((left, right) => {
      if (left.unread !== right.unread) {
        return left.unread ? -1 : 1;
      }

      return new Date(right.sortAt).getTime() - new Date(left.sortAt).getTime();
    });

    setItems(nextItems);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadInbox();
    }, [loadInbox])
  );

  useFocusEffect(
    useCallback(() => {
      onboarding.screenReady('whispers');
    }, [onboarding])
  );

  return (
    <View style={styles.screen}>
      <AnimatedFlatList
        data={items}
        keyExtractor={(item) => item.threadId}
        showsVerticalScrollIndicator={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.content, { paddingTop: headerHeight + S.md }]}
        ListEmptyComponent={
          <OnboardingTarget
            id={ONBOARDING_TARGETS.whispersPrimaryArea}
            style={styles.emptyState}
          >
            <View style={styles.emptyStack}>
              {loading ? (
                <>
                  <FrequencyLogoLoader size={44} />
                  <Text style={styles.emptyCopy}>Opening the quiet room...</Text>
                </>
              ) : (
                <>
                  <FrequencyLogo size={72} opacity={0.16} style={styles.emptyMark} />
                  <Text style={styles.emptyTitle}>No whispers yet.</Text>
                  <Text style={styles.emptyCopy}>
                    Private voice notes will appear here.
                  </Text>
                </>
              )}
            </View>
          </OnboardingTarget>
        }
        renderItem={({ item, index }) => {
          const headerLabel = item.kind === '1:1' ? `@${item.username}` : item.displayName;
          const isLast = index === items.length - 1;
          const avatarNode = (
            <View style={[styles.avatarRing, item.unread && styles.avatarRingUnread]}>
              {item.kind === '1:1' ? (
                <Avatar
                  avatarUrl={item.avatarUrl}
                  initial={item.username}
                  size={ROW_AVATAR}
                  textSize={22}
                />
              ) : (
                <GroupAvatarDisplay
                  avatarUrl={item.avatarUrl}
                  members={item.avatarMembers}
                  extraCount={item.extraMemberCount}
                  size={ROW_AVATAR}
                />
              )}
            </View>
          );

          const threadRow = (
            <PressableRow
              onPress={() => {
                void selection();

                if (item.kind === '1:1') {
                  router.push({
                    pathname: '/whispers/[threadId]',
                    params: {
                      threadId: item.threadId,
                      otherUserId: item.otherUserId,
                    },
                  });
                  return;
                }

                router.push({
                  pathname: '/whispers/group/[threadId]',
                  params: { threadId: item.threadId },
                });
              }}
            >
              <View style={styles.threadRowContent}>
                {item.unread && <UnreadWhisperGlow width={GLOW_WIDTH} height={GLOW_HEIGHT} />}

                {avatarNode}

                <View style={styles.threadCopy}>
                  <View style={styles.threadTop}>
                    <Text
                      style={[styles.username, item.unread && styles.unreadUsername]}
                      numberOfLines={1}
                    >
                      {headerLabel}
                    </Text>
                    <Text
                      style={[styles.timestamp, item.unread && styles.unreadTimestamp]}
                    >
                      {item.timestamp}
                    </Text>
                  </View>

                  <View style={styles.previewRow}>
                    {item.hasVoice && (
                      <WhisperWaveGlyph
                        waveform={item.waveform}
                        tint={item.unread ? C.accentSoft : C.faint}
                      />
                    )}

                    {/* One rule for every Whisper, 1:1 or group: a voice
                        note previews as its own shape and length, never as
                        text. The length is what you actually want to know
                        before tapping in, and a caption is the note's
                        sticky, not a substitute for the note. Preview text
                        is only for rows with no recording at all. */}
                    <Text
                      style={[styles.preview, item.unread && styles.unreadPreview]}
                      numberOfLines={1}
                    >
                      {item.hasVoice && item.duration !== null
                        ? formatDuration(item.duration)
                        : item.preview}
                    </Text>

                    {item.unread && <View style={styles.unreadDot} />}
                  </View>
                </View>
              </View>
            </PressableRow>
          );

          // The entrance sits *inside* the row container, never around it, for
          // two reasons: the onboarding spotlight measures the row's own View
          // with measureInWindow, so that View must stay untransformed and keep
          // its padded bounds; and holding the row's height static means the
          // list never reflows while the content glides in.
          const rowBody = (
            <SpringIn delay={Math.min(index, ROW_STAGGER_CAP) * ROW_STAGGER_MS}>
              {threadRow}
              {!isLast && <View style={styles.rowDivider} />}
            </SpringIn>
          );

          if (index === 0) {
            return (
              <OnboardingTarget
                id={ONBOARDING_TARGETS.whispersPrimaryArea}
                style={styles.threadRow}
              >
                {rowBody}
              </OnboardingTarget>
            );
          }

          return <View style={styles.threadRow}>{rowBody}</View>;
        }}
      />

      <Animated.View
        style={styles.headerLayer}
        pointerEvents="box-none"
        onLayout={(event) => {
          const nextHeight = event.nativeEvent.layout.height;

          if (nextHeight > 0 && nextHeight !== headerHeight) {
            setHeaderHeight(nextHeight);
          }
        }}
      >
        {/* The material is a sibling under the header copy rather than a
            background on it, so it can fade in on scroll without the title
            and the group button fading with it. */}
        <Animated.View
          style={[StyleSheet.absoluteFill, headerMaterialStyle]}
          pointerEvents="none"
        >
          <BlurView
            intensity={28}
            tint="systemThinMaterialDark"
            experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
            style={StyleSheet.absoluteFill}
          >
            <View style={styles.headerGlass} />
          </BlurView>
          <View style={styles.headerHairline} />
        </Animated.View>

        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title}>Whispers</Text>
            <Text style={styles.subtitle}>Private voice notes.</Text>
          </View>

          <View style={styles.headerActions}>
            <Touchable
              style={styles.headerIconButton}
              activeOpacity={0.78}
              onPress={() => {
                void selection();
                router.push('/whispers/new');
              }}
            >
              <Ionicons name="search-outline" size={20} color={C.text} />
            </Touchable>

            <Touchable
              style={styles.headerIconButton}
              activeOpacity={0.78}
              onPress={() => {
                void selection();
                router.push('/whispers/new-group');
              }}
            >
              <Ionicons name="people-outline" size={22} color={C.text} />
            </Touchable>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.background,
  },

  // paddingTop is supplied at render time from the measured header height.
  content: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingBottom: 128,
  },

  headerLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },

  // Same translucent glass fill the search field and the Whisper reply
  // preview use, so the frosted surfaces across the app match.
  headerGlass: {
    flex: 1,
    backgroundColor: 'rgba(17,22,20,0.62)',
  },

  headerHairline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.divider,
  },

  title: {
    color: C.text,
    fontSize: 44,
    fontWeight: '800',
  },

  subtitle: {
    color: C.muted,
    fontSize: 18,
    marginTop: S.xs,
  },

  // Matches the Search screen's header gutter and 76pt top inset so the two
  // tabs share one vertical rhythm.
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    paddingTop: 76,
    paddingBottom: S.lg,
  },

  headerText: {
    flex: 1,
  },

  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    marginTop: 6,
  },

  headerIconButton: {
    width: NEW_GROUP_BUTTON_SIZE,
    height: NEW_GROUP_BUTTON_SIZE,
    borderRadius: NEW_GROUP_BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.divider,
  },

  threadRow: {
    paddingVertical: S.md,
  },

  // Inset to the copy column rather than full-bleed, and dropped entirely on
  // the last row so the list ends on whitespace instead of a hanging rule.
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.divider,
    marginLeft: DIVIDER_INSET,
    marginTop: S.md,
    marginBottom: -S.md,
  },

  threadRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  // Always present so an unread row never becomes 2pt taller than a read
  // one -- only the border colour changes.
  avatarRing: {
    padding: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'transparent',
  },

  avatarRingUnread: {
    borderColor: 'rgba(107,168,130,0.55)',
  },

  threadCopy: {
    flex: 1,
    marginLeft: S.md,
  },

  threadTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: S.md,
  },

  username: {
    flex: 1,
    color: C.text,
    fontSize: 18,
    fontWeight: '800',
  },

  unreadUsername: {
    color: C.text,
    fontWeight: '900',
  },

  timestamp: {
    color: C.faint,
    fontSize: 13,
    fontWeight: '700',
  },

  unreadTimestamp: {
    color: C.accentSoft,
    fontWeight: '900',
  },

  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: S.xs,
    gap: S.sm,
  },

  preview: {
    flex: 1,
    color: C.muted,
    fontSize: 15,
    lineHeight: 21,
  },

  unreadPreview: {
    color: C.text,
    fontWeight: '700',
  },

  unreadDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: C.accent,
  },

  emptyState: {
    flex: 1,
    alignSelf: 'stretch',
    justifyContent: 'center',
  },

  emptyStack: {
    width: '100%',
    alignItems: 'center',
  },

  emptyMark: {
    marginBottom: S.xl,
  },

  emptyTitle: {
    color: C.text,
    fontSize: 25,
    fontWeight: '800',
    textAlign: 'center',
  },

  emptyCopy: {
    color: C.muted,
    fontSize: 17,
    lineHeight: 25,
    textAlign: 'center',
    marginTop: S.md,
    maxWidth: 310,
  },
});
