import { BlurView } from 'expo-blur';
import { useEffect, useRef } from 'react';
import { Animated, Easing, FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import PeopleSuggestionRow from '@/components/PeopleSuggestionRow';
import type { OnboardingStep } from '@/components/onboarding/types';
import { FrequencyColors as C, FrequencyRadius as R, FrequencySpacing as S } from '@/constants/frequencyTheme';
import { useSuggestedTuneIns } from '@/hooks/useSuggestedTuneIns';

const ONBOARDING_SUGGESTION_LIMIT = 5;

type PeopleSuggestionsLayerProps = {
  step: OnboardingStep;
  userId: string | null;
  onNext?: () => void;
  onSkip?: () => void;
};

/**
 * Jumpstart nudge shown right after the "Echoes Near You" search intro, the
 * first time a user opens Search. Reuses Phase 1's data hook and Phase 2's
 * row component as-is -- this file only adds the full-screen onboarding
 * chrome (blur, progress dots, Skip/Continue) around them.
 *
 * If there's nothing to suggest, this renders nothing and calls onNext
 * immediately (see the effect below) so the step is skipped before it's
 * ever shown, not shown empty.
 */
export function PeopleSuggestionsLayer({ step, userId, onNext, onSkip }: PeopleSuggestionsLayerProps) {
  const insets = useSafeAreaInsets();
  const { suggestions, loading } = useSuggestedTuneIns(userId ?? '', ONBOARDING_SUGGESTION_LIMIT);
  const opacity = useRef(new Animated.Value(0)).current;
  const hasHandledEmptyRef = useRef(false);

  useEffect(() => {
    if (loading || hasHandledEmptyRef.current) return;

    if (suggestions.length === 0) {
      hasHandledEmptyRef.current = true;
      onNext?.();
    }
  }, [loading, suggestions.length, onNext]);

  useEffect(() => {
    if (loading || suggestions.length === 0) return;

    opacity.setValue(0);
    Animated.timing(opacity, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [loading, suggestions.length, opacity]);

  // Nothing to show yet (still loading) or nothing to show at all (empty,
  // already handled above) -- render nothing rather than a blank/empty
  // onboarding screen.
  if (loading || suggestions.length === 0) return null;

  const progress = step.guidance?.progress;

  return (
    <Animated.View pointerEvents="auto" style={[styles.overlay, { opacity }]}>
      <BlurView
        intensity={28}
        tint="dark"
        experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.dim} />

      <View
        style={[
          styles.content,
          { paddingTop: insets.top + S.xl, paddingBottom: insets.bottom + S.lg },
        ]}
      >
        {progress ? (
          <View style={styles.progressRow}>
            {Array.from({ length: progress.total }).map((_, index) => (
              <View
                key={index}
                style={[styles.progressDot, index < progress.current && styles.progressDotActive]}
              />
            ))}
          </View>
        ) : null}

        <Text style={styles.title}>{step.title}</Text>
        <Text style={styles.description}>{step.description}</Text>

        <FlatList
          data={suggestions}
          keyExtractor={(item) => item.id}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => <PeopleSuggestionRow suggestion={item} />}
        />

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={step.secondaryButtonLabel}
            onPress={onSkip}
            hitSlop={12}
            style={styles.skipButton}
          >
            <Text style={styles.skipText}>{step.secondaryButtonLabel}</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={step.primaryButtonLabel}
            onPress={onNext}
            style={styles.continueButton}
          >
            <Text style={styles.continueText}>{step.primaryButtonLabel}</Text>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 999 },

  dim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(17, 22, 20, 0.40)' },

  content: {
    flex: 1,
    paddingHorizontal: S.xl,
  },

  progressRow: {
    flexDirection: 'row',
    gap: 7,
    marginBottom: S.lg,
  },

  progressDot: {
    width: 22,
    height: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(226, 237, 232, 0.16)',
  },

  progressDotActive: {
    backgroundColor: C.accent,
  },

  title: {
    color: C.text,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
  },

  description: {
    color: C.muted,
    fontSize: 16,
    lineHeight: 23,
    marginTop: S.sm,
  },

  list: {
    flex: 1,
    marginTop: S.xl,
  },

  listContent: {
    paddingBottom: S.lg,
  },

  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: S.md,
  },

  skipButton: {
    padding: 4,
  },

  skipText: {
    color: C.muted,
    fontSize: 15,
    fontWeight: '500',
  },

  continueButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    borderRadius: R.xl,
    backgroundColor: C.accent,
  },

  continueText: {
    color: '#111614',
    fontSize: 17,
    fontWeight: '700',
  },
});
