import { useEffect, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';

/**
 * The app's shared entrance. Spring rather than a fixed duration so the settle
 * is physical, but heavily damped (high damping, low mass) so it glides to rest
 * without the overshoot the design bible rules out.
 *
 * Lifted out of the Search screen so every staggered list entrance in the app
 * runs on one spring config rather than each screen inventing its own.
 */
export const SPRING_IN_CONFIG = { damping: 22, stiffness: 140, mass: 0.9 };

export default function SpringIn({
  children,
  delay = 0,
  style,
}: {
  children: ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const presence = useSharedValue(0);

  useEffect(() => {
    presence.value = withDelay(delay, withSpring(1, SPRING_IN_CONFIG));
  }, [presence, delay]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: presence.value,
    transform: [{ translateY: (1 - presence.value) * 14 }],
  }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}
