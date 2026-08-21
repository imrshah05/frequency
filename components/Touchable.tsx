import {
  Pressable,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { FrequencyMotion } from '@/constants/frequencyTheme';

/**
 * The app's press primitive, and a drop-in replacement for React Native's
 * TouchableOpacity.
 *
 * TouchableOpacity animates its dim on the JS thread with durations baked into
 * React Native itself — 150ms to dim, 250ms to fade back — that no prop can
 * override. This runs the same dim on the UI thread through Reanimated at the
 * timings in FrequencyMotion, so press feedback stays immediate even while the
 * JS thread is busy loading a feed.
 *
 * Behaviour is deliberately identical otherwise: same `activeOpacity`
 * semantics, same default of 0.2, and a resting opacity set by the passed
 * style is respected rather than overwritten.
 */

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Calm decelerating curve — no overshoot, nothing springy.
const PRESS_EASING = Easing.out(Easing.quad);

export type TouchableProps = Omit<PressableProps, 'style'> & {
  activeOpacity?: number;
  /**
   * Opt-in press scale. Off by default so we never clobber a transform the
   * passed style already sets.
   */
  pressScale?: number;
  style?: StyleProp<ViewStyle>;
};

export default function Touchable({
  activeOpacity = 0.2,
  pressScale = 1,
  style,
  onPressIn,
  onPressOut,
  ...rest
}: TouchableProps) {
  const press = useSharedValue(0);

  // Matches the original: the dim animates from whatever opacity the style
  // already sets (disabled states often set one) down to activeOpacity.
  const restingOpacity = (StyleSheet.flatten(style)?.opacity as number | undefined) ?? 1;
  const scaleTravel = 1 - pressScale;

  const animatedStyle = useAnimatedStyle(() => {
    const opacity = restingOpacity + press.value * (activeOpacity - restingOpacity);

    if (scaleTravel === 0) return { opacity };

    return { opacity, transform: [{ scale: 1 - press.value * scaleTravel }] };
  });

  return (
    <AnimatedPressable
      {...rest}
      style={[style, animatedStyle]}
      onPressIn={(event) => {
        press.value = withTiming(1, {
          duration: FrequencyMotion.pressIn,
          easing: PRESS_EASING,
        });
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        press.value = withTiming(0, {
          duration: FrequencyMotion.pressOut,
          easing: PRESS_EASING,
        });
        onPressOut?.(event);
      }}
    />
  );
}
