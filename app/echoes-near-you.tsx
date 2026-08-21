import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import BackButton from '@/components/BackButton';
import Touchable from '@/components/Touchable';
import { router, useFocusEffect } from 'expo-router';

import Avatar from '@/components/Avatar';
import { FrequencyLogo, FrequencyLogoLoader } from '@/components/branding/FrequencyLogo';
import {
  FrequencyColors as C,
  FrequencyRadius as R,
  FrequencySpacing as S,
} from '@/constants/frequencyTheme';
import { useTuneIn } from '@/hooks/useTuneIn';
import {
  buildTitleDocumentFrequency,
  scoreEchoTitleSimilarity,
} from '@/lib/echoSimilarity';
import { isEchoLive, liveEchoCutoffIso } from '@/lib/echoLifecycle';
import { supabase } from '@/lib/supabase';

type TuneInStatus = 'none' | 'pending' | 'accepted' | 'declined';

type VoiceNoteTitle = {
  id: string;
  user_id: string;
  caption: string | null;
  created_at: string;
};

type ProfileIdentity = {
  id: string;
  username: string | null;
  avatar_url: string | null;
};

type TuneInRow = {
  frequency_owner_id: string;
  status: TuneInStatus;
  created_at: string;
};

type EchoSuggestion = {
  echoId: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  suggestedTitle: string;
  matchedTitle: string;
  score: number;
  status: TuneInStatus;
  createdAt: string;
};

function cleanUsername(username: string | null | undefined) {
  return String(username ?? 'frequency')
    .replace(/^@/, '')
    .trim();
}

function titleFromCaption(caption: string | null | undefined) {
  return caption?.trim() || '';
}

function SuggestionRow({ suggestion }: { suggestion: EchoSuggestion }) {
  const { tuneInStatus, isSubmitting, toggleTuneIn } = useTuneIn(suggestion.userId);
  const displayStatus =
    tuneInStatus === 'none' && suggestion.status !== 'none' ? suggestion.status : tuneInStatus;
  const buttonText =
    displayStatus === 'accepted' ? 'Tuned In' : displayStatus === 'pending' ? 'Pending' : 'Tune In';
  const isDisabled =
    isSubmitting || displayStatus === 'pending' || displayStatus === 'accepted';
  const initial = suggestion.username.charAt(0).toUpperCase() || 'F';

  return (
    <Touchable
      style={styles.suggestionCard}
      activeOpacity={0.84}
      onPress={() => router.push(`/frequency/${suggestion.userId}`)}
    >
      <Avatar
        avatarUrl={suggestion.avatarUrl}
        initial={initial}
        size={58}
        textSize={24}
        backgroundColor={C.elevated}
      />

      <View style={styles.suggestionText}>
        <Text style={styles.username}>@{suggestion.username}</Text>
        <Text style={styles.echoTitle} numberOfLines={2}>
          {suggestion.suggestedTitle}
        </Text>
        <Text style={styles.matchText} numberOfLines={1}>
          Similar to “{suggestion.matchedTitle}”
        </Text>
      </View>

      <Touchable
        style={[
          styles.tuneButton,
          displayStatus === 'pending' && styles.pendingButton,
          displayStatus === 'accepted' && styles.tunedButton,
        ]}
        activeOpacity={0.86}
        onPress={(event) => {
          event.stopPropagation();
          toggleTuneIn();
        }}
        disabled={isDisabled}
      >
        <Text
          style={[
            styles.tuneButtonText,
            (displayStatus === 'pending' || displayStatus === 'accepted') &&
              styles.tunedButtonText,
          ]}
        >
          {buttonText}
        </Text>
      </Touchable>
    </Touchable>
  );
}

