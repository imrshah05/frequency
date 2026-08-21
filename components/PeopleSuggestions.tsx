import { useCallback } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import PeopleSuggestionRow from '@/components/PeopleSuggestionRow';
import { FrequencyLogo, FrequencyLogoLoader } from '@/components/branding/FrequencyLogo';
import { FrequencyColors as C, FrequencySpacing as S } from '@/constants/frequencyTheme';
import { useSuggestedTuneIns } from '@/hooks/useSuggestedTuneIns';

const PAGE_SIZE = 20;

type PeopleSuggestionsProps = {
  currentUserId: string;
};

export default function PeopleSuggestions({ currentUserId }: PeopleSuggestionsProps) {
  const { suggestions, loading, loadingMore, loadMore, dismiss, remove } = useSuggestedTuneIns(
    currentUserId,
    PAGE_SIZE
  );

  const handleActioned = useCallback((id: string) => remove(id), [remove]);
  const handleDismiss = useCallback((id: string) => void dismiss(id), [dismiss]);

  return (
    <FlatList
      data={suggestions}
      keyExtractor={(item) => item.id}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.content}
      onEndReachedThreshold={0.4}
      onEndReached={loadMore}
      renderItem={({ item }) => (
        <PeopleSuggestionRow suggestion={item} onActioned={handleActioned} onDismiss={handleDismiss} />
      )}
      ListEmptyComponent={
        <View style={styles.emptyState}>
          {loading ? (
            <>
              <FrequencyLogoLoader size={44} />
              <Text style={styles.emptySubtitle}>Finding people worth tuning into...</Text>
            </>
          ) : (
            <>
              <FrequencyLogo size={56} opacity={0.14} style={styles.emptyLogo} />
              <Text style={styles.emptyTitle}>Nothing here yet.</Text>
              <Text style={styles.emptySubtitle}>
                As you Tune In and join Group Whispers, we&apos;ll find people worth connecting with.
              </Text>
            </>
          )}
        </View>
      }
      ListFooterComponent={
        loadingMore ? (
          <View style={styles.footer}>
            <FrequencyLogoLoader size={28} />
          </View>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: S.lg,
    paddingBottom: 128,
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
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },

  emptySubtitle: {
    color: C.muted,
    fontSize: 16,
    lineHeight: 24,
    marginTop: S.sm,
    textAlign: 'center',
  },

  footer: {
    paddingVertical: S.lg,
    alignItems: 'center',
  },
});
