import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import BackButton from '@/components/BackButton';
import Touchable from '@/components/Touchable';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Avatar from '../../components/Avatar';
import { FrequencyLogoLoader } from '@/components/branding/FrequencyLogo';
import ProfileAvatarStage from '@/components/ProfileAvatarStage';
import ProfileSuggestedTuneIns from '@/components/ProfileSuggestedTuneIns';
import { router, useLocalSearchParams } from 'expo-router';
import {
  FrequencyColors as C,
  FrequencyRadius as R,
  FrequencySpacing as S,
} from '../../constants/frequencyTheme';
import { useTuneIn } from '../../hooks/useTuneIn';
import { fetchMutualFollowers, type MutualFrequency } from '../../lib/mutuals';
import { supabase } from '../../lib/supabase';
import { openOrCreateWhisperThread } from '../../lib/whispers';
import { error as hapticError, light } from '@/lib/haptics';
import { isEchoLive, liveEchoCutoffIso } from '@/lib/echoLifecycle';

type PublicFrequency = {
  username: string;
  bio: string;
  avatarUrl: string | null;
};

type ProfileRow = {
  username: string | null;
  bio: string | null;
  avatar_url: string | null;
};

export default function PublicFrequencyScreen() {
  const params = useLocalSearchParams<{ userId?: string | string[] }>();
  const userId = useMemo(() => {
    const raw = params.userId;
    return Array.isArray(raw) ? raw[0] ?? '' : raw ?? '';
  }, [params.userId]);

  const [frequency, setFrequency] = useState<PublicFrequency>({
    username: 'frequency',
    bio: '',
    avatarUrl: null,
  });
  const [currentUserId, setCurrentUserId] = useState('');
  const [echoCount, setEchoCount] = useState(0);
  const [liveEchoCreatedAts, setLiveEchoCreatedAts] = useState<string[]>([]);
  const [now, setNow] = useState(Date.now());
  const [mutuals, setMutuals] = useState<MutualFrequency[]>([]);
  const [loadingMutuals, setLoadingMutuals] = useState(false);
  const [loading, setLoading] = useState(true);

  const insets = useSafeAreaInsets();
  const enter = useSharedValue(0);

  const {
    tunedInCount,
    listeningCount,
    tuneInStatus,
    isSubmitting,
    toggleTuneIn,
  } = useTuneIn(userId);
  const isOwnFrequency = currentUserId === userId;
  const buttonText =
    tuneInStatus === 'accepted' ? 'Tuned In' : tuneInStatus === 'pending' ? 'Pending' : 'Tune In';
  const displayUsername = `@${frequency.username.replace(/^@/, '')}`;
  const displayBio = frequency.bio.trim() || 'No bio yet.';
  const initial = frequency.username.charAt(0).toUpperCase();
  const liveEchoCount = liveEchoCreatedAts.filter((createdAt) => isEchoLive(createdAt, now)).length;
  const showMutualsLine = !isOwnFrequency && (loadingMutuals || mutuals.length > 0);
  // Avatars now carry the identity visually, so the label stays one line:
  // a single name plus a count, never a wrapping list of usernames. Tapping
  // opens the full list, so nothing is lost.
  const mutualPreview = useMemo(() => {
    const [first] = mutuals;
    if (!first) return '';

    const remaining = mutuals.length - 1;
    if (remaining === 0) return `Followed by @${first.username}`;

    return `Followed by @${first.username} and ${remaining} ${
      remaining === 1 ? 'other' : 'others'
    }`;
  }, [mutuals]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  // Fades and glides in once the profile is loaded, never on the loader.
  useEffect(() => {
    if (loading) return;
    enter.value = withTiming(1, { duration: 460, easing: Easing.out(Easing.cubic) });
  }, [loading, enter]);

  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: 14 - enter.value * 14 }],
  }));

  function openLiveEchoes() {
    if (liveEchoCount === 0) return;

    void light();
    router.push({
      pathname: '/live-echoes/[userId]',
      params: { userId },
    });
  }

  async function startWhisper() {
    try {
      const thread = await openOrCreateWhisperThread(userId);

      void light();
      router.push({
        pathname: '/whispers/[threadId]',
        params: {
          threadId: thread.id,
          otherUserId: userId,
        },
      });
    } catch (error: any) {
      void hapticError();
      Alert.alert('Whisper Error', error.message);
    }
  }

  function openConnections(type: 'listening' | 'tuned-in') {
    router.push({
      pathname: '/frequency-connections',
      params: { userId, type },
    });
  }

  useEffect(() => {
    let mounted = true;

    async function loadFrequency() {
      if (!userId) {
        setLoading(false);
        return;
      }

      setLoading(true);

      const [{ data: userData }, { data: profile }, liveEchoResult, echoCountResult] =
        await Promise.all([
          supabase.auth.getUser(),
          supabase
            .from('profiles')
            .select('username, bio, avatar_url')
            .eq('id', userId)
            .maybeSingle(),
          supabase
            .from('voice_notes')
            .select('created_at')
            .eq('user_id', userId)
            .is('deleted_at', null)
            .is('archived_at', null)
            .gte('created_at', liveEchoCutoffIso()),
          supabase
            .from('voice_notes')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .is('deleted_at', null),
        ]);

      if (!mounted) return;

      setCurrentUserId(userData.user?.id ?? '');
      setEchoCount(echoCountResult.count ?? 0);
      setFrequency({
        username: (profile as ProfileRow | null)?.username ?? 'frequency',
        bio: (profile as ProfileRow | null)?.bio ?? '',
        avatarUrl: (profile as ProfileRow | null)?.avatar_url ?? null,
      });
      setLiveEchoCreatedAts(
        ((liveEchoResult.data ?? []) as { created_at: string }[])
          .map((echo) => echo.created_at)
          .filter((createdAt) => isEchoLive(createdAt))
      );
      setLoading(false);
    }

    loadFrequency();

    return () => {
      mounted = false;
    };
  }, [userId]);

  // Mutuals are "people I already accept-follow who also follow this
  // profile" -- a pending/withdrawn Tune In toward this profile is never
  // counted as accepted, so it can never change this list. Keyed only on
  // who's viewing which profile, so tapping Tune In/Pending never
  // re-triggers this fetch (or its "Finding mutuals..." flash).
  useEffect(() => {
    let mounted = true;

    async function loadMutuals() {
      if (!currentUserId || !userId || currentUserId === userId) {
        setMutuals([]);
        setLoadingMutuals(false);
        return;
      }

      setLoadingMutuals(true);

      let nextMutuals: MutualFrequency[] = [];
      try {
        nextMutuals = await fetchMutualFollowers(currentUserId, userId);
      } catch {
        nextMutuals = [];
      }

      if (!mounted) return;

      setMutuals(nextMutuals);
      setLoadingMutuals(false);
    }

    loadMutuals();

    return () => {
      mounted = false;
    };
  }, [currentUserId, userId]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <FrequencyLogoLoader size={58} label="Finding this Frequency..." />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 8 }]}
      showsVerticalScrollIndicator={false}
    >
      <BackButton style={styles.backButton} />

      <Animated.View style={[styles.profileBlock, enterStyle]}>
        <ProfileAvatarStage
          avatarUrl={frequency.avatarUrl}
          initial={initial}
          isLive={liveEchoCount > 0}
          onPress={openLiveEchoes}
          disabled={liveEchoCount === 0}
        />

        <Text
          style={styles.name}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {displayUsername}
        </Text>

        {showMutualsLine && (
          <Touchable
            style={styles.mutualsRow}
            activeOpacity={0.7}
            disabled={loadingMutuals}
            onPress={() => {
              router.push({
                pathname: '/mutuals',
                params: { profileUserId: userId },
              });
            }}
          >
            {!loadingMutuals && (
              <View style={styles.mutualsStack}>
                {mutuals.slice(0, 3).map((mutual, index) => (
                  <Avatar
                    key={mutual.id}
                    avatarUrl={mutual.avatarUrl}
                    initial={mutual.username}
                    size={22}
                    textSize={9}
                    backgroundColor={C.elevated}
                    borderColor={C.background}
                    style={[
                      styles.mutualsAvatar,
                      index > 0 && styles.mutualsAvatarStacked,
                    ]}
                  />
                ))}
              </View>
            )}

            <Text style={styles.mutualsText} numberOfLines={1}>
              {loadingMutuals ? 'Finding mutuals...' : mutualPreview}
            </Text>
          </Touchable>
        )}

        {!isOwnFrequency && (
          <View style={styles.actionRow}>
            <Touchable
              style={[
                styles.tuneButton,
                tuneInStatus === 'accepted' && styles.tunedButton,
                tuneInStatus === 'pending' && styles.pendingButton,
              ]}
              activeOpacity={0.86}
              onPress={toggleTuneIn}
              disabled={isSubmitting || tuneInStatus === 'accepted'}
            >
              <Text
                style={[
                  styles.tuneButtonText,
                  (tuneInStatus === 'accepted' || tuneInStatus === 'pending') &&
                    styles.tunedButtonText,
                ]}
              >
                {buttonText}
              </Text>
            </Touchable>

            <Touchable
              style={styles.whisperButton}
              activeOpacity={0.82}
              onPress={startWhisper}
            >
              <Ionicons name="mic-outline" size={17} color={C.accentSoft} />
              <Text style={styles.whisperButtonText}>Whisper</Text>
            </Touchable>
          </View>
        )}
      </Animated.View>

      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statNumber}>{echoCount}</Text>
          <Text style={styles.statLabel}>Echoes</Text>
        </View>

        <View style={styles.statDivider} />

        <Touchable
          style={styles.stat}
          activeOpacity={0.72}
          onPress={() => openConnections('listening')}
        >
          <Text style={styles.statNumber}>{listeningCount}</Text>
          <Text style={styles.statLabel}>Listening To</Text>
        </Touchable>

        <View style={styles.statDivider} />

        <Touchable
          style={styles.stat}
          activeOpacity={0.72}
          onPress={() => openConnections('tuned-in')}
        >
          <Text style={styles.statNumber}>{tunedInCount}</Text>
          <Text style={styles.statLabel}>Tuned In</Text>
        </Touchable>
      </View>

      <View style={styles.aboutSection}>
        <Text style={styles.aboutLabel}>About</Text>
        <Text style={styles.aboutText}>{displayBio}</Text>
      </View>

      {!isOwnFrequency && currentUserId && userId && (
        <ProfileSuggestedTuneIns viewerId={currentUserId} profileOwnerId={userId} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.background,
  },

  content: {
    paddingHorizontal: 26,
    paddingBottom: 120,
  },

  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.background,
    paddingHorizontal: 28,
  },

  backButton: {
    alignSelf: 'flex-start',
  },

  // Pulled up into the bloom's transparent top band, which is layout space
  // nothing is drawn in -- the portrait sits higher without the back button
  // and the hero crowding each other.
  profileBlock: {
    alignItems: 'center',
    marginTop: -S.lg,
  },

  // lineHeight is explicit so the leading around the glyphs is a known amount
  // rather than a platform default, and the gaps either side of the name land
  // the same on iOS and Android.
  name: {
    color: C.text,
    fontSize: 33,
    lineHeight: 38,
    fontWeight: '800',
    letterSpacing: -0.8,
    textAlign: 'center',
  },

  // A distinct section, separated from the hero by the same hairline
  // language statsRow already uses -- not just a subtitle line under the
  // name anymore.
  aboutSection: {
    alignSelf: 'stretch',
    alignItems: 'flex-start',
    marginTop: 36,
    paddingTop: S.xl,
    borderTopWidth: 1,
    borderColor: C.divider,
  },

  aboutLabel: {
    color: C.text,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: S.md,
  },

  aboutText: {
    color: C.text,
    fontSize: 16,
    fontWeight: '500',
    lineHeight: 24,
    textAlign: 'left',
  },

  // Overlapping portraits + one quiet line, the same "seen by" language
  // group Whispers already uses -- not a loud filled pill.
  mutualsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    marginTop: S.lg,
    maxWidth: '100%',
  },

  mutualsStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  mutualsAvatar: {
    borderWidth: 1.5,
  },

  mutualsAvatarStacked: {
    marginLeft: -7,
  },

  mutualsText: {
    flexShrink: 1,
    color: C.muted,
    fontSize: 14,
    fontWeight: '600',
  },

  // Stretches so both actions share the full width evenly -- fill and
  // outline carry the hierarchy, not size.
  // The one gap that separates the hero -- portrait and name -- from
  // everything transactional below it. Deliberately wider than the gap above
  // the name, so the name belongs to the portrait rather than floating
  // between the two halves of the screen.
  actionRow: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    gap: S.sm,
    marginTop: S.xxl,
  },

  tuneButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    borderRadius: R.lg,
    backgroundColor: C.accent,
  },

  tunedButton: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.divider,
  },

  pendingButton: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.divider,
  },

  tuneButtonText: {
    color: '#0B100D',
    fontSize: 16,
    fontWeight: '800',
  },

  tunedButtonText: {
    color: C.text,
  },

  whisperButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 15,
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: 'rgba(107,168,130,0.34)',
  },

  whisperButtonText: {
    color: C.accentSoft,
    fontSize: 16,
    fontWeight: '800',
  },

  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 36,
    paddingVertical: S.xl,
    borderRadius: R.xl,
    borderWidth: 1,
    borderColor: C.divider,
    backgroundColor: C.card,
  },

  stat: {
    flex: 1,
    alignItems: 'center',
  },

  statDivider: {
    width: 1,
    height: 34,
    backgroundColor: C.divider,
  },

  statNumber: {
    color: C.text,
    fontSize: 27,
    fontWeight: '700',
    letterSpacing: -0.4,
  },

  // Sentence case, no tracking: uppercase letterspaced labels read as a
  // financial report, not as two people listening to each other.
  statLabel: {
    color: C.muted,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 6,
  },
});
