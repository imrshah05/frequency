import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Touchable from './Touchable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import SuggestionBubble from '@/components/SuggestionBubble';
import { FrequencyColors as C, FrequencyRadius as R, FrequencySpacing as S } from '@/constants/frequencyTheme';
import type { SuggestedTuneIn } from '@/lib/suggestedTuneIns';

// Outer to inner. Sized to sit behind the header text without crowding it.
const RING_SIZES = [320, 236, 160];

type SuggestionFeedCardProps = {
  suggestions: SuggestedTuneIn[];
  /** The Feed's paging FlatList snaps to this exact height per item -- passed in rather than re-read here so both stay in sync with a single Dimensions read. */
  height: number;
  /** Long-press anywhere on the card surfaces the "don't suggest" quick action. The sheet/toast/preference write itself is owned by the Feed screen, same as EchoOptionsSheet is owned by its parent screen rather than the Echo row. */
  onLongPress?: () => void;
  /**
   * Only passed when there's no real Echo after this card (an empty feed,
   * or a short one where the card lands at the very end) -- swiping up has
   * nothing to reveal in that case, so this renders an explicit close
   * button instead of relying on the swipe. Omitted entirely when there is
   * a following Echo, since swiping up already reveals it.
   */
  onClose?: () => void;
};

/**
 * Concentric rings behind the header -- a signal arriving, which is the
 * one visual metaphor this app is named after. Expands outward once on
 * mount, then rests. Not a loop: a pulsing Feed background would be the
 * kind of restless motion Frequency deliberately avoids.
 */
function SignalRings({ progress }: { progress: Animated.Value }) {
  return (
    <View pointerEvents="none" style={styles.rings}>
      {RING_SIZES.map((size, index) => (
        <Animated.View
          key={size}
          style={[
            styles.ring,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              opacity: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 1 - index * 0.24],
              }),
              transform: [
                {
                  scale: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.84, 1],
                  }),
                },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

/**
 * A single full-screen "page" in the Feed's pager, matching the Echo pager's
 * one-item-per-screen paging behavior. Deliberately has no waveform, no play
 * button, no caption -- Frequency's own design language reserves that
 * audio-hero treatment for real Echoes, so leaving it out here is what keeps
 * this from reading as one.
 */
export default function SuggestionFeedCard({
  suggestions,
  height,
  onLongPress,
  onClose,
}: SuggestionFeedCardProps) {
  const insets = useSafeAreaInsets();
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(entrance, {
      toValue: 1,
      duration: 720,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [entrance]);

  if (suggestions.length === 0) return null;

  return (
    <Pressable
      onLongPress={onLongPress}
      style={[
        styles.screen,
        { height, paddingTop: insets.top + S.xxl, paddingBottom: insets.bottom + S.xxl },
      ]}
    >
      {onClose && (
        <Touchable
          style={[styles.closeButton, { top: insets.top + S.md }]}
          activeOpacity={0.78}
          onPress={onClose}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="close" size={16} color={C.muted} />
        </Touchable>
      )}

      <View style={styles.header}>
        <SignalRings progress={entrance} />

        <Animated.View style={{ opacity: entrance }}>
          <Text style={styles.eyebrow}>
            {suggestions.length === 1 ? 'A voice close to yours' : 'Voices close to yours'}
          </Text>
          <Text style={styles.title}>Worth tuning into.</Text>
        </Animated.View>
      </View>

      <View style={styles.bubbles}>
        {suggestions.map((suggestion, index) => (
          <SuggestionBubble key={suggestion.id} suggestion={suggestion} index={index} />
        ))}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    width: '100%',
    backgroundColor: C.background,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },

  closeButton: {
    position: 'absolute',
    left: 24,
    zIndex: 1,
    width: 34,
    height: 34,
    borderRadius: R.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.divider,
  },

  header: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: S.xxl,
  },

  rings: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },

  ring: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(107,168,130,0.16)',
  },

  eyebrow: {
    color: C.accentSoft,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.6,
    textAlign: 'center',
  },

  title: {
    color: C.text,
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 10,
  },

  bubbles: {
    marginTop: S.lg,
  },
});