export default function EchoesNearYouScreen() {
  const [suggestions, setSuggestions] = useState<EchoSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasLiveEcho, setHasLiveEcho] = useState(true);
  const currentLiveEchoCreatedAtRef = useRef<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const emptyCopy = useMemo(() => {
    if (!hasLiveEcho) {
      return {
        title: 'Share a live Echo first.',
        subtitle: 'We’ll find voices close to what you have live.',
      };
    }

    return {
      title: 'Nothing close yet.',
      subtitle: 'Check back after more Echoes are shared.',
    };
  }, [hasLiveEcho]);

  const loadSuggestions = useCallback(async ({ quiet = false } = {}) => {
    if (quiet) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    const { data: userData } = await supabase.auth.getUser();
    const me = userData.user?.id;

    if (!me) {
      setSuggestions([]);
      setHasLiveEcho(false);
      currentLiveEchoCreatedAtRef.current = null;
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const liveCutoff = liveEchoCutoffIso();
    const { data: myEchoRows } = await supabase
      .from('voice_notes')
      .select('id, user_id, caption, created_at')
      .eq('user_id', me)
      .is('deleted_at', null)
      .is('archived_at', null)
      .gte('created_at', liveCutoff)
      .order('created_at', { ascending: false })
      .limit(1);

    const currentLiveEcho = ((myEchoRows ?? []) as VoiceNoteTitle[])
      .map((echo) => ({
        ...echo,
        title: titleFromCaption(echo.caption),
      }))
      .find((echo) => echo.title.length > 0 && isEchoLive(echo.created_at));

    if (!currentLiveEcho) {
      setSuggestions([]);
      setHasLiveEcho(false);
      currentLiveEchoCreatedAtRef.current = null;
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setHasLiveEcho(true);
    currentLiveEchoCreatedAtRef.current = currentLiveEcho.created_at;

    const [{ data: tuneInRows }, { data: candidateRows }] = await Promise.all([
      supabase
        .from('tune_ins')
        .select('frequency_owner_id, status, created_at')
        .eq('listener_id', me)
        .order('created_at', { ascending: false }),
      supabase
        .from('voice_notes')
        .select('id, user_id, caption, created_at')
        .neq('user_id', me)
        .is('deleted_at', null)
        .is('archived_at', null)
        .gte('created_at', liveCutoff)
        .order('created_at', { ascending: false })
        .limit(300),
    ]);

    const statusByOwnerId = new Map<string, TuneInStatus>();

    ((tuneInRows ?? []) as TuneInRow[]).forEach((row) => {
      if (!statusByOwnerId.has(row.frequency_owner_id)) {
        statusByOwnerId.set(row.frequency_owner_id, row.status);
      }
    });

    const candidateEchoes = ((candidateRows ?? []) as VoiceNoteTitle[])
      .map((echo) => ({
        ...echo,
        title: titleFromCaption(echo.caption),
      }))
      .filter(
        (echo) =>
          echo.title.length > 0 &&
          isEchoLive(echo.created_at) &&
          statusByOwnerId.get(echo.user_id) !== 'accepted'
      );
    const currentLiveEchoByUserId = new Map<string, (typeof candidateEchoes)[number]>();

    candidateEchoes.forEach((echo) => {
      if (!currentLiveEchoByUserId.has(echo.user_id)) {
        currentLiveEchoByUserId.set(echo.user_id, echo);
      }
    });

    const currentCandidateEchoes = [...currentLiveEchoByUserId.values()];
    const candidateUserIds = currentCandidateEchoes.map((echo) => echo.user_id);
    const { data: profileRows } =
      candidateUserIds.length > 0
        ? await supabase
            .from('profiles')
            .select('id, username, avatar_url')
            .in('id', candidateUserIds)
        : { data: [] };

    const profileById = new Map(
      ((profileRows ?? []) as ProfileIdentity[]).map((profile) => [profile.id, profile])
    );
    const documentFrequency = buildTitleDocumentFrequency([
      currentLiveEcho.title,
      ...currentCandidateEchoes.map((echo) => echo.title),
    ]);
    const bestByUserId = new Map<string, EchoSuggestion>();

    currentCandidateEchoes.forEach((candidate) => {
      const bestScore = scoreEchoTitleSimilarity(
        currentLiveEcho.title,
        candidate.title,
        documentFrequency
      );
      const matchedTitle = currentLiveEcho.title;

      if (bestScore <= 0 || !matchedTitle) return;

      const profile = profileById.get(candidate.user_id);
      const suggestion: EchoSuggestion = {
        echoId: candidate.id,
        userId: candidate.user_id,
        username: cleanUsername(profile?.username),
        avatarUrl: profile?.avatar_url ?? null,
        suggestedTitle: candidate.title,
        matchedTitle,
        score: bestScore,
        status: statusByOwnerId.get(candidate.user_id) ?? 'none',
        createdAt: candidate.created_at,
      };
      const existing = bestByUserId.get(candidate.user_id);

      if (
        !existing ||
        suggestion.score > existing.score ||
        (suggestion.score === existing.score &&
          new Date(suggestion.createdAt).getTime() > new Date(existing.createdAt).getTime())
      ) {
        bestByUserId.set(candidate.user_id, suggestion);
      }
    });

    setSuggestions(
      [...bestByUserId.values()]
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        })
        .slice(0, 20)
    );
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const currentLiveEchoCreatedAt = currentLiveEchoCreatedAtRef.current;

      if (currentLiveEchoCreatedAt && !isEchoLive(currentLiveEchoCreatedAt)) {
        void loadSuggestions({ quiet: true });
        return;
      }

      setSuggestions((current) => {
        if (current.every((suggestion) => isEchoLive(suggestion.createdAt))) {
          return current;
        }

        void loadSuggestions({ quiet: true });
        return current.filter((suggestion) => isEchoLive(suggestion.createdAt));
      });
    }, 30000);

    return () => clearInterval(interval);
  }, [loadSuggestions]);

  useEffect(() => {
    function scheduleRefresh() {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }

      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        void loadSuggestions({ quiet: true });
      }, 650);
    }

    const channel = supabase
      .channel(`echoes-near-you-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'voice_notes',
        },
        scheduleRefresh
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tune_ins',
        },
        scheduleRefresh
      )
      .subscribe();

    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }

      supabase.removeChannel(channel);
    };
  }, [loadSuggestions]);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      loadSuggestions().then(() => {
        if (!active) return;
      });

      return () => {
        active = false;
      };
    }, [loadSuggestions])
  );

  return (
    <View style={styles.screen}>
      <FlatList
        data={suggestions}
        keyExtractor={(item) => item.echoId}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadSuggestions({ quiet: true })}
            tintColor={C.accent}
          />
        }
        ListHeaderComponent={
          <View>
            <BackButton style={styles.backButton} />

            <Text style={styles.title}>Echoes Near You</Text>
            <Text style={styles.subtitle}>Based on the Echoes live right now.</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            {loading ? (
              <>
                <FrequencyLogoLoader size={44} />
                <Text style={styles.emptySubtitle}>Listening for nearby echoes...</Text>
              </>
            ) : (
              <>
                <FrequencyLogo size={62} opacity={0.14} style={styles.emptyLogo} />
                <Text style={styles.emptyTitle}>{emptyCopy.title}</Text>
                <Text style={styles.emptySubtitle}>{emptyCopy.subtitle}</Text>
              </>
            )}
          </View>
        }
        renderItem={({ item }) => <SuggestionRow suggestion={item} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.background,
  },

  content: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: 64,
    paddingBottom: 120,
  },

  backButton: {
    marginBottom: 26,
  },

  title: {
    color: C.text,
    fontSize: 43,
    fontWeight: '800',
  },

  subtitle: {
    color: C.muted,
    fontSize: 18,
    lineHeight: 26,
    marginTop: 8,
    marginBottom: 24,
  },

  suggestionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: S.md,
    padding: 18,
    borderRadius: R.lg,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.divider,
  },

  suggestionText: {
    flex: 1,
    minWidth: 0,
    marginLeft: S.md,
    marginRight: S.sm,
  },

  username: {
    color: C.text,
    fontSize: 17,
    fontWeight: '800',
  },

  echoTitle: {
    color: C.text,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 21,
    marginTop: 7,
  },

  matchText: {
    color: C.muted,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 7,
  },

  tuneButton: {
    minWidth: 82,
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: R.md,
    backgroundColor: C.accent,
  },

  pendingButton: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.divider,
  },

  tunedButton: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.divider,
  },

  tuneButtonText: {
    color: '#0B100D',
    fontSize: 13,
    fontWeight: '800',
  },

  tunedButtonText: {
    color: C.text,
  },

  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 360,
    paddingHorizontal: S.lg,
  },

  emptyLogo: {
    marginBottom: S.lg,
  },

  emptyTitle: {
    color: C.text,
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
  },

  emptySubtitle: {
    color: C.muted,
    fontSize: 17,
    lineHeight: 25,
    marginTop: S.sm,
    textAlign: 'center',
  },
});
