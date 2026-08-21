import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
  FlatList,
  Alert,
  Keyboard,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from 'react-native';
import Touchable from '@/components/Touchable';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetFlatList,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import type { BottomSheetDefaultBackdropProps } from '@gorhom/bottom-sheet/lib/typescript/components/bottomSheetBackdrop/types';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { Audio, AVPlaybackStatus } from 'expo-av';
import Avatar from '@/components/Avatar';
import { supabase } from '../../lib/supabase';
import { FrequencyColors as C } from '../../constants/frequencyTheme';
import { FrequencyLogo, FrequencyLogoLoader } from '@/components/branding/FrequencyLogo';
import FrequencyWaveform from '@/components/FrequencyWaveform';
import EchoAura from '@/components/EchoAura';
import TuneInRequestBadge from '@/components/TuneInRequestBadge';
import EchoLikeBadge from '@/components/EchoLikeBadge';
import EchoActionToast from '@/components/EchoActionToast';
import SuggestionFeedCard from '@/components/SuggestionFeedCard';
import SuggestionQuickActionSheet from '@/components/SuggestionQuickActionSheet';
import SwipeToDeleteRow from '@/components/SwipeToDeleteRow';
import { setBottomDockSuppressed } from '@/lib/bottomDockVisibility';
import { createNotification, deleteNotification } from '@/lib/notifications';
import { fetchUsernameForUser } from '@/lib/profiles';
import { setFeedSuggestionsEnabled as persistFeedSuggestionsEnabled } from '@/lib/preferences';
import { openOrCreateWhisperThread } from '@/lib/whispers';
import { error as hapticError, light, medium } from '@/lib/haptics';
import { requestTuneIn, respondToTuneInRequest } from '@/lib/tuneIns';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hasShownSuggestionFeedCardThisSession, markSuggestionFeedCardShown } from '@/lib/appSession';
import { useSuggestedTuneIns } from '@/hooks/useSuggestedTuneIns';
import type { SuggestedTuneIn } from '@/lib/suggestedTuneIns';

const { height, width } = Dimensions.get('window');

const PLAY_BUTTON_SIZE = 62;

// Deliberately wider than the screen: the glow should bleed off both edges
// so it reads as light in the room, never as a circle drawn on the page.
const AURA_SIZE = Math.round(width * 1.5);

// Tunable: how far through someone's real Echoes the suggestion card lands,
// as a fraction of their total count -- the middle, not a fixed position.
// A fixed absolute index would mean "immediately" for anyone with a short
// feed; a fraction of their actual length never does.
const SUGGESTION_CARD_POSITION_FRACTION = 0.5;

// Tunable: how many people the single suggestion card lists. Still one card
// per session -- this is how many rows it shows, not how many cards. The
// card's own container centers header + rows as one block (see
// SuggestionFeedCard's `screen` style), so raising this also nudges the
// header text upward by using more of that centered space -- no separate
// header-spacing tweak needed.
const SUGGESTION_CARD_MAX_PEOPLE = 5;

type VoicePost = {
  id: string;
  user_id: string;
  username: string;
  audio_url: string;
  caption: string | null;
  created_at: string;
  waveform?: number[] | null;
  avatarUrl?: string | null;
};

type FeedItem =
  | { kind: 'echo'; post: VoicePost }
  | { kind: 'suggestion'; suggestions: SuggestedTuneIn[] };

type EchoComment = {
  id: string;
  username: string;
  avatarUrl?: string | null;
  body: string;
  createdAt: string;
};

type ActivityNotification = {
  id: string;
  recipient_id: string;
  actor_id: string;
  type: string;
  voice_note_id: string | null;
  message: string;
  read: boolean;
  created_at: string;
  actorUsername?: string;
  actorAvatarUrl?: string | null;
  tuneInStatus?: 'pending' | 'accepted' | 'declined';
  reciprocalTuneInStatus?: 'pending' | 'accepted' | 'declined';
  direction?: 'incoming' | 'outgoing';
  requesterId?: string;
  recipientId?: string;
  requestStatus?: 'pending' | 'accepted' | 'declined';
  activityKey: string;
  requestId?: string;
};

type TuneInActivityRow = {
  id: string;
  listener_id: string;
  frequency_owner_id: string;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
  responded_at: string | null;
};

type ProfileIdentity = {
  id: string;
  username?: string | null;
  avatar_url: string | null;
};

type SharePerson = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

type EchoEventType =
  | 'play_started'
  | 'completed'
  | 'replayed'
  | 'liked'
  | 'commented'
  | 'shared_to_whisper'
  | 'listen_progress';

type LikeSyncState = {
  desired: boolean;
  inFlight: boolean;
};

function timeAgo(dateString: string) {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diff = Math.max(0, now - then);

  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;

  return new Date(dateString).toLocaleDateString();
}

function commentTimeAgo(dateString: string) {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diff = Math.max(0, now - then);

  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;

  return new Date(dateString).toLocaleDateString();
}

function usernameFromNotificationMessage(message: string) {
  return message.match(/^@([a-z0-9_]+)/i)?.[1];
}

function tuneInStatusRank(status?: TuneInActivityRow['status']) {
  return status === 'accepted' ? 3 : status === 'pending' ? 2 : status === 'declined' ? 1 : 0;
}

function chooseTuneInRow(rows: TuneInActivityRow[]) {
  return [...rows].sort((a, b) => {
    const createdAt = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    return createdAt || tuneInStatusRank(b.status) - tuneInStatusRank(a.status);
  })[0];
}

function chooseActivityNotification(
  current: ActivityNotification,
  candidate: ActivityNotification
) {
  const currentAccepted = current.requestStatus === 'accepted';
  const candidateAccepted = candidate.requestStatus === 'accepted';
  if (currentAccepted !== candidateAccepted) return candidateAccepted ? candidate : current;

  return new Date(candidate.created_at).getTime() > new Date(current.created_at).getTime()
    ? candidate
    : current;
}

function cleanUsername(username: string | null | undefined) {
  return String(username ?? 'frequency').replace(/^@/, '').trim() || 'frequency';
}

