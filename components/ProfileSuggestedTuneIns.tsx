import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import SuggestionBubble from '@/components/SuggestionBubble';
import { FrequencyColors as C, FrequencySpacing as S } from '@/constants/frequencyTheme';
import { useSuggestedTuneIns } from '@/hooks/useSuggestedTuneIns';

const FILTER_POOL_LIMIT = 20;
const MAX_SHOWN = 3;

type ProfileSuggestedTuneInsProps = {
  viewerId: string;
  profileOwnerId: string;
};

/**
 * "Also worth tuning into" nudge shown on someone else's profile: no new
 * query -- this filters the viewer's own Suggested Tune-Ins (Phase 1) down
 * to candidates whose mutualUserIds happens to include the profile being
 * viewed, i.e. "you and this person share a connection with X."
 *
 * When that filtered set is empty (the viewer's suggestions don't happen to
 * connect to this particular profile), falls back to the viewer's plain
 * top-ranked suggestions instead of rendering nothing -- still excluding
 * the profile owner themself, since they're already right there with their
 * own Tune In button. The heading drops "Also" in that case, since there's
 * no longer a stated connection to this profile to justify it.
 */
export default function ProfileSuggestedTuneIns({
  viewerId,
  profileOwnerId,
}: ProfileSuggestedTuneInsProps) {
  const { suggestions } = useSuggestedTuneIns(viewerId, FILTER_POOL_LIMIT);

  // suggestions is already ranked by score (getSuggestedTuneIns sorts
  // before returning) -- filtering preserves that order, so no re-sort.
  const related = useMemo(
    () =>
      suggestions
        .filter((suggestion) => suggestion.mutualUserIds.includes(profileOwnerId))
        .slice(0, MAX_SHOWN),
    [suggestions, profileOwnerId]
  );

  const fallback = useMemo(
    () => suggestions.filter((suggestion) => suggestion.id !== profileOwnerId).slice(0, MAX_SHOWN),
    [suggestions, profileOwnerId]
  );

  const shown = related.length > 0 ? related : fallback;

  console.log('[ProfileSuggestedTuneIns] counts', {
    viewerId,
    profileOwnerId,
    poolSize: suggestions.length,
    relatedCount: related.length,
    fallbackCount: fallback.length,
  });

  if (shown.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>
        {related.length > 0 ? 'Also worth tuning into' : 'Worth tuning into'}
      </Text>

      {shown.map((suggestion, index) => (
        <SuggestionBubble key={suggestion.id} suggestion={suggestion} index={index} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: S.xl,
  },

  // Matches SuggestionFeedCard's eyebrow exactly (size, weight, tracking,
  // accent) so the Feed's suggestion moment and this one read as the same
  // system rather than two takes on the same idea.
  heading: {
    color: C.accentSoft,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.6,
    textAlign: 'center',
    marginBottom: S.lg,
  },
});
