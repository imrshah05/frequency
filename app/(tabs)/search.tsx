import { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Touchable from '@/components/Touchable';
import Avatar from '../../components/Avatar';
import SpringIn from '@/components/SpringIn';
import { FrequencyLogo, FrequencyLogoLoader } from '@/components/branding/FrequencyLogo';
import SearchBar from '@/components/SearchBar';
import SuggestionBubble from '@/components/SuggestionBubble';
import { useSuggestedTuneIns } from '@/hooks/useSuggestedTuneIns';
import type { SuggestedTuneIn } from '@/lib/suggestedTuneIns';
import { router, useFocusEffect } from 'expo-router';
import {
  FrequencyColors as C,
  FrequencyRadius as R,
  FrequencySpacing as S,
} from '../../constants/frequencyTheme';
import { supabase } from '../../lib/supabase';
import { selection } from '@/lib/haptics';

// Pool loaded vs. shown: the preview only ever shows three, but dismissing
// one should reveal the next-ranked candidate rather than leave a gap, so a
// slightly deeper page is fetched up front.
const SUGGESTION_POOL = 6;
const SUGGESTION_PREVIEW = 3;

type FrequencyResult = {
  userId: string;
  username: string;
  avatarUrl: string | null;
};

type ProfileIdentity = {
  id: string;
  username: string | null;
  avatar_url: string | null;
};

function cleanUsername(username: string | null | undefined) {
  return String(username ?? 'frequency')
    .replace(/^@/, '')
    .trim();
}

/**
 * What Search shows before a single character is typed. Deliberately never
 * blank: a short Suggested Tune-Ins preview in the same visual language as
 * the Feed and profiles -- rounded bubbles with mutual/shared badges, no
 * new discovery surface or new query. The suggestions come from the same
 * useSuggestedTuneIns hook the Feed and profiles already use.
 *
 * The suggestions themselves are owned by the screen, not by this component:
 * this unmounts as soon as the user types, and owning the hook here would
 * re-run the query every time the field is cleared.
 */
function PreSearchState({
  preview,
}: {
  preview: SuggestedTuneIn[];
}) {
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.scrollContent}
    >
      {preview.length > 0 && (
        <View style={styles.suggestionsSection}>
          <SpringIn delay={40}>
            <Text style={styles.eyebrow}>Worth tuning into</Text>
          </SpringIn>

          {preview.map((suggestion, index) => (
            <SpringIn key={suggestion.id} delay={120 + index * 70}>
              <SuggestionBubble suggestion={suggestion} index={index} />
            </SpringIn>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

export default function SearchScreen() {
  const [query, setQuery] = useState('');
  const [currentUserId, setCurrentUserId] = useState('');
  const [frequencies, setFrequencies] = useState<FrequencyResult[]>([]);
  const [loading, setLoading] = useState(true);
  const { suggestions } = useSuggestedTuneIns(currentUserId, SUGGESTION_POOL);

  const suggestionPreview = useMemo(
    () => suggestions.slice(0, SUGGESTION_PREVIEW),
    [suggestions]
  );

  useFocusEffect(
    useCallback(() => {
      let mounted = true;

      async function loadFrequencies() {
        setLoading(true);

        const [{ data: userData }, { data }] = await Promise.all([
          supabase.auth.getUser(),
          supabase
            .from('profiles')
            .select('id, username, avatar_url, created_at')
            .order('created_at', { ascending: false }),
        ]);

        if (!mounted) return;

        const me = userData.user?.id ?? '';
        const seen = new Set<string>();
        const nextFrequencies = ((data ?? []) as ProfileIdentity[]).reduce<FrequencyResult[]>(
          (results, profile) => {
            if (!profile.id || profile.id === me || seen.has(profile.id)) {
              return results;
            }

            seen.add(profile.id);
            results.push({
              userId: profile.id,
              username: cleanUsername(profile.username),
              avatarUrl: profile.avatar_url,
            });

            return results;
          },
          []
        );

        setCurrentUserId(me);
        setFrequencies(nextFrequencies);
        setLoading(false);
      }

      loadFrequencies();

      return () => {
        mounted = false;
      };
    }, [])
  );

  const trimmedQuery = query.trim().replace(/^@/, '').toLowerCase();
  const results = useMemo(() => {
    if (!trimmedQuery) return [];

    return frequencies.filter(
      (frequency) =>
        frequency.userId !== currentUserId &&
        frequency.username.toLowerCase().includes(trimmedQuery)
    );
  }, [currentUserId, frequencies, trimmedQuery]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Search</Text>
        <Text style={styles.subtitle}>Find voices worth tuning into.</Text>

        <View style={styles.searchBarWrap}>
          <SearchBar value={query} onChangeText={setQuery} />
        </View>
      </View>

      {trimmedQuery ? (
        <FlatList
          data={results}
          keyExtractor={(item) => item.userId}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              {loading ? (
                <>
                  <FrequencyLogoLoader size={44} />
                  <Text style={styles.emptyText}>Tuning the dial...</Text>
                </>
              ) : (
                <>
                  <FrequencyLogo size={56} opacity={0.14} style={styles.emptyLogo} />
                  <Text style={styles.emptyText}>No Frequencies found.</Text>
                </>
              )}
            </View>
          }
          renderItem={({ item }) => {
            const initial = item.username.charAt(0).toUpperCase() || 'F';

            return (
              <Touchable
                style={styles.result}
                activeOpacity={0.82}
                onPress={() => {
                  Keyboard.dismiss();
                  void selection();
                  router.push(`/frequency/${item.userId}`);
                }}
              >
                <Avatar
                  avatarUrl={item.avatarUrl}
                  initial={initial}
                  size={54}
                  textSize={22}
                  backgroundColor={C.elevated}
                />

                <View style={styles.resultText}>
                  <Text style={styles.username}>@{item.username}</Text>
                  <Text style={styles.resultSubtitle}>View Frequency</Text>
                </View>
              </Touchable>
            );
          }}
        />
      ) : (
        <PreSearchState preview={suggestionPreview} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.background,
  },

  header: {
    paddingHorizontal: 28,
    paddingTop: 76,
    paddingBottom: S.sm,
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

  searchBarWrap: {
    marginTop: S.lg,
  },

  // One content container for both the pre-search scroll view and the
  // results list, so the gutter and the gap under the search field stay
  // identical as the screen switches between them.
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: S.md,
    paddingBottom: 128,
  },

  suggestionsSection: {
    marginTop: S.xl,
  },

  // Same eyebrow as the Feed's suggestion card and the profile section, so
  // all three read as one system.
  eyebrow: {
    color: C.accentSoft,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginBottom: S.md,
  },

  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 320,
    paddingHorizontal: S.lg,
  },

  emptyLogo: {
    marginBottom: S.md,
  },

  emptyText: {
    color: C.faint,
    fontSize: 17,
    lineHeight: 25,
    textAlign: 'center',
  },

  result: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: S.md,
    padding: S.md,
    borderRadius: R.lg,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.divider,
  },

  resultText: {
    flex: 1,
    minWidth: 0,
    marginLeft: S.md,
  },

  username: {
    color: C.text,
    fontSize: 17,
    fontWeight: '800',
  },

  resultSubtitle: {
    color: C.muted,
    fontSize: 14,
    fontWeight: '600',
    marginTop: S.xs,
  },
});