function LikeAction({
  liked,
  onPress,
}: {
  liked: boolean;
  onPress: () => boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const burstOpacity = useRef(new Animated.Value(0)).current;
  const burstScale = useRef(new Animated.Value(0.78)).current;
  const burstTranslateY = useRef(new Animated.Value(0)).current;
  const burstTranslateX = useRef(new Animated.Value(0)).current;
  const burstInFlightRef = useRef(false);

  useEffect(() => {
    return () => {
      scale.stopAnimation();
      burstOpacity.stopAnimation();
      burstScale.stopAnimation();
      burstTranslateY.stopAnimation();
      burstTranslateX.stopAnimation();
    };
  }, [burstOpacity, burstScale, burstTranslateX, burstTranslateY, scale]);

  function runBurst() {
    if (burstInFlightRef.current) return;

    burstInFlightRef.current = true;
    burstOpacity.setValue(1);
    burstScale.setValue(0.78);
    burstTranslateY.setValue(0);
    burstTranslateX.setValue(0);

    Animated.parallel([
      Animated.sequence([
        Animated.timing(burstScale, {
          toValue: 1.24,
          duration: 150,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(burstScale, {
          toValue: 1.05,
          duration: 430,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(burstTranslateY, {
        toValue: -48,
        duration: 580,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(burstTranslateX, {
        toValue: -4,
        duration: 580,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(burstOpacity, {
        toValue: 0,
        duration: 580,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(() => {
      burstInFlightRef.current = false;
      burstOpacity.setValue(0);
    });
  }

  function handlePress() {
    const nextLiked = onPress();

    scale.stopAnimation();
    if (nextLiked) {
      runBurst();
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.2,
          duration: 95,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: 115,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
      return;
    }

    Animated.sequence([
      Animated.timing(scale, {
        toValue: 0.92,
        duration: 80,
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: 120,
        useNativeDriver: true,
      }),
    ]).start();
  }

  return (
    <Touchable
      style={styles.action}
      activeOpacity={0.82}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={liked ? 'Unlike Echo' : 'Like Echo'}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.likeBurst,
          {
            opacity: burstOpacity,
            transform: [
              { translateX: burstTranslateX },
              { translateY: burstTranslateY },
              { scale: burstScale },
            ],
          },
        ]}
      >
        <Ionicons name="heart" size={34} color="#FF3B30" />
      </Animated.View>

      <Animated.View style={{ transform: [{ scale }] }}>
        <Ionicons
          name={liked ? 'heart' : 'heart-outline'}
          size={23}
          color={liked ? '#FF3B30' : C.text}
        />
      </Animated.View>
    </Touchable>
  );
}

// The primary control on an Echo page. While the Echo plays, a single ring
// expands out of the button and fades -- one slow pulse, no chain of them,
// so it reads as the voice breathing rather than as a loading spinner.
function EchoPlayButton({
  isPlaying,
  onPress,
}: {
  isPlaying: boolean;
  onPress: () => void;
}) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isPlaying) {
      pulse.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 2200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      })
    );

    loop.start();

    return () => {
      loop.stop();
      pulse.setValue(0);
    };
  }, [isPlaying, pulse]);

  return (
    <Touchable
      style={styles.playButton}
      activeOpacity={0.86}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={isPlaying ? 'Pause Echo' : 'Play Echo'}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.playPulse,
          {
            opacity: pulse.interpolate({
              inputRange: [0, 1],
              outputRange: [0.32, 0],
            }),
            transform: [
              {
                scale: pulse.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 1.5],
                }),
              },
            ],
          },
        ]}
      />

      <Ionicons
        name={isPlaying ? 'pause' : 'play'}
        size={24}
        color="#0B100D"
        style={isPlaying ? undefined : styles.playIconNudge}
      />
    </Touchable>
  );
}

function ActivityButton({
  unreadCount,
  hasPendingTuneInRequest,
  hasUnseenLike,
  hasOtherUnread,
  onPress,
}: {
  unreadCount: number;
  hasPendingTuneInRequest: boolean;
  hasUnseenLike: boolean;
  hasOtherUnread: boolean;
  onPress: () => void;
}) {
  return (
    <Touchable
      style={styles.activityButton}
      activeOpacity={0.82}
      onPress={onPress}
    >
      <Text style={styles.activityIcon}>♡</Text>
      {hasPendingTuneInRequest ? (
        <>
          <TuneInRequestBadge size={38} style={styles.tuneInBadge} />
          {hasOtherUnread && <View style={styles.unreadDot} />}
        </>
      ) : hasUnseenLike ? (
        <>
          <EchoLikeBadge size={38} style={styles.tuneInBadge} />
          {hasOtherUnread && <View style={styles.unreadDot} />}
        </>
      ) : (
        unreadCount > 0 && <View style={styles.unreadDot} />
      )}
    </Touchable>
  );
}

function ProfileButton({
  avatarUrl,
  username,
  onPress,
}: {
  avatarUrl: string | null;
  username: string;
  onPress: () => void;
}) {
  return (
    <Touchable
      style={styles.profileGlow}
      activeOpacity={0.82}
      accessibilityRole="button"
      accessibilityLabel="My Frequency"
      onPress={onPress}
    >
      <Avatar
        avatarUrl={avatarUrl}
        initial={username || 'F'}
        size={42}
        textSize={17}
        backgroundColor={C.surface}
        textColor={C.text}
        borderColor={C.divider}
      />
    </Touchable>
  );
}

function HeaderButtonsRow({
  avatarUrl,
  username,
  unreadCount,
  hasPendingTuneInRequest,
  hasUnseenLike,
  hasOtherUnread,
  onProfilePress,
  onActivityPress,
  opacity,
  visible,
}: {
  avatarUrl: string | null;
  username: string;
  unreadCount: number;
  hasPendingTuneInRequest: boolean;
  hasUnseenLike: boolean;
  hasOtherUnread: boolean;
  onProfilePress: () => void;
  onActivityPress: () => void;
  opacity: Animated.Value;
  visible: boolean;
}) {
  return (
    <Animated.View
      style={[styles.headerTop, { opacity }]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <ProfileButton avatarUrl={avatarUrl} username={username} onPress={onProfilePress} />
      <ActivityButton
        unreadCount={unreadCount}
        hasPendingTuneInRequest={hasPendingTuneInRequest}
        hasUnseenLike={hasUnseenLike}
        hasOtherUnread={hasOtherUnread}
        onPress={onActivityPress}
      />
    </Animated.View>
  );
}

export default function FeedScreen() {
  const [posts, setPosts] = useState<VoicePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [isSoundPlaying, setIsSoundPlaying] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [listeningMode, setListeningMode] = useState(false);
  const [selectedPost, setSelectedPost] = useState<VoicePost | null>(null);
  const [commentText, setCommentText] = useState('');
  const [commentsByPost, setCommentsByPost] = useState<Record<string, EchoComment[]>>({});
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityUserId, setActivityUserId] = useState<string | null>(null);
  const [ownAvatarUrl, setOwnAvatarUrl] = useState<string | null>(null);
  const [ownUsername, setOwnUsername] = useState('');
  const [notifications, setNotifications] = useState<ActivityNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  // The heart badge can only show one pin at a time, so it always surfaces
  // whichever unread notification actually needs a decision (a Tune In
  // request) over one that's just informational (a like) -- but if the
  // other kind is also waiting, hasOtherUnread lights a small dot alongside
  // the pin so it's never silently swallowed, only deprioritized.
  const { hasPendingTuneInRequest, hasUnseenLike, hasOtherUnread } = useMemo(() => {
    const isPendingIncomingTuneIn = (notification: ActivityNotification) =>
      notification.type === 'tune_in' &&
      !notification.read &&
      notification.recipientId === activityUserId &&
      notification.requesterId !== activityUserId &&
      notification.requestStatus === 'pending';
    const isUnseenLike = (notification: ActivityNotification) =>
      notification.type === 'reaction' && !notification.read;

    const pendingTuneIn = notifications.some(isPendingIncomingTuneIn);
    const unseenLike = notifications.some(isUnseenLike);
    const otherUnread = pendingTuneIn
      ? notifications.some((notification) => !notification.read && !isPendingIncomingTuneIn(notification))
      : unseenLike
        ? notifications.some((notification) => !notification.read && !isUnseenLike(notification))
        : false;

    return {
      hasPendingTuneInRequest: pendingTuneIn,
      hasUnseenLike: unseenLike,
      hasOtherUnread: otherUnread,
    };
  }, [notifications, activityUserId]);
  const [likedPostIds, setLikedPostIds] = useState<Record<string, boolean>>({});
  const [sharePost, setSharePost] = useState<VoicePost | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareQuery, setShareQuery] = useState('');
  const [sharePeople, setSharePeople] = useState<SharePerson[]>([]);
  const [selectedSharePerson, setSelectedSharePerson] = useState<SharePerson | null>(null);
  const [shareNote, setShareNote] = useState('');
  const [shareLoading, setShareLoading] = useState(false);
  const [shareSending, setShareSending] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [reciprocalSubmittingIds, setReciprocalSubmittingIds] = useState<Record<string, boolean>>({});
  // Disabled for the duration of a waveform scrub so the paging FlatList's
  // native scroll gesture can't pick up incidental vertical drift from the
  // drag and fire onScrollBeginDrag, which would stop/unload the sound the
  // scrub is actively seeking.
  const [feedScrollEnabled, setFeedScrollEnabled] = useState(true);
  const insets = useSafeAreaInsets();

  // Paging toward the next Echo fades the profile/activity buttons out;
  // paging back toward a previous one fades them back in. Tracked as a ref
  // (for the scroll handler's direction check) plus a boolean state (so the
  // hidden row can go pointerEvents="none") alongside the driving opacity.
  const [headerButtonsVisible, setHeaderButtonsVisible] = useState(true);
  const headerButtonsVisibleRef = useRef(true);
  const headerButtonsOpacity = useRef(new Animated.Value(1)).current;
  const lastFeedScrollYRef = useRef(0);

  // Defaults true to match the feed_suggestions_enabled column's own
  // default -- fetchOwnProfile() reconciles this with the real value once
  // it loads, same optimistic-then-reconcile shape as other profile state
  // in this screen (ownAvatarUrl, ownUsername).
  const [feedSuggestionsEnabled, setFeedSuggestionsEnabled] = useState(true);
  const [suggestionQuickActionVisible, setSuggestionQuickActionVisible] = useState(false);
  const [suggestionToastMessage, setSuggestionToastMessage] = useState<string | null>(null);
  const suggestionToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Phase 1's scoring/floor-filtering/dismissal logic, unchanged.
  // Passing '' when the preference is off skips the hook's fetch entirely
  // (it early-returns on a falsy userId), so there's no wasted query.
  const { suggestions: suggestedTuneIns } = useSuggestedTuneIns(
    feedSuggestionsEnabled ? activityUserId ?? '' : '',
    SUGGESTION_CARD_MAX_PEOPLE
  );

  // Frozen into state once chosen, rather than derived on every render.
  // Deriving it meant re-reading the "already shown this session" flag on
  // each recompute -- which flips to true the moment the card appears, so
  // any later recompute would have pulled the card back out from under the
  // user mid-session. Capturing it once and only ever clearing it
  // deliberately (swiped past, or preference off) keeps that impossible.
  const [suggestionCandidates, setSuggestionCandidates] = useState<SuggestedTuneIn[]>([]);
  const suggestionViewedRef = useRef(false);
  const suggestionIndexRef = useRef(-1);
  const pendingScrollOffsetRef = useRef<number | null>(null);
  const feedListRef = useRef<FlatList<FeedItem>>(null);

  useEffect(() => {
    if (!feedSuggestionsEnabled || !activityUserId) {
      setSuggestionCandidates([]);
      return;
    }

    if (hasShownSuggestionFeedCardThisSession(activityUserId)) return;
    if (suggestedTuneIns.length === 0) return;

    markSuggestionFeedCardShown(activityUserId);
    setSuggestionCandidates(suggestedTuneIns.slice(0, SUGGESTION_CARD_MAX_PEOPLE));
  }, [activityUserId, feedSuggestionsEnabled, suggestedTuneIns]);

  // Middle of their actual Echo count, never index 0 -- Math.max keeps a
  // short feed from putting it first, Math.min clamps back down to 0 for a
  // genuinely empty feed (the only valid position in an empty list).
  const suggestionIndex =
    suggestionCandidates.length > 0
      ? Math.min(
          Math.max(1, Math.round(posts.length * SUGGESTION_CARD_POSITION_FRACTION)),
          posts.length
        )
      : -1;

  // Whether there's a real Echo after the card at its current position.
  // When there isn't (an empty feed, or the rare very-short one where the
  // middle math lands it at the tail), swiping past it can't reveal
  // anything -- onViewableItemsChanged's close-on-swipe below only fires
  // when a new item actually becomes viewable, so there'd be nothing to
  // trigger it. The card needs its own explicit close affordance instead;
  // see the onClose prop passed to SuggestionFeedCard in renderItem.
  const suggestionHasEchoAfter = suggestionIndex >= 0 && suggestionIndex < posts.length;

  useEffect(() => {
    suggestionIndexRef.current = suggestionIndex;
  }, [suggestionIndex]);

  // Reuses the same re-anchor path as the swipe-past-in-the-middle case
  // below (pendingScrollOffsetRef + the effect keyed on feedItems) --
  // closing at the tail just means landing on whatever the new last Echo
  // is, or the empty state if there wasn't one.
  function handleCloseSuggestion() {
    suggestionIndexRef.current = -1;
    pendingScrollOffsetRef.current = Math.max(0, (posts.length - 1) * height);
    setSuggestionCandidates([]);
  }

  function openSuggestionQuickAction() {
    setSuggestionQuickActionVisible(true);
  }

  async function confirmDisableFeedSuggestions() {
    setSuggestionQuickActionVisible(false);
    setFeedSuggestionsEnabled(false);

    if (suggestionToastTimeoutRef.current) clearTimeout(suggestionToastTimeoutRef.current);
    setSuggestionToastMessage('Turned off — manage in Settings.');
    suggestionToastTimeoutRef.current = setTimeout(() => setSuggestionToastMessage(null), 2400);

    if (!activityUserId) return;

    try {
      await persistFeedSuggestionsEnabled(activityUserId, false);
    } catch (err: any) {
      void hapticError();
      Alert.alert('Settings Error', err.message);
    }
  }

  const feedItems = useMemo<FeedItem[]>(() => {
    const echoItems: FeedItem[] = posts.map((post) => ({ kind: 'echo', post }));

    if (suggestionIndex < 0) return echoItems;

    return [
      ...echoItems.slice(0, suggestionIndex),
      { kind: 'suggestion', suggestions: suggestionCandidates },
      ...echoItems.slice(suggestionIndex),
    ];
  }, [posts, suggestionCandidates, suggestionIndex]);

  // Removing the card mid-list shrinks everything below it by exactly one
  // page, so the pager would silently skip the Echo the user just landed
  // on. Re-anchoring has to happen after the new data has actually been
  // committed to the list, which is why it's an effect keyed on feedItems
  // rather than a call alongside the state update.
  useEffect(() => {
    if (pendingScrollOffsetRef.current === null) return;

    const offset = pendingScrollOffsetRef.current;
    pendingScrollOffsetRef.current = null;
    feedListRef.current?.scrollToOffset({ offset, animated: false });
  }, [feedItems]);

  const soundRef = useRef<Audio.Sound | null>(null);
  const playingIdRef = useRef<string | null>(null);
  const seekingRef = useRef(false);
  const pendingSeekRef = useRef<{ post: VoicePost; fraction: number } | null>(null);
  const durationMillisRef = useRef<number | null>(null);
  // Guards against overlapping Audio.Sound.createAsync calls for the same
  // Echo. Scrubbing fires onSeek on every drag-move event, and until the
  // sound finishes loading, playingIdRef/soundRef alone can't tell a
  // still-loading Echo apart from one that was never started, so repeated
  // drag events would otherwise each kick off their own concurrent load.
  const loadingIdRef = useRef<string | null>(null);
  const pendingLoadSeekRef = useRef<number | null>(null);
  const playbackEventRef = useRef<{
    voiceNoteId: string;
    completed: boolean;
    // Furthest point reached this listen, and the clip's full length as
    // the player reported it. Flushed as a listen_progress event when
    // playback stops for any reason, so Echo Impact can say how much of
    // an Echo was actually heard rather than only whether it finished.
    heardMs: number;
    totalMs: number | null;
    flushed: boolean;
  } | null>(null);
  const playedEchoIdsRef = useRef<Record<string, boolean>>({});
  const likedPostIdsRef = useRef<Record<string, boolean>>({});
  const confirmedLikedPostIdsRef = useRef<Record<string, boolean>>({});
  const likeSyncByPostRef = useRef<Record<string, LikeSyncState>>({});
  const listeningModeRef = useRef(false);
  const commentsSheetRef = useRef<BottomSheet>(null);
  const activitySheetRef = useRef<BottomSheet>(null);
  const activeActivityRowCloserRef = useRef<(() => void) | null>(null);
  const shareSheetRef = useRef<BottomSheet>(null);
  const commentsSnapPoints = useMemo(() => ['40%', '70%', '95%'], []);
  const activitySnapPoints = useMemo(() => ['55%', '82%'], []);
  const shareSnapPoints = useMemo(() => ['62%', '88%'], []);
  const feedPresence = useRef(new Animated.Value(0)).current;
  const shareActionPresence = useRef(new Animated.Value(0)).current;
  const activityTransitionValuesRef = useRef<Record<string, Animated.Value>>({});

  function activityTransitionValue(notification: ActivityNotification) {
    const existing = activityTransitionValuesRef.current[notification.activityKey];

    if (existing) return existing;

    const value = new Animated.Value(notification.requestStatus === 'accepted' ? 1 : 0);
    activityTransitionValuesRef.current[notification.activityKey] = value;
    return value;
  }

  function animateActivityTransition(notificationId: string) {
    const value = activityTransitionValuesRef.current[notificationId];

    if (!value) return;

    Animated.timing(value, {
      toValue: 1,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 70,
  }).current;

  const onViewableItemsChanged = useRef(
    async ({ viewableItems }: any) => {
      if (viewableItems.length === 0) return;

      const feedItem = viewableItems[0].item as FeedItem;
      const viewableIndex: number = viewableItems[0].index ?? -1;

      // Close-on-swipe-past. Runs regardless of listening mode, so it has to
      // sit above the listening-mode guard below. Only closes on forward
      // movement (past the card) -- swiping back to an earlier Echo leaves
      // it alone, since the user hasn't moved on from it yet.
      if (feedItem.kind === 'suggestion') {
        suggestionViewedRef.current = true;
      } else if (
        suggestionViewedRef.current &&
        suggestionIndexRef.current >= 0 &&
        viewableIndex > suggestionIndexRef.current
      ) {
        suggestionIndexRef.current = -1;
        pendingScrollOffsetRef.current = Math.max(0, (viewableIndex - 1) * height);
        setSuggestionCandidates([]);
      }

      if (!listeningModeRef.current) return;

      // The suggestion card carries no audio -- listening mode has nothing
      // to autoplay while it's the viewable item.
      if (feedItem.kind !== 'echo') return;

      const post = feedItem.post;

      if (playingIdRef.current === post.id) return;

      await playVoice(post);
    }
  ).current;

  function setHeaderButtonsFaded(visible: boolean) {
    headerButtonsVisibleRef.current = visible;
    setHeaderButtonsVisible(visible);
    Animated.timing(headerButtonsOpacity, {
      toValue: visible ? 1 : 0,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }

  // Direction, not position -- paging toward the next Echo (offset
  // increasing) fades the header buttons out, paging back toward a
  // previous one (offset decreasing) fades them back in. A small deadzone
  // ignores sub-pixel jitter so it doesn't flicker near-rest.
  const handleFeedScroll = useCallback((event: { nativeEvent: { contentOffset: { y: number } } }) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    const delta = offsetY - lastFeedScrollYRef.current;
    lastFeedScrollYRef.current = offsetY;

    if (Math.abs(delta) < 2) return;

    if (delta > 0 && headerButtonsVisibleRef.current) {
      setHeaderButtonsFaded(false);
    } else if (delta < 0 && !headerButtonsVisibleRef.current) {
      setHeaderButtonsFaded(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchPosts();
      fetchNotifications();
      fetchOwnProfile();

      // Always land back on the feed with the header buttons visible,
      // rather than resuming whatever fade state a previous visit left --
      // matches lastFeedScrollYRef also restarting from 0 below.
      lastFeedScrollYRef.current = 0;
      headerButtonsVisibleRef.current = true;
      setHeaderButtonsVisible(true);
      headerButtonsOpacity.setValue(1);

      return () => {
        listeningModeRef.current = false;
        setListeningMode(false);
        // Also flushes the in-flight listen, so leaving the screen
        // mid-Echo still records how much was actually heard.
        stopCurrentSound();
      };
      // stopCurrentSound is redeclared every render; listing it here would
      // re-run this focus effect constantly and cut playback each time.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [headerButtonsOpacity])
  );

  useEffect(() => {
    listeningModeRef.current = listeningMode;
  }, [listeningMode]);

  useEffect(() => {
    Animated.timing(feedPresence, {
      toValue: commentsOpen || activityOpen || shareOpen ? 1 : 0,
      duration: 240,
      useNativeDriver: true,
    }).start();
  }, [activityOpen, commentsOpen, feedPresence, shareOpen]);

  useEffect(() => {
    setBottomDockSuppressed(commentsOpen || activityOpen || shareOpen);
  }, [activityOpen, commentsOpen, shareOpen]);

  useEffect(() => {
    return () => {
      setBottomDockSuppressed(false);
    };
  }, []);

  useEffect(() => {
    Animated.timing(shareActionPresence, {
      toValue: selectedSharePerson ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [selectedSharePerson, shareActionPresence]);

  useEffect(() => {
    const trimmedQuery = shareQuery.trim().replace(/^@/, '').toLowerCase();

    if (!sharePost || !trimmedQuery) {
      setSharePeople([]);
      setShareLoading(false);
      return;
    }

    let cancelled = false;

    async function searchPeople() {
      setShareLoading(true);

      const { data: userData } = await supabase.auth.getUser();
      const currentUserId = userData.user?.id;

      if (!currentUserId) {
        if (!cancelled) setShareLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, avatar_url')
        .ilike('username', `%${trimmedQuery}%`)
        .neq('id', currentUserId)
        .limit(20);

      if (cancelled) return;

      if (error) {
        setSharePeople([]);
        setShareLoading(false);
        return;
      }

      setSharePeople(
        ((data ?? []) as ProfileIdentity[]).map((profile) => ({
          id: profile.id,
          username: cleanUsername(profile.username),
          displayName: null,
          avatarUrl: profile.avatar_url,
        }))
      );
      setShareLoading(false);
    }

    const timeout = setTimeout(searchPeople, 180);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [sharePost, shareQuery]);

  async function stopCurrentSound() {
    // Flush before tearing down: pausing, switching Echo, or leaving the
    // screen all land here, and each is a real listen worth recording.
    void flushListenProgress();

    try {
      if (soundRef.current) {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }

      playingIdRef.current = null;
      playbackEventRef.current = null;
      durationMillisRef.current = null;
      setPlayingId(null);
      setIsSoundPlaying(false);
      setPlaybackProgress(0);
    } catch {
      soundRef.current = null;
      playingIdRef.current = null;
      playbackEventRef.current = null;
      durationMillisRef.current = null;
      setPlayingId(null);
      setIsSoundPlaying(false);
      setPlaybackProgress(0);
    }
  }

  async function getCurrentUserId() {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  }

  // The listener's own offset from UTC, so Echo Impact can talk about
  // night where they actually were instead of where the server is.
  // Minutes, and negated because getTimezoneOffset reports the inverse.
  function localUtcOffsetMinutes() {
    return -new Date().getTimezoneOffset();
  }

  async function insertEchoEvent(
    voiceNoteId: string,
    userId: string,
    eventType: EchoEventType,
    extra: Record<string, number | null> = {}
  ) {
    await supabase.from('echo_events').insert({
      voice_note_id: voiceNoteId,
      user_id: userId,
      event_type: eventType,
      ...extra,
    });
  }

  // Writes how far this listen actually got. Called whenever playback
  // stops -- finished, paused, switched away, or the screen went away --
  // and guarded by `flushed` so one listen only ever records once.
  async function flushListenProgress() {
    const playback = playbackEventRef.current;

    if (!playback || playback.flushed || playback.heardMs <= 0) return;

    playback.flushed = true;

    try {
      const userId = await getCurrentUserId();
      if (!userId) return;

      await insertEchoEvent(playback.voiceNoteId, userId, 'listen_progress', {
        heard_ms: Math.round(playback.heardMs),
        total_ms: playback.totalMs ? Math.round(playback.totalMs) : null,
        utc_offset_minutes: localUtcOffsetMinutes(),
      });
    } catch {
      // Impact tracking should never interrupt listening.
    }
  }

  async function recordEchoEvent(voiceNoteId: string, eventType: EchoEventType) {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return;

      await insertEchoEvent(voiceNoteId, userId, eventType);
    } catch {
      // Impact tracking should never interrupt listening, reacting, or sharing.
    }
  }

  async function recordPlaybackStarted(post: VoicePost) {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return;

      const playedInSession = !!playedEchoIdsRef.current[post.id];
      let playedBefore = playedInSession;

      if (!playedBefore) {
        const { count } = await supabase
          .from('echo_events')
          .select('*', { count: 'exact', head: true })
          .eq('voice_note_id', post.id)
          .eq('user_id', userId)
          .eq('event_type', 'play_started');

        playedBefore = (count ?? 0) > 0;
      }

      await insertEchoEvent(post.id, userId, 'play_started', {
        utc_offset_minutes: localUtcOffsetMinutes(),
      });
      playedEchoIdsRef.current[post.id] = true;

      if (playedBefore) {
        await insertEchoEvent(post.id, userId, 'replayed');
      }
    } catch {
      // Impact tracking is intentionally quiet.
    }
  }

  async function fetchPosts() {
    setLoading(true);

    const { data: userData } = await supabase.auth.getUser();

    if (!userData.user) {
      setPosts([]);
      setLoading(false);
      return;
    }

    const { data: tuneIns, error: tuneInsError } = await supabase
      .from('tune_ins')
      .select('frequency_owner_id')
      .eq('listener_id', userData.user.id)
      .eq('status', 'accepted');

    if (tuneInsError) {
      void hapticError();
      Alert.alert('Feed Error', tuneInsError.message);
      setLoading(false);
      return;
    }

    const ownerIds = [...new Set((tuneIns ?? []).map((tuneIn) => tuneIn.frequency_owner_id))];

    if (ownerIds.length === 0) {
      setPosts([]);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('voice_notes')
      .select('*')
      .in('user_id', ownerIds)
      .is('deleted_at', null)
      .is('archived_at', null)
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      void hapticError();
      Alert.alert('Feed Error', error.message);
      setLoading(false);
      return;
    }

    const postRows = (data ?? []) as VoicePost[];
    const postIds = postRows.map((post) => post.id);
    const postUserIds = [...new Set(postRows.map((post) => post.user_id))];
    const [{ data: profileData }, { data: reactionData }] = await Promise.all([
      postUserIds.length > 0
        ? supabase
            .from('profiles')
            .select('id, username, avatar_url')
            .in('id', postUserIds)
        : Promise.resolve({ data: [] }),
      postIds.length > 0
        ? supabase
            .from('reactions')
            .select('voice_note_id')
            .eq('user_id', userData.user.id)
            .in('voice_note_id', postIds)
        : Promise.resolve({ data: [] }),
    ]);
    const profileByUserId = new Map(
      ((profileData ?? []) as ProfileIdentity[]).map((profile) => [profile.id, profile])
    );
    const likedFromServer = new Set(
      ((reactionData ?? []) as { voice_note_id: string }[]).map(
        (reaction) => reaction.voice_note_id
      )
    );

    setLikedPostIds((current) => {
      const next = { ...current };

      postIds.forEach((postId) => {
        const syncState = likeSyncByPostRef.current[postId];
        const serverLiked = likedFromServer.has(postId);

        if (!syncState?.inFlight) {
          next[postId] = serverLiked;
          likedPostIdsRef.current[postId] = serverLiked;
          confirmedLikedPostIdsRef.current[postId] = serverLiked;
        }
      });

      return next;
    });

    setPosts(
      postRows.map((post) => ({
        ...post,
        username: profileByUserId.get(post.user_id)?.username ?? post.username,
        avatarUrl: profileByUserId.get(post.user_id)?.avatar_url ?? null,
      }))
    );
    setLoading(false);
  }

  async function fetchOwnProfile() {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    const { data, error } = await supabase
      .from('profiles')
      .select('username, avatar_url, feed_suggestions_enabled')
      .eq('id', userData.user.id)
      .maybeSingle();

    if (error || !data) return;

    setOwnAvatarUrl(data.avatar_url);
    setOwnUsername(data.username ?? '');
    setFeedSuggestionsEnabled(data.feed_suggestions_enabled ?? true);
  }

  async function fetchNotifications() {
    const { data: userData } = await supabase.auth.getUser();

    if (!userData.user) return { userId: '', notifications: [] as ActivityNotification[] };

    setActivityUserId(userData.user.id);

    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('recipient_id', userData.user.id)
      .neq('type', 'whisper')
      .order('created_at', { ascending: false });

    if (error) return { userId: userData.user.id, notifications: [] as ActivityNotification[] };

    const rawNotifications = (data ?? []).filter(
      (notification) => notification.type !== 'whisper'
    );
    const actorIds = [
      ...new Set(
        rawNotifications
          .map((notification) => notification.actor_id)
          .filter(Boolean)
      ),
    ];
    const tuneInActorIds = rawNotifications
      .filter((notification) => notification.type === 'tune_in')
      .map((notification) => notification.actor_id);
    const [{ data: actorProfiles }, tuneInResult, reciprocalTuneInResult] = await Promise.all([
      actorIds.length > 0
        ? supabase
            .from('profiles')
            .select('id, username, avatar_url')
            .in('id', actorIds)
        : Promise.resolve({ data: [] }),
      tuneInActorIds.length > 0
        ? supabase
            .from('tune_ins')
            .select('id, listener_id, frequency_owner_id, status, created_at, responded_at')
            .eq('frequency_owner_id', userData.user.id)
            .in('listener_id', tuneInActorIds)
        : Promise.resolve({ data: [] }),
      tuneInActorIds.length > 0
        ? supabase
            .from('tune_ins')
            .select('id, listener_id, frequency_owner_id, status, created_at, responded_at')
            .eq('listener_id', userData.user.id)
            .in('frequency_owner_id', tuneInActorIds)
        : Promise.resolve({ data: [] }),
    ]);

    const profileByActorId = new Map(
      ((actorProfiles ?? []) as ProfileIdentity[]).map((profile) => [
        profile.id,
        profile,
      ])
    );

    const incomingRows = (tuneInResult.data ?? []) as TuneInActivityRow[];
    const outgoingRows = (reciprocalTuneInResult.data ?? []) as TuneInActivityRow[];
    const incomingByActor = new Map<string, TuneInActivityRow>();
    const outgoingByOwner = new Map<string, TuneInActivityRow>();

    for (const actorId of tuneInActorIds) {
      const incoming = chooseTuneInRow(incomingRows.filter((row) => row.listener_id === actorId));
      const outgoing = chooseTuneInRow(outgoingRows.filter((row) => row.frequency_owner_id === actorId));
      if (incoming) incomingByActor.set(actorId, incoming);
      if (outgoing) outgoingByOwner.set(actorId, outgoing);
    }

    const mappedNotifications = rawNotifications.map((notification) => {
      const actorProfile = profileByActorId.get(notification.actor_id);
      const incoming = notification.type === 'tune_in'
        ? incomingByActor.get(notification.actor_id)
        : undefined;
      const outgoing = notification.type === 'tune_in'
        ? outgoingByOwner.get(notification.actor_id)
        : undefined;
      // Prefer the actual incoming pending row. An accepted row in the
      // opposite direction must never make that pending row passive. The
      // timestamp only associates an acceptance notification with its row;
      // direction itself is derived from the selected row's IDs below.
      const hasIncomingPending = incoming?.status === 'pending';
      const isOutgoingAcceptedEvent = !hasIncomingPending && Boolean(
        outgoing?.status === 'accepted' &&
        outgoing.responded_at &&
        new Date(notification.created_at).getTime() >=
          new Date(outgoing.responded_at).getTime()
      );
      const request = isOutgoingAcceptedEvent ? outgoing : incoming ?? outgoing;
      const direction = request
        ? request.frequency_owner_id === userData.user.id &&
          request.listener_id !== userData.user.id
          ? 'incoming'
          : request.listener_id === userData.user.id &&
              request.frequency_owner_id !== userData.user.id
            ? 'outgoing'
            : undefined
        : undefined;

      return {
        ...notification,
        actorUsername:
          actorProfile?.username ?? usernameFromNotificationMessage(notification.message),
        actorAvatarUrl: actorProfile?.avatar_url ?? null,
        tuneInStatus:
          notification.type === 'tune_in' && incoming
            ? incoming.status
            : undefined,
        reciprocalTuneInStatus:
          notification.type === 'tune_in' && outgoing
            ? outgoing.status
            : undefined,
        direction,
        requestStatus: request?.status,
        requestId: request?.id,
        requesterId: request?.listener_id,
        recipientId: request?.frequency_owner_id,
        activityKey: request
          ? `tune_in:${request.id}:${direction}:${notification.actor_id}`
          : `notification:${notification.id}`,
      };
    });

    const dedupedByDirection = new Map<string, ActivityNotification>();

    for (const notification of mappedNotifications) {
      const logicalKey = notification.type === 'tune_in'
        ? `tune_in:${notification.direction ?? 'unknown'}:${notification.actor_id}`
        : notification.activityKey;
      const existing = dedupedByDirection.get(logicalKey);
      dedupedByDirection.set(
        logicalKey,
        existing ? chooseActivityNotification(existing, notification) : notification
      );
    }

    const nextNotifications = [...dedupedByDirection.values()].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    setNotifications(nextNotifications);
    setUnreadCount(nextNotifications.filter((notification) => !notification.read).length);

    return { userId: userData.user.id, notifications: nextNotifications };
  }

  async function playVoice(post: VoicePost, seekFraction?: number) {
    if (loadingIdRef.current === post.id) {
      // Already loading this Echo — don't start a second concurrent load,
      // just remember where the drag wants to land once it's ready.
      if (seekFraction != null) {
        pendingLoadSeekRef.current = seekFraction;
        setPlaybackProgress(Math.max(0, Math.min(1, seekFraction)));
      }
      return;
    }

    loadingIdRef.current = post.id;
    try {
      await stopCurrentSound();

      setPlayingId(post.id);
      setPlaybackProgress(Math.max(0, Math.min(1, seekFraction ?? 0)));
      playingIdRef.current = post.id;

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      const { sound, status: initialStatus } = await Audio.Sound.createAsync({
        uri: post.audio_url,
      });

      if (loadingIdRef.current !== post.id) {
        // A newer load for a different Echo superseded this one while we
        // were awaiting createAsync — discard this now-orphaned sound
        // instead of letting it clobber soundRef.
        await sound.unloadAsync();
        return;
      }

      soundRef.current = sound;
      durationMillisRef.current =
        initialStatus.isLoaded && initialStatus.durationMillis
          ? initialStatus.durationMillis
          : null;

      await sound.setVolumeAsync(1.0);
      await sound.setProgressUpdateIntervalAsync(100);

      const targetSeekFraction = pendingLoadSeekRef.current ?? seekFraction;
      pendingLoadSeekRef.current = null;

      if (targetSeekFraction != null && durationMillisRef.current) {
        await sound.setPositionAsync(
          Math.max(0, Math.min(1, targetSeekFraction)) * durationMillisRef.current
        );
      }

      await sound.playAsync();

      // A scrub event may have raced in after soundRef.current was
      // populated above but before playAsync settled — seekVoice defers
      // to pendingLoadSeekRef instead of calling setPositionAsync directly
      // while loadingIdRef is held, so pick up that position now rather
      // than silently dropping it.
      if (pendingLoadSeekRef.current != null && durationMillisRef.current) {
        const latestSeek = pendingLoadSeekRef.current;
        pendingLoadSeekRef.current = null;
        await sound.setPositionAsync(
          Math.max(0, Math.min(1, latestSeek)) * durationMillisRef.current
        );
      }

      setIsSoundPlaying(true);
      playbackEventRef.current = {
        voiceNoteId: post.id,
        completed: false,
        heardMs: 0,
        totalMs: durationMillisRef.current,
        flushed: false,
      };
      void recordPlaybackStarted(post);

      sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
        if (!status.isLoaded) return;

        if (status.durationMillis) {
          durationMillisRef.current = status.durationMillis;
        }

        // Track the furthest point reached rather than the current one,
        // so scrubbing backwards does not shrink how much was heard.
        const playback = playbackEventRef.current;
        if (playback?.voiceNoteId === post.id) {
          playback.heardMs = Math.max(playback.heardMs, status.positionMillis ?? 0);
          if (status.durationMillis) playback.totalMs = status.durationMillis;
        }

        if (status.durationMillis && playingIdRef.current === post.id && !seekingRef.current) {
          setPlaybackProgress(status.positionMillis / status.durationMillis);
        }

        if (status.didJustFinish) {
          if (
            playbackEventRef.current?.voiceNoteId === post.id &&
            !playbackEventRef.current.completed
          ) {
            playbackEventRef.current.completed = true;
            if (playbackEventRef.current.totalMs) {
              playbackEventRef.current.heardMs = playbackEventRef.current.totalMs;
            }
            void recordEchoEvent(post.id, 'completed');
          }

          void flushListenProgress();

          setPlayingId(null);
          playingIdRef.current = null;
          playbackEventRef.current = null;
          setIsSoundPlaying(false);
          setPlaybackProgress(0);
        }
      });
    } catch (error: any) {
      setPlayingId(null);
      playingIdRef.current = null;
      setIsSoundPlaying(false);
      setPlaybackProgress(0);
      void hapticError();
      Alert.alert('Playback Error', error.message);
    } finally {
      if (loadingIdRef.current === post.id) {
        loadingIdRef.current = null;
      }
    }
  }

  async function playVoiceManually(post: VoicePost, seekFraction?: number) {
    listeningModeRef.current = true;
    setListeningMode(true);
    await playVoice(post, seekFraction);
  }

  async function togglePlayback(post: VoicePost) {
    if (playingIdRef.current === post.id && soundRef.current) {
      try {
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
      } catch (error: any) {
        void hapticError();
        Alert.alert('Playback Error', error.message);
        return;
      }
    }

    await playVoiceManually(post);
  }

  function isSeekInterruptedError(error: any) {
    const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
    return message.includes('seek') && message.includes('interrupt');
  }

  async function seekVoice(post: VoicePost, fraction: number) {
    const clamped = Math.max(0, Math.min(1, fraction));

    if (loadingIdRef.current === post.id) {
      // playVoice is still loading/setting up this Echo's sound object.
      // Calling setPositionAsync directly here would race playVoice's own
      // in-flight setPositionAsync call on the same sound and get rejected
      // with "Seeking interrupted" — defer to the pending-seek slot it
      // already checks instead.
      pendingLoadSeekRef.current = clamped;
      setPlaybackProgress(clamped);
      return;
    }

    if (playingIdRef.current !== post.id || !soundRef.current) {
      await playVoiceManually(post, clamped);
      return;
    }

    // Give the waveform an instant visual response even while the audio
    // engine is still catching up to the requested position.
    setPlaybackProgress(clamped);

    if (seekingRef.current) {
      pendingSeekRef.current = { post, fraction: clamped };
      return;
    }

    seekingRef.current = true;
    try {
      if (durationMillisRef.current) {
        await soundRef.current.setPositionAsync(clamped * durationMillisRef.current);
      }
    } catch (error: any) {
      if (!isSeekInterruptedError(error)) {
        void hapticError();
        Alert.alert('Playback Error', error.message);
      }
    } finally {
      seekingRef.current = false;
      const pending = pendingSeekRef.current;
      pendingSeekRef.current = null;
      if (pending) {
        void seekVoice(pending.post, pending.fraction);
      }
    }
  }

  function setPostLiked(postId: string, liked: boolean) {
    likedPostIdsRef.current[postId] = liked;
    setLikedPostIds((current) => ({
      ...current,
      [postId]: liked,
    }));
  }

  function showLikeSyncError() {
    setSuccessMessage('Could not update like. Please try again.');
    setTimeout(() => setSuccessMessage(null), 2200);
  }

  async function persistLikeToServer(post: VoicePost, liked: boolean) {
    const { data: userData } = await supabase.auth.getUser();

    if (!userData.user) {
      console.error('[Like] missing authenticated user', { voiceNoteId: post.id });
      return { ok: false, userId: null, email: null, error: 'Missing authenticated user' };
    }

    const result = liked
      ? await supabase.from('reactions').upsert(
          {
            user_id: userData.user.id,
            voice_note_id: post.id,
            reaction: '❤️',
          },
          {
            onConflict: 'user_id,voice_note_id',
          }
        )
      : await supabase
          .from('reactions')
          .delete()
          .eq('user_id', userData.user.id)
          .eq('voice_note_id', post.id);

    const { error } = result;

    if (error) {
      console.error('[Like] Supabase sync failed', {
        voiceNoteId: post.id,
        liked,
        error,
      });
      return { ok: false, userId: userData.user.id, email: userData.user.email, error };
    }

    return { ok: true, userId: userData.user.id, email: userData.user.email, error: null };
  }

  async function syncLike(post: VoicePost) {
    const postId = post.id;
    const syncState = likeSyncByPostRef.current[postId];

    if (!syncState || syncState.inFlight) return;

    syncState.inFlight = true;

    while (syncState.desired !== !!confirmedLikedPostIdsRef.current[postId]) {
      const desiredLiked = syncState.desired;
      const result = await persistLikeToServer(post, desiredLiked);

      if (!result.ok) {
        if (syncState.desired === desiredLiked) {
          const rollbackLiked = !!confirmedLikedPostIdsRef.current[postId];
          syncState.desired = rollbackLiked;
          setPostLiked(postId, rollbackLiked);
          showLikeSyncError();
          void hapticError();
          break;
        }

        continue;
      }

      confirmedLikedPostIdsRef.current[postId] = desiredLiked;

      if (desiredLiked && result.userId) {
        void recordEchoEvent(postId, 'liked');
        void (async () => {
          try {
            const actorUsername = await fetchUsernameForUser(result.userId, result.email);
            await createNotification({
              recipientId: post.user_id,
              actorId: result.userId,
              type: 'reaction',
              voiceNoteId: postId,
              message: `@${actorUsername} reacted ❤️ to your Echo.`,
            });
          } catch (error) {
            console.error('[Like] notification failed', {
              voiceNoteId: postId,
              error,
            });
          }
        })();
      }
    }

    syncState.inFlight = false;
  }

  function toggleLike(post: VoicePost) {
    const postId = post.id;
    const nextLiked = !likedPostIdsRef.current[postId];

    void light();
    setPostLiked(postId, nextLiked);

    const syncState = likeSyncByPostRef.current[postId] ?? {
      desired: nextLiked,
      inFlight: false,
    };
    syncState.desired = nextLiked;
    likeSyncByPostRef.current[postId] = syncState;

    if (!syncState.inFlight) {
      void syncLike(post);
    }

    return nextLiked;
  }

  async function openFrequency(post: VoicePost) {
    await stopCurrentSound();
    void light();
    router.push({
      pathname: '/frequency/[userId]',
      params: { userId: post.user_id },
    });
  }

  async function openComments(post: VoicePost) {
    await stopCurrentSound();
    void light();
    activitySheetRef.current?.close();
    shareSheetRef.current?.close();
    setBottomDockSuppressed(true);
    setCommentsOpen(true);
    setSelectedPost(post);
    setCommentText('');
    commentsSheetRef.current?.snapToIndex(0);
  }

  async function openActivity() {
    await stopCurrentSound();
    commentsSheetRef.current?.close();
    shareSheetRef.current?.close();
    setActivityLoading(true);
    activitySheetRef.current?.snapToIndex(0);

    const {
      userId,
      notifications: latestNotifications,
    } = await fetchNotifications();
    setActivityLoading(false);

    if (!userId) return;

    const unreadIds = latestNotifications
      .filter((notification) => !notification.read)
      .map((notification) => notification.id);

    if (unreadIds.length === 0) return;

    setNotifications((current) =>
      current.map((notification) => ({ ...notification, read: true }))
    );
    setUnreadCount(0);

    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('recipient_id', userId)
      .eq('read', false);
  }

  async function respondToTuneIn(
    notification: ActivityNotification,
    action: 'accepted' | 'declined'
  ) {
    const { data: userData } = await supabase.auth.getUser();

    if (!userData.user) {
      void hapticError();
      Alert.alert('Login needed', 'Please log in again.');
      return;
    }

    if (
      notification.recipientId !== userData.user.id ||
      notification.requesterId === userData.user.id ||
      notification.requestStatus !== 'pending'
    ) return;

    console.log('Responding to Tune In request', {
      notification_id: notification.id,
      notification_actor_id: notification.actor_id,
      current_user_id: userData.user.id,
      action,
    });

    if (!notification.requestId) {
      void hapticError();
      Alert.alert('Tune In Error', 'This Tune In request is no longer available.');
      return;
    }

    try {
      await respondToTuneInRequest(notification.requestId, action);
    } catch (error) {
      void hapticError();
      Alert.alert(
        'Tune In Error',
        error instanceof Error ? error.message : 'Could not update the request.'
      );
      return;
    }

    const actorUsername =
      notification.actorUsername ??
      usernameFromNotificationMessage(notification.message) ??
      'someone';
    const nextMessage =
      action === 'accepted'
        ? `@${actorUsername} is now tuned into your Frequency.`
        : `@${actorUsername} was not allowed to tune into your Frequency.`;

    setNotifications((current) =>
      current.map((item) =>
        item.id === notification.id
          ? {
              ...item,
              message: nextMessage,
              read: true,
              tuneInStatus: action,
              requestStatus: action,
            }
          : item
      )
    );
    setUnreadCount((current) => (notification.read ? current : Math.max(0, current - 1)));

    if (action === 'accepted') {
      animateActivityTransition(notification.activityKey);
    }

    const { error: notificationError } = await supabase
      .from('notifications')
      .update({
        message: nextMessage,
        read: true,
      })
      .eq('id', notification.id);

    if (notificationError) {
      console.error('Tune In notification update failed', notificationError);
      await fetchNotifications();
      void hapticError();
      Alert.alert('Tune In Error', notificationError.message);
      return;
    }

    if (action === 'accepted') {
      const ownerUsername = await fetchUsernameForUser(userData.user.id, userData.user.email);

      await createNotification({
        recipientId: notification.actor_id,
        actorId: userData.user.id,
        type: 'tune_in',
        voiceNoteId: null,
        message: `@${ownerUsername} let you tune into their Frequency.`,
      });
    }

    await fetchNotifications();

  }

  async function tuneIntoRequester(notification: ActivityNotification) {
    if (
      notification.reciprocalTuneInStatus === 'accepted' ||
      notification.reciprocalTuneInStatus === 'pending' ||
      reciprocalSubmittingIds[notification.activityKey]
    ) return;

    setReciprocalSubmittingIds((current) => ({ ...current, [notification.activityKey]: true }));

    try {
      const result = await requestTuneIn(notification.actor_id);

      // requestTuneIn is idempotent. Re-read both directions so the CTA is
      // always a projection of server truth, including after a stale sheet.
      await fetchNotifications();
      if (result.status === 'pending') void light();
    } catch (error) {
      void hapticError();
      await fetchNotifications();
      Alert.alert(
        'Tune In Error',
        error instanceof Error ? error.message : 'Could not send request.'
      );
    } finally {
      setReciprocalSubmittingIds((current) => {
        const next = { ...current };
        delete next[notification.activityKey];
        return next;
      });
    }
  }

  async function deleteActivityNotification(notification: ActivityNotification) {
    const previousNotifications = notifications;
    const previousUnreadCount = unreadCount;

    setNotifications((current) => current.filter((item) => item.id !== notification.id));
    if (!notification.read) {
      setUnreadCount((current) => Math.max(0, current - 1));
    }

    try {
      await deleteNotification(notification.id);
    } catch (error) {
      setNotifications(previousNotifications);
      setUnreadCount(previousUnreadCount);
      void hapticError();
      Alert.alert(
        'Could not delete',
        error instanceof Error ? error.message : 'Please try again.'
      );
    }
  }

  async function postComment() {
    const body = commentText.trim();

    if (!selectedPost || !body) return;

    const { data: userData } = await supabase.auth.getUser();
    const username = userData.user
      ? await fetchUsernameForUser(userData.user.id, userData.user.email)
      : 'someone';
    const { data: profileData } = userData.user
      ? await supabase
          .from('profiles')
          .select('avatar_url')
          .eq('id', userData.user.id)
          .maybeSingle()
      : { data: null };
    const profile = profileData as { avatar_url: string | null } | null;

    const nextComment: EchoComment = {
      id: `${selectedPost.id}-${Date.now()}`,
      username,
      avatarUrl: profile?.avatar_url ?? null,
      body,
      createdAt: new Date().toISOString(),
    };

    setCommentsByPost((current) => ({
      ...current,
      [selectedPost.id]: [...(current[selectedPost.id] ?? []), nextComment],
    }));

    await createNotification({
      recipientId: selectedPost.user_id,
      actorId: userData.user?.id ?? '',
      type: 'comment',
      voiceNoteId: selectedPost.id,
      message: `@${username} commented on your Echo.`,
    });
    void recordEchoEvent(selectedPost.id, 'commented');

    setCommentText('');
    Keyboard.dismiss();
  }

  async function openShareSheet(post: VoicePost) {
    await stopCurrentSound();
    void light();
    commentsSheetRef.current?.close();
    activitySheetRef.current?.close();
    setShareOpen(true);
    setBottomDockSuppressed(true);
    setSharePost(post);
    setShareQuery('');
    setSharePeople([]);
    setSelectedSharePerson(null);
    setShareNote('');
    setShareLoading(false);
    shareSheetRef.current?.snapToIndex(0);
  }

  async function sendSharedEcho() {
    if (!sharePost || shareSending) return;

    if (!selectedSharePerson) {
      void hapticError();
      Alert.alert('Choose someone to send this to.');
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    const currentUserId = userData.user?.id;

    if (!currentUserId) {
      void hapticError();
      Alert.alert('Login needed', 'Please log in again.');
      return;
    }

    try {
      setShareSending(true);

      const thread = await openOrCreateWhisperThread(selectedSharePerson.id);
      const cleanNote = shareNote.trim();
      const { error: messageError } = await supabase.from('whisper_messages').insert({
        thread_id: thread.id,
        sender_id: currentUserId,
        receiver_id: selectedSharePerson.id,
        message_type: 'shared_echo',
        shared_voice_note_id: sharePost.id,
        caption: cleanNote || null,
        audio_url: null,
        duration: null,
      });

      if (messageError) {
        void hapticError();
        Alert.alert('Share Error', messageError.message);
        setShareSending(false);
        return;
      }

      await insertEchoEvent(sharePost.id, currentUserId, 'shared_to_whisper');

      setShareSending(false);
      setSharePost(null);
      void medium();
      shareSheetRef.current?.close();
      Keyboard.dismiss();
      setSuccessMessage('Echo sent.');
      setTimeout(() => setSuccessMessage(null), 2200);
    } catch (error: any) {
      setShareSending(false);
      void hapticError();
      Alert.alert('Share Error', error.message);
    }
  }

  function selectSharePerson(person: SharePerson) {
    Keyboard.dismiss();

    setSelectedSharePerson((current) => {
      const nextPerson = current?.id === person.id ? null : person;

      if (current?.id !== nextPerson?.id) {
        setShareNote('');
      }

      return nextPerson;
    });
  }

  const renderBackdrop = useCallback(
    (props: BottomSheetDefaultBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.24}
        pressBehavior="close"
      />
    ),
    []
  );

  const selectedComments = selectedPost ? commentsByPost[selectedPost.id] ?? [] : [];
  const feedScale = feedPresence.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.975],
  });
  const feedOpacity = feedPresence.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.82],
  });

  const handleCommentsSheetChange = useCallback((index: number) => {
    const isOpen = index >= 0;

    setCommentsOpen(isOpen);

    if (!isOpen) {
      Keyboard.dismiss();
    }
  }, []);

  const handleActivitySheetChange = useCallback((index: number) => {
    setActivityOpen(index >= 0);
  }, []);

  const handleShareSheetChange = useCallback((index: number) => {
    setShareOpen(index >= 0);

    if (index < 0) {
      setSharePost(null);
      setSelectedSharePerson(null);
      setShareNote('');
      setShareQuery('');
      Keyboard.dismiss();
    }
  }, []);

  const handleProfilePress = useCallback(() => {
    void light();
    router.push('/frequency');
  }, []);

  if (loading) {
    return (
      <View style={styles.emptyContainer}>
        <FrequencyLogoLoader size={62} label="Loading echoes..." />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.feedLayer,
          {
            opacity: feedOpacity,
            transform: [{ scale: feedScale }],
          },
        ]}
      >
        <FlatList
          ref={feedListRef}
          data={feedItems}
          keyExtractor={(item) => (item.kind === 'echo' ? item.post.id : 'suggestion-card')}
          pagingEnabled
          scrollEnabled={feedScrollEnabled}
          showsVerticalScrollIndicator={false}
          snapToInterval={height}
          decelerationRate="fast"
          viewabilityConfig={viewabilityConfig}
          onViewableItemsChanged={onViewableItemsChanged}
          onScroll={handleFeedScroll}
          scrollEventThrottle={16}
          onScrollBeginDrag={() => {
            if (playingIdRef.current) {
              stopCurrentSound();
            }
          }}
          onMomentumScrollBegin={() => {
            if (playingIdRef.current) {
              stopCurrentSound();
            }
          }}
          ListEmptyComponent={
            <View style={styles.emptyFeedPost}>
              <View style={styles.headerTop}>
                <ProfileButton avatarUrl={ownAvatarUrl} username={ownUsername} onPress={handleProfilePress} />
                <ActivityButton
                  unreadCount={unreadCount}
                  hasPendingTuneInRequest={hasPendingTuneInRequest}
                  hasUnseenLike={hasUnseenLike}
                  hasOtherUnread={hasOtherUnread}
                  onPress={openActivity}
                />
              </View>

              <View style={styles.emptyFeedCopy}>
                <FrequencyLogo size={86} opacity={0.16} style={styles.emptyLogo} />
                <Text style={styles.emptyTitle}>Nothing to hear yet.</Text>
                <Text style={styles.emptyText}>
                  Tune into people to build your Frequency.
                </Text>
              </View>
            </View>
          }
          renderItem={({ item: feedItem, index }) => {
            if (feedItem.kind === 'suggestion') {
              return (
                <SuggestionFeedCard
                  suggestions={feedItem.suggestions}
                  height={height}
                  onLongPress={openSuggestionQuickAction}
                  onClose={suggestionHasEchoAfter ? undefined : handleCloseSuggestion}
                />
              );
            }

            const item = feedItem.post;
            const isLoaded = playingId === item.id;
            const isPlaying = isLoaded && isSoundPlaying;
            const isLiked = !!likedPostIds[item.id];

            return (
              <View style={styles.post}>
                {index === 0 ? (
                  <View style={styles.header}>
                    <HeaderButtonsRow
                      avatarUrl={ownAvatarUrl}
                      username={ownUsername}
                      unreadCount={unreadCount}
                      hasPendingTuneInRequest={hasPendingTuneInRequest}
                      hasUnseenLike={hasUnseenLike}
                      hasOtherUnread={hasOtherUnread}
                      onProfilePress={handleProfilePress}
                      onActivityPress={openActivity}
                      opacity={headerButtonsOpacity}
                      visible={headerButtonsVisible}
                    />
                    <Text style={styles.title}>Latest Echoes</Text>
                    <Text style={styles.subtitle}>Listen in.</Text>
                  </View>
                ) : (
                  <View style={styles.compactHeader}>
                    <HeaderButtonsRow
                      avatarUrl={ownAvatarUrl}
                      username={ownUsername}
                      unreadCount={unreadCount}
                      hasPendingTuneInRequest={hasPendingTuneInRequest}
                      hasUnseenLike={hasUnseenLike}
                      hasOtherUnread={hasOtherUnread}
                      onProfilePress={handleProfilePress}
                      onActivityPress={openActivity}
                      opacity={headerButtonsOpacity}
                      visible={headerButtonsVisible}
                    />
                  </View>
                )}

                <View style={styles.echoBlockTarget}>
                  <View style={styles.echoBlock}>
                  <EchoAura active={isPlaying} size={AURA_SIZE} />

                  <View style={styles.userRow}>
                    <Touchable
                      style={styles.avatar}
                      activeOpacity={0.82}
                      onPress={() => openFrequency(item)}
                    >
                      <View style={[styles.avatarRing, isLoaded && styles.avatarRingActive]}>
                        <Avatar
                          avatarUrl={item.avatarUrl}
                          initial={item.username}
                          size={54}
                          textSize={22}
                          backgroundColor={C.accent}
                          textColor="#0B100D"
                          borderColor="transparent"
                        />
                      </View>
                    </Touchable>

                    <View>
                      <Touchable
                        activeOpacity={0.82}
                        onPress={() => openFrequency(item)}
                      >
                        <Text style={styles.username}>@{item.username}</Text>
                      </Touchable>
                      <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
                    </View>
                  </View>

                  <Text style={styles.echoTitle}>
                    {item.caption || 'Untitled Echo'}
                  </Text>

                  <View style={styles.playerRow}>
                    <EchoPlayButton
                      isPlaying={isPlaying}
                      onPress={() => {
                        void togglePlayback(item);
                      }}
                    />

                    <View style={styles.waveformWrap}>
                      <FrequencyWaveform
                        active={isLoaded}
                        progress={isLoaded ? playbackProgress : 0}
                        waveform={item.waveform}
                        gap={3}
                        fill
                        onSeek={(fraction) => {
                          void seekVoice(item, fraction);
                        }}
                        onScrubStart={() => setFeedScrollEnabled(false)}
                        onScrubEnd={() => setFeedScrollEnabled(true)}
                      />
                    </View>
                  </View>

                  <View style={styles.actionRow}>
                    <LikeAction liked={isLiked} onPress={() => toggleLike(item)} />

                    <Touchable
                      style={styles.action}
                      activeOpacity={0.82}
                      onPress={() => openComments(item)}
                    >
                      <Ionicons name="chatbubble-outline" size={21} color={C.text} />
                    </Touchable>

                    <Touchable
                      style={styles.action}
                      activeOpacity={0.82}
                      onPress={() => openShareSheet(item)}
                    >
                      <Ionicons name="paper-plane-outline" size={21} color={C.text} />
                    </Touchable>
                  </View>
                  </View>
                </View>
              </View>
            );
          }}
        />
      </Animated.View>

      {successMessage && (
        <View style={styles.successPill}>
          <Text style={styles.successText}>{successMessage}</Text>
        </View>
      )}

      <BottomSheet
        ref={commentsSheetRef}
        index={-1}
        snapPoints={commentsSnapPoints}
        enablePanDownToClose
        detached
        bottomInset={14}
        backdropComponent={renderBackdrop}
        backgroundStyle={styles.sheetBackground}
        handleIndicatorStyle={styles.sheetHandle}
        style={styles.sheet}
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
        android_keyboardInputMode="adjustResize"
        onChange={handleCommentsSheetChange}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
          style={styles.commentsKeyboardAvoider}
        >
          <View style={styles.commentsSheet}>
            <Pressable style={styles.commentsHeader} onPress={Keyboard.dismiss}>
              <Text style={styles.commentsTitle}>Comments • {selectedComments.length}</Text>
            </Pressable>

            <View style={styles.commentsDivider} />

            <BottomSheetFlatList
              style={styles.commentsListView}
              data={selectedComments}
              keyExtractor={(item) => item.id}
              showsVerticalScrollIndicator={false}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={[
                styles.commentsList,
                selectedComments.length === 0 && styles.commentsListEmpty,
              ]}
              ListEmptyComponent={
                <Pressable style={styles.emptyComments} onPress={Keyboard.dismiss}>
                  <FrequencyLogo size={50} opacity={0.14} style={styles.sheetEmptyLogo} />
                  <Text style={styles.emptyCommentsTitle}>No one’s spoken yet.</Text>
                  <Text style={styles.emptyCommentsText}>Be the first.</Text>
                </Pressable>
              }
              renderItem={({ item }) => (
                <View style={styles.commentItem}>
                  <Avatar
                    avatarUrl={item.avatarUrl}
                    initial={item.username}
                    size={38}
                    textSize={16}
                    style={styles.commentAvatar}
                  />
                  <View style={styles.commentContent}>
                    <View style={styles.commentMetaRow}>
                      <Text style={styles.commentUsername}>@{item.username}</Text>
                      <Text style={styles.commentTime}>{commentTimeAgo(item.createdAt)}</Text>
                    </View>
                    <Text style={styles.commentBody}>{item.body}</Text>
                  </View>
                </View>
              )}
            />

            <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 12) + 10 }]}>
              <BottomSheetTextInput
                style={styles.commentInput}
                value={commentText}
                onChangeText={setCommentText}
                placeholder="Share a thought..."
                placeholderTextColor={C.faint}
                multiline
              />
              <Touchable
                style={[
                  styles.postCommentButton,
                  !commentText.trim() && styles.postCommentButtonDisabled,
                ]}
                activeOpacity={0.86}
                onPress={postComment}
                disabled={!commentText.trim()}
              >
                <Text style={styles.postCommentText}>Post</Text>
              </Touchable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </BottomSheet>

      <BottomSheet
        ref={activitySheetRef}
        index={-1}
        snapPoints={activitySnapPoints}
        enablePanDownToClose
        detached
        bottomInset={14}
        backdropComponent={renderBackdrop}
        backgroundStyle={styles.sheetBackground}
        handleIndicatorStyle={styles.sheetHandle}
        style={styles.sheet}
        onChange={handleActivitySheetChange}
      >
        <View style={styles.activitySheet}>
          <View style={styles.activityHeader}>
            <Text style={styles.activityTitle}>Activity</Text>
            <Text style={styles.activitySubtitle}>
              What changed while you were away.
            </Text>
          </View>

          <View style={styles.commentsDivider} />

          <BottomSheetFlatList
            data={notifications}
            keyExtractor={(item) => item.requestId ?? item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.activityList}
            ListEmptyComponent={
              <View style={styles.emptyActivity}>
                {activityLoading ? (
                  <>
                    <FrequencyLogoLoader size={42} />
                    <Text style={styles.emptyActivityText}>Loading activity...</Text>
                  </>
                ) : (
                  <>
                    <FrequencyLogo size={54} opacity={0.14} style={styles.sheetEmptyLogo} />
                    <Text style={styles.emptyActivityTitle}>Nothing new yet.</Text>
                    <Text style={styles.emptyActivityText}>
                      When people tune in, react, or comment, you’ll see it here.
                    </Text>
                  </>
                )}
              </View>
            }
            renderItem={({ item }) => {
              const actorInitial = item.actorUsername?.charAt(0).toUpperCase() ?? '?';
              const isTuneInRequest = item.type === 'tune_in';
              const isIncomingPending =
                isTuneInRequest &&
                item.recipientId === activityUserId &&
                item.requesterId !== activityUserId &&
                item.requestStatus === 'pending';
              const isIncomingAccepted =
                isTuneInRequest &&
                item.recipientId === activityUserId &&
                item.requesterId !== activityUserId &&
                item.requestStatus === 'accepted';
              const showTuneInActions = isIncomingPending || isIncomingAccepted;
              const transition = activityTransitionValue(item);
              const transitionIn = transition.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 1],
              });
              const transitionOut = transition.interpolate({
                inputRange: [0, 1],
                outputRange: [1, 0],
              });

              return (
                <SwipeToDeleteRow
                  activeRowRef={activeActivityRowCloserRef}
                  onDelete={() => deleteActivityNotification(item)}
                >
                  <View style={styles.activityRow}>
                    <Avatar
                      avatarUrl={item.actorAvatarUrl}
                      initial={actorInitial}
                      size={42}
                      textSize={17}
                      style={styles.activityAvatar}
                    />

                    <View style={styles.activityCopy}>
                      <Text style={styles.activityMessage}>{item.message}</Text>
                      <Text style={styles.activityTime}>{timeAgo(item.created_at)}</Text>
                      {showTuneInActions && (
                        <View style={styles.activityActionSlot}>
                          <Animated.View
                            style={{ opacity: isIncomingAccepted ? transitionIn : transitionOut }}
                          >
                            {isIncomingAccepted ? (
                              <Touchable
                                style={[
                                  styles.activityReciprocalAction,
                                  (item.reciprocalTuneInStatus === 'accepted' ||
                                    item.reciprocalTuneInStatus === 'pending') &&
                                    styles.activityReciprocalActionDone,
                                ]}
                                activeOpacity={0.82}
                                onPress={() => tuneIntoRequester(item)}
                                disabled={
                                  item.reciprocalTuneInStatus === 'accepted' ||
                                  item.reciprocalTuneInStatus === 'pending' ||
                                  reciprocalSubmittingIds[item.activityKey]
                                }
                              >
                                {reciprocalSubmittingIds[item.activityKey] ? (
                                  <ActivityIndicator size="small" color="#0B100D" />
                                ) : (
                                  <Text
                                    style={[
                                      styles.activityReciprocalActionText,
                                      (item.reciprocalTuneInStatus === 'accepted' ||
                                        item.reciprocalTuneInStatus === 'pending') &&
                                        styles.activityReciprocalActionTextDone,
                                    ]}
                                  >
                                    {item.reciprocalTuneInStatus === 'accepted'
                                      ? '✓ Tuned In'
                                      : item.reciprocalTuneInStatus === 'pending'
                                        ? 'Requested'
                                        : 'Tune In'}
                                  </Text>
                                )}
                              </Touchable>
                            ) : (
                              <View style={styles.activityActions}>
                                <Touchable
                                  style={styles.activityPrimaryAction}
                                  activeOpacity={0.86}
                                  onPress={() => respondToTuneIn(item, 'accepted')}
                                >
                                  <Text style={styles.activityPrimaryActionText}>Accept</Text>
                                </Touchable>

                                <Touchable
                                  style={styles.activitySecondaryAction}
                                  activeOpacity={0.86}
                                  onPress={() => respondToTuneIn(item, 'declined')}
                                >
                                  <Text style={styles.activitySecondaryActionText}>Ignore</Text>
                                </Touchable>
                              </View>
                            )}
                          </Animated.View>
                        </View>
                      )}
                    </View>

                    {!item.read && <View style={styles.activityUnreadDot} />}
                  </View>
                </SwipeToDeleteRow>
              );
            }}
          />
        </View>
      </BottomSheet>

      <BottomSheet
        ref={shareSheetRef}
        index={-1}
        snapPoints={shareSnapPoints}
        enablePanDownToClose
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
        android_keyboardInputMode="adjustResize"
        bottomInset={0}
        backdropComponent={renderBackdrop}
        backgroundStyle={styles.sheetBackground}
        handleIndicatorStyle={styles.sheetHandle}
        style={[styles.sheet, styles.shareSheetLayer]}
        onChange={handleShareSheetChange}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
          style={styles.shareKeyboardView}
        >
        <View style={[styles.shareSheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.shareHeader}>
            <Text style={styles.shareTitle}>Share to Whispers</Text>
            <Text style={styles.shareSubtitle}>
              Send this Echo into a private voice chat.
            </Text>
          </View>

          <View style={styles.shareControls}>
            <View style={styles.shareSearchShell}>
              <Ionicons name="search" size={18} color={C.faint} />
              <BottomSheetTextInput
                value={shareQuery}
                onChangeText={(text) => {
                  setShareQuery(text);
                  setSelectedSharePerson(null);
                  setShareNote('');
                }}
                placeholder="Search people..."
                placeholderTextColor={C.faint}
                autoCapitalize="none"
                autoCorrect={false}
                selectionColor={C.accent}
                style={styles.shareSearchInput}
              />
            </View>
          </View>

          <BottomSheetFlatList
            data={sharePeople}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            style={styles.shareListView}
            contentContainerStyle={[
              styles.shareList,
              selectedSharePerson && styles.shareListWithAction,
            ]}
            ListEmptyComponent={
              <View style={styles.emptyShare}>
                {shareLoading ? (
                  <>
                    <FrequencyLogoLoader size={42} />
                    <Text style={styles.emptyShareText}>Searching people...</Text>
                  </>
                ) : (
                  <>
                    <FrequencyLogo size={46} opacity={0.14} style={styles.sheetEmptyLogo} />
                    <Text style={styles.emptyShareText}>
                      {shareQuery.trim()
                        ? 'No people found.'
                        : 'Search for someone to send this Echo.'}
                    </Text>
                  </>
                )}
              </View>
            }
            renderItem={({ item }) => {
              const selected = selectedSharePerson?.id === item.id;

              return (
                <Touchable
                  style={[styles.sharePersonRow, selected && styles.selectedSharePersonRow]}
                  activeOpacity={0.84}
                  onPress={() => selectSharePerson(item)}
                >
                  <Avatar
                    avatarUrl={item.avatarUrl}
                    initial={item.username}
                    size={52}
                    textSize={21}
                    style={styles.shareAvatar}
                  />

                  <View style={styles.sharePersonCopy}>
                    <Text style={styles.shareUsername}>@{item.username}</Text>
                    {item.displayName && (
                      <Text style={styles.shareDisplayName}>{item.displayName}</Text>
                    )}
                  </View>

                  <View style={[styles.selectCircle, selected && styles.selectedCircle]}>
                    {selected && <Ionicons name="checkmark" size={16} color="#0B100D" />}
                  </View>
                </Touchable>
              );
            }}
          />

          <Animated.View
            pointerEvents={selectedSharePerson ? 'auto' : 'none'}
            style={[
              styles.shareFooter,
              {
                opacity: shareActionPresence,
                maxHeight: shareActionPresence.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 220],
                }),
                transform: [
                  {
                    translateY: shareActionPresence.interpolate({
                      inputRange: [0, 1],
                      outputRange: [14, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            {selectedSharePerson && (
              <>
                <View style={styles.selectedShareRecipient}>
                  <Avatar
                    avatarUrl={selectedSharePerson.avatarUrl}
                    initial={selectedSharePerson.username}
                    size={38}
                    textSize={16}
                    style={styles.selectedShareAvatar}
                  />
                  <View style={styles.selectedShareCopy}>
                    <Text style={styles.selectedShareLabel}>Sending to</Text>
                    <Text style={styles.selectedShareName}>@{selectedSharePerson.username}</Text>
                  </View>
                  <Ionicons name="checkmark-circle" size={22} color={C.accent} />
                </View>

                <BottomSheetTextInput
                  value={shareNote}
                  onChangeText={(text) => setShareNote(text.slice(0, 60))}
                  placeholder="Add a tiny note..."
                  placeholderTextColor={C.faint}
                  maxLength={60}
                  selectionColor={C.accent}
                  style={styles.shareNoteInput}
                />
              </>
            )}
            <Touchable
              style={[styles.sendEchoButton, shareSending && styles.sendEchoButtonDisabled]}
              activeOpacity={0.86}
              disabled={shareSending || !selectedSharePerson}
              onPress={sendSharedEcho}
            >
              {shareSending ? (
                <FrequencyLogoLoader size={28} />
              ) : (
                <Text style={styles.sendEchoText}>Send Echo</Text>
              )}
            </Touchable>
          </Animated.View>
        </View>
        </KeyboardAvoidingView>
      </BottomSheet>

      <SuggestionQuickActionSheet
        visible={suggestionQuickActionVisible}
        onConfirm={confirmDisableFeedSuggestions}
        onClose={() => setSuggestionQuickActionVisible(false)}
      />

      <EchoActionToast visible={!!suggestionToastMessage} message={suggestionToastMessage ?? ''} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },

  feedLayer: {
    flex: 1,
    backgroundColor: C.background,
  },

  emptyContainer: {
    flex: 1,
    backgroundColor: C.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 28,
  },

  emptyTitle: {
    color: C.text,
    fontSize: 38,
    fontWeight: '800',
    letterSpacing: -1,
    marginBottom: 12,
    textAlign: 'center',
  },

  emptyText: {
    color: C.muted,
    fontSize: 17,
    textAlign: 'center',
  },

  emptyFeedPost: {
    height,
    backgroundColor: C.background,
    paddingHorizontal: 28,
    paddingTop: 78,
    paddingBottom: 120,
  },

  emptyFeedCopy: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 96,
  },

  emptyLogo: {
    marginBottom: 22,
  },

  post: {
    height,
    backgroundColor: C.background,
    paddingHorizontal: 28,
    paddingTop: 78,
    paddingBottom: 120,
  },

  previewEchoPost: {
    height: 280,
    backgroundColor: C.card,
    marginHorizontal: 28,
    marginTop: 112,
    borderRadius: 28,
    overflow: 'hidden',
  },

  previewEchoContent: {
    minHeight: 240,
    padding: 28,
    justifyContent: 'center',
  },

  previewEchoTitle: {
    color: C.text,
    fontSize: 23,
    fontWeight: '700',
    marginTop: 18,
    marginBottom: 24,
  },

  header: {
    marginBottom: 72,
  },

  compactHeader: {
    marginBottom: 42,
  },

  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 42,
    marginBottom: 26,
  },

  profileGlow: {
    borderRadius: 21,
    shadowColor: C.accent,
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },

  activityButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.divider,
    backgroundColor: C.surface,
    shadowColor: C.accent,
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },

  activityIcon: {
    color: C.text,
    fontSize: 23,
    fontWeight: '800',
    lineHeight: 25,
  },

  unreadDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.accent,
  },

  tuneInBadge: {
    position: 'absolute',
    bottom: -40,
    right: 2,
  },

  title: {
    color: C.text,
    fontSize: 50,
    fontWeight: '900',
    letterSpacing: -1.8,
  },

  subtitle: {
    color: C.muted,
    fontSize: 21,
    marginTop: 14,
  },

  echoBlockTarget: {
    flex: 1,
  },

  echoBlock: {
    flex: 1,
    justifyContent: 'center',
    paddingBottom: 44,
  },

  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 42,
  },

  avatar: {
    marginRight: 14,
  },

  avatarRing: {
    padding: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'transparent',
  },

  // The ring only lights up on the Echo currently loaded, so the page you
  // are hearing is identifiable at a glance while paging.
  avatarRingActive: {
    borderColor: 'rgba(107,168,130,0.55)',
  },

  username: {
    color: C.text,
    fontSize: 18,
    fontWeight: '700',
  },

  time: {
    color: C.muted,
    fontSize: 14,
    marginTop: 4,
  },

  echoTitle: {
    color: C.text,
    fontSize: 42,
    fontWeight: '900',
    letterSpacing: -1.2,
    marginBottom: 52,
  },

  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  playButton: {
    width: PLAY_BUTTON_SIZE,
    height: PLAY_BUTTON_SIZE,
    borderRadius: PLAY_BUTTON_SIZE / 2,
    backgroundColor: C.accent,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 22,
  },

  // Optically centres the play triangle, which is visually right-heavy.
  playIconNudge: {
    marginLeft: 3,
  },

  playPulse: {
    position: 'absolute',
    width: PLAY_BUTTON_SIZE,
    height: PLAY_BUTTON_SIZE,
    borderRadius: PLAY_BUTTON_SIZE / 2,
    backgroundColor: C.accent,
  },

  waveformWrap: {
    flex: 1,
  },

  divider: {
    height: 1,
    backgroundColor: C.divider,
    marginTop: 46,
    marginBottom: 26,
  },

  actionRow: {
    flexDirection: 'row',
    gap: 18,
    marginTop: 26,
  },

  action: {
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'visible',
    padding: 8,
  },

  likeBurst: {
    position: 'absolute',
    left: 7,
    top: 6,
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },

  actionText: {
    color: C.text,
    fontSize: 22,
  },

  likedActionText: {
    color: '#FF3B30',
  },

  sheet: {
    marginHorizontal: 12,
    zIndex: 40,
    elevation: 40,
  },

  shareSheetLayer: {
    marginHorizontal: 0,
    zIndex: 90,
    elevation: 90,
  },

  sheetBackground: {
    backgroundColor: C.surface,
    borderRadius: 32,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.06)',
  },

  sheetHandle: {
    width: 42,
    height: 4,
    borderRadius: 3,
    backgroundColor: 'rgba(226,237,232,0.26)',
  },

  commentsKeyboardAvoider: {
    flex: 1,
    backgroundColor: C.surface,
  },

  commentsSheet: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: C.surface,
    borderRadius: 32,
  },

  commentsHeader: {
    paddingHorizontal: 28,
    paddingTop: 20,
    paddingBottom: 18,
  },

  commentsTitle: {
    color: C.text,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.3,
  },

  commentsDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.045)',
  },

  commentsList: {
    paddingHorizontal: 28,
    paddingTop: 8,
    paddingBottom: 22,
  },

  commentsListView: {
    flex: 1,
  },

  commentsListEmpty: {
    flexGrow: 1,
  },

  emptyComments: {
    flex: 1,
    minHeight: 240,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingBottom: 28,
  },

  sheetEmptyLogo: {
    marginBottom: 18,
  },

  emptyCommentsTitle: {
    color: C.text,
    fontSize: 23,
    fontWeight: '800',
    marginBottom: 12,
  },

  emptyCommentsText: {
    color: C.muted,
    fontSize: 17,
    lineHeight: 24,
  },

  commentItem: {
    flexDirection: 'row',
    gap: 14,
    paddingTop: 26,
    paddingBottom: 28,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.045)',
  },

  commentAvatar: {
    borderColor: 'rgba(255,255,255,0.06)',
  },

  commentContent: {
    flex: 1,
  },

  commentMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 9,
  },

  commentUsername: {
    color: C.text,
    fontSize: 14,
    fontWeight: '800',
  },

  commentTime: {
    color: 'rgba(145,161,154,0.55)',
    fontSize: 12,
    fontWeight: '600',
  },

  commentBody: {
    color: C.muted,
    fontSize: 17,
    lineHeight: 26,
  },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.055)',
    backgroundColor: C.surface,
  },

  commentInput: {
    flex: 1,
    minHeight: 48,
    maxHeight: 96,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.07)',
    backgroundColor: C.card,
    color: C.text,
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: 18,
    paddingTop: 13,
    paddingBottom: 13,
  },

  postCommentButton: {
    height: 48,
    paddingHorizontal: 20,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.accent,
  },

  postCommentButtonDisabled: {
    opacity: 0.45,
  },

  postCommentText: {
    color: '#0B100D',
    fontSize: 15,
    fontWeight: '900',
  },

  activitySheet: {
    flex: 1,
    overflow: 'hidden',
  },

  activityHeader: {
    paddingHorizontal: 28,
    paddingTop: 20,
    paddingBottom: 22,
  },

  activityTitle: {
    color: C.text,
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: -0.7,
  },

  activitySubtitle: {
    color: C.muted,
    fontSize: 16,
    lineHeight: 23,
    marginTop: 8,
  },

  activityList: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 48,
  },

  emptyActivity: {
    paddingHorizontal: 4,
    paddingTop: 54,
  },

  emptyActivityTitle: {
    color: C.text,
    fontSize: 23,
    fontWeight: '800',
    marginBottom: 12,
  },

  emptyActivityText: {
    color: C.muted,
    fontSize: 17,
    lineHeight: 25,
  },

  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 22,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.045)',
  },

  activityAvatar: {
    borderColor: 'rgba(255,255,255,0.06)',
  },

  activityCopy: {
    flex: 1,
  },

  activityMessage: {
    color: C.text,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '700',
  },

  activityTime: {
    color: 'rgba(145,161,154,0.62)',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 6,
  },

  activityActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },

  activityActionSlot: {
    height: 40,
    marginTop: 16,
    alignItems: 'flex-start',
  },

  activityPrimaryAction: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: C.accent,
  },

  activityPrimaryActionText: {
    color: '#0B100D',
    fontSize: 13,
    fontWeight: '900',
  },

  activitySecondaryAction: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.divider,
    backgroundColor: C.card,
  },

  activitySecondaryActionText: {
    color: C.text,
    fontSize: 13,
    fontWeight: '800',
  },

  activityReciprocalAction: {
    minWidth: 92,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: C.accent,
    // Same glow treatment as the other Tune In capsules (SuggestionBubble,
    // PeopleSuggestionRow) -- signals this one's still actionable.
    shadowColor: C.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.24,
    shadowRadius: 12,
    elevation: 4,
  },

  activityReciprocalActionDone: {
    backgroundColor: 'transparent',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.divider,
    shadowOpacity: 0,
    elevation: 0,
  },

  activityReciprocalActionText: {
    color: '#0B100D',
    fontSize: 13,
    fontWeight: '800',
  },

  activityReciprocalActionTextDone: {
    color: C.muted,
  },

  activityUnreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.accent,
    marginRight: 2,
  },

  successPill: {
    position: 'absolute',
    top: 74,
    alignSelf: 'center',
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderRadius: 21,
    backgroundColor: C.accent,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
  },

  successText: {
    color: '#0B100D',
    fontSize: 14,
    fontWeight: '900',
  },

  shareSheet: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: C.surface,
  },

  shareKeyboardView: {
    flex: 1,
  },

  shareHeader: {
    paddingHorizontal: 28,
    paddingTop: 20,
    paddingBottom: 18,
  },

  shareTitle: {
    color: C.text,
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: -0.7,
  },

  shareSubtitle: {
    color: C.muted,
    fontSize: 16,
    lineHeight: 23,
    marginTop: 8,
  },

  shareControls: {
    gap: 12,
    paddingHorizontal: 24,
    paddingBottom: 16,
  },

  shareSearchShell: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    borderRadius: 24,
    backgroundColor: C.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.07)',
  },

  shareSearchInput: {
    flex: 1,
    color: C.text,
    fontSize: 16,
    fontWeight: '700',
    paddingVertical: 12,
  },

  shareNoteInput: {
    minHeight: 52,
    borderRadius: 24,
    backgroundColor: C.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.07)',
    color: C.text,
    fontSize: 15,
    fontWeight: '700',
    paddingHorizontal: 18,
  },

  shareList: {
    paddingHorizontal: 24,
    paddingTop: 4,
    paddingBottom: 24,
  },

  shareListView: {
    flex: 1,
  },

  shareListWithAction: {
    paddingBottom: 18,
  },

  sharePersonRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.045)',
  },

  selectedSharePersonRow: {
    marginHorizontal: -8,
    paddingHorizontal: 8,
    borderRadius: 22,
    backgroundColor: 'rgba(107,168,130,0.1)',
  },

  shareAvatar: {
    borderColor: 'rgba(255,255,255,0.06)',
  },

  sharePersonCopy: {
    flex: 1,
  },

  shareUsername: {
    color: C.text,
    fontSize: 17,
    fontWeight: '800',
  },

  shareDisplayName: {
    color: C.muted,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },

  selectCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.divider,
  },

  selectedCircle: {
    borderColor: C.accent,
    backgroundColor: C.accent,
  },

  emptyShare: {
    minHeight: 130,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },

  emptyShareText: {
    color: C.muted,
    fontSize: 16,
    lineHeight: 23,
    textAlign: 'center',
  },

  shareFooter: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.055)',
    backgroundColor: C.surface,
    gap: 12,
    overflow: 'hidden',
  },

  selectedShareRecipient: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 24,
    backgroundColor: C.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.07)',
  },

  selectedShareAvatar: {
    borderColor: 'rgba(255,255,255,0.06)',
  },

  selectedShareCopy: {
    flex: 1,
  },

  selectedShareLabel: {
    color: C.faint,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },

  selectedShareName: {
    color: C.text,
    fontSize: 16,
    fontWeight: '900',
    marginTop: 2,
  },

  sendEchoButton: {
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.accent,
  },

  sendEchoButtonDisabled: {
    opacity: 0.62,
  },

  sendEchoText: {
    color: '#0B100D',
    fontSize: 15,
    fontWeight: '900',
  },
});
