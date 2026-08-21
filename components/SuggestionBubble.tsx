import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import Touchable from './Touchable';

import Avatar from '@/components/Avatar';
import Badge from '@/components/Badge';
import MutualAvatars from '@/components/MutualAvatars';
import { FrequencyColors as C, FrequencySpacing as S } from '@/constants/frequencyTheme';
import { useTuneIn } from '@/hooks/useTuneIn';
import type { SuggestedTuneIn } from '@/lib/suggestedTuneIns';

type SuggestionBubbleProps = {
  suggestion: SuggestedTuneIn;
  /** Position in the stack -- drives both the entrance stagger and which way the bubble leans. */
  index: number;
};

/**
 * The rounded-capsule take on a suggestion, used wherever suggestions are a
 * moment rather than a list: the Feed's suggestion card, and the "worth
 * tuning into" section on someone else's profile.
 *
 * PeopleSuggestionRow is still the compact bordered list row, but only for
 * the dense scrollable contexts it was built for.
 * The profile section originally used it too and deliberately moved here, so
 * that the profile and the Feed present suggestions identically instead of
 * with two different takes on the same idea.
 *
 * Both share the actual logic (useTuneIn) and the mutual/shared badges --
 * only the presentation differs.
 */
export default function SuggestionBubble({ suggestion, index }: SuggestionBubbleProps) {
  const { tuneInStatus, isSubmitting, toggleTuneIn } = useTuneIn(suggestion.id);
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(entrance, {
      toValue: 1,
      duration: 460,
      delay: 180 + index * 90,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [entrance, index]);

  const actioned = tuneInStatus !== 'none';
  const buttonText =
    tuneInStatus === 'accepted' ? 'Tuned In' : tuneInStatus === 'pending' ? 'Pending' : 'Tune In';

  return (
    <Animated.View
      style={[
        styles.bubble,
        // Alternating lean, so three capsules read as bubbles drifting
        // rather than as rows in a table.
        index % 2 === 0 ? styles.leanRight : styles.leanLeft,
        {
          opacity: entrance,
          transform: [
            {
              translateY: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [16, 0],
              }),
            },
            {
              scale: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [0.96, 1],
              }),
            },
          ],
        },
      ]}
    >
      <Touchable
        style={styles.identity}
        activeOpacity={0.8}
        onPress={() => router.push(`/frequency/${suggestion.id}`)}
      >
        <View style={styles.avatarRing}>
          <Avatar
            avatarUrl={suggestion.avatarUrl}
            initial={suggestion.username}
            size={52}
            textSize={21}
            backgroundColor={C.elevated}
            borderColor="transparent"
          />
        </View>

        <View style={styles.text}>
          <Text style={styles.username} numberOfLines={1}>
            @{suggestion.username}
          </Text>

          <View style={styles.chips}>
            {suggestion.mutualConnectionCount > 0 && (
              <MutualAvatars
                mutuals={suggestion.mutualPreview}
                totalCount={suggestion.mutualConnectionCount}
              />
            )}
            {suggestion.sharedGroupCount > 0 && <Badge count={suggestion.sharedGroupCount} />}
          </View>
        </View>
      </Touchable>

      <Touchable
        style={[styles.action, actioned && styles.actionDone]}
        activeOpacity={0.86}
        onPress={() => void toggleTuneIn()}
        disabled={isSubmitting || actioned}
      >
        <Text style={[styles.actionText, actioned && styles.actionTextDone]}>{buttonText}</Text>
      </Touchable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    padding: 9,
    paddingRight: 12,
    borderRadius: 999,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.divider,
    marginBottom: 14,
    // Soft accent halo, so each capsule reads as lit from within rather than
    // stacked on a card. Same shadowColor-as-glow treatment the tab bar and
    // record button already use -- wide radius, low opacity, barely offset.
    shadowColor: C.accent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 22,
    elevation: 10,
  },

  leanRight: {
    marginRight: 18,
  },

  leanLeft: {
    marginLeft: 18,
  },

  identity: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },

  avatarRing: {
    padding: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(107,168,130,0.34)',
    backgroundColor: 'rgba(107,168,130,0.08)',
  },

  text: {
    flex: 1,
    minWidth: 0,
    marginLeft: 2,
  },

  username: {
    color: C.text,
    fontSize: 16,
    fontWeight: '800',
  },

  chips: {
    flexDirection: 'column',
    gap: 6,
    marginTop: 7,
  },

  action: {
    minWidth: 84,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: C.accent,
  },

  actionDone: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: C.divider,
  },

  actionText: {
    color: '#0B100D',
    fontSize: 13,
    fontWeight: '800',
  },

  actionTextDone: {
    color: C.muted,
  },
});
