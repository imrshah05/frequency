import { useEffect, useMemo } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { FrequencyColors as C } from '@/constants/frequencyTheme';

/**
 * The waveform behind "Find your frequency." on the auth screen -- either at
 * rest, or resolving into place on first launch.
 *
 * The bars, their count and their heights are exactly what the auth screen has
 * always rendered. This does not invent a pattern; it animates *into* the one
 * that was already there, so the first launch and every launch after it end on
 * the same image.
 *
 *   BAR_COUNT      29 bars
 *   height         20 + ((index * 17) % 58)  -> 20..77px, deterministic
 *   bar            6 wide, fully rounded, accent green
 *   container      0.065 opacity, rotated -3deg
 *
 * THE OPACITY BLOOM IS WHY THIS IS VISIBLE AT ALL. At rest the waveform sits
 * at 6.5% opacity -- it is background texture, not an element. A colour and
 * height transition at that opacity is imperceptible. So the resolve lifts the
 * whole container to ~0.3 while it happens and settles it back to 0.065 as it
 * lands, which is also what makes the ending feel like the noise settling
 * rather than an animation stopping.
 */
const BAR_COUNT = 29;
const REST_OPACITY = 0.065;
const BLOOM_OPACITY = 0.3;

/** Where the bars start: unresolved static, grey and wrongly-sized. */
const NOISE_COLOR = '#6E7A74';

export const WELCOME_RESOLVE_MS = 1500;

/** The real resting height for a bar, unchanged from the auth screen. */
function restingHeight(index: number) {
  return 20 + ((index * 17) % 58);
}

function Bar({ index, progress }: { index: number; progress: SharedValue<number> }) {
  // Fixed per mount rather than re-rolled each frame: this is static that
  // resolves, not static that keeps hissing. A height that churned every
  // frame would read as a loading shimmer.
  const noiseHeight = useMemo(() => 14 + Math.random() * 62, []);
  const resolved = restingHeight(index);

  // Bars settle left to right, each one slightly behind the last, so the
  // pattern reads as arriving rather than snapping into place at once. Capped
  // well under the total so the last bar still has room to travel.
  const stagger = (index / BAR_COUNT) * 0.45;

  const style = useAnimatedStyle(() => {
    const local = Math.min(Math.max((progress.value - stagger) / (1 - stagger), 0), 1);

    return {
      height: noiseHeight + (resolved - noiseHeight) * local,
      backgroundColor: interpolateColor(local, [0, 1], [NOISE_COLOR, C.accent]),
    };
  });

  return <Animated.View style={[styles.bar, style]} />;
}

export default function ResolvingWaveform({
  resolving,
  onResolved,
  style,
}: {
  /** True to play the resolve once. False renders the resting waveform. */
  resolving: boolean;
  onResolved?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const progress = useSharedValue(resolving ? 0 : 1);
  const bloom = useSharedValue(resolving ? 0 : 1);

  useEffect(() => {
    if (!resolving) return;

    // Calm, single-pass easing. No spring: bars overshooting their real
    // heights would read as playful, and this is the app introducing itself.
    progress.value = withTiming(1, {
      duration: WELCOME_RESOLVE_MS,
      easing: Easing.inOut(Easing.cubic),
    });

    // The bloom lags the resolve slightly on the way out, so the waveform is
    // still legible at the instant it finishes settling and only then recedes
    // into the background.
    bloom.value = withTiming(1, { duration: 420, easing: Easing.out(Easing.quad) });
    bloom.value = withDelay(
      WELCOME_RESOLVE_MS - 120,
      withTiming(0, { duration: 620, easing: Easing.inOut(Easing.quad) })
    );
  }, [resolving, progress, bloom]);

  // Driven off a timer rather than a withTiming callback: the caller needs
  // this to mark the moment seen and re-enable the screen, and that is app
  // state, which must not be written from the UI thread.
  useEffect(() => {
    if (!resolving || !onResolved) return;

    const timer = setTimeout(onResolved, WELCOME_RESOLVE_MS);
    return () => clearTimeout(timer);
  }, [resolving, onResolved]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: REST_OPACITY + bloom.value * (BLOOM_OPACITY - REST_OPACITY),
  }));

  return (
    <Animated.View style={[styles.wave, style, containerStyle]} pointerEvents="none">
      {Array.from({ length: BAR_COUNT }).map((_, index) => (
        <Bar key={index} index={index} progress={progress} />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wave: {
    position: 'absolute',
    top: 122,
    left: -18,
    right: -18,
    height: 172,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    transform: [{ rotate: '-3deg' }],
    zIndex: 0,
    elevation: 0,
  },

  bar: {
    width: 6,
    borderRadius: 999,
    backgroundColor: C.accent,
  },
});
