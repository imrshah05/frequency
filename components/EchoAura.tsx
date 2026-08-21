import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { FrequencyColors as C } from '@/constants/frequencyTheme';

type Props = {
  active?: boolean;
  size: number;
  style?: StyleProp<ViewStyle>;
};

let instanceCounter = 0;

// A soft radial wash of Frequency green sitting behind an Echo, so the page
// reads as lit by the voice rather than decorated with it. Same idea as
// ResonanceHalo, but it breathes: while the Echo plays it drifts slowly in
// scale and brightness, and settles back to a dim resting glow when it stops.
//
// Only the playing Echo runs the loop -- idle pages hold a single static
// value -- so a feed of rendered pages never has more than one animation
// alive at a time.
export default function EchoAura({ active = false, size, style }: Props) {
  // Unique per mount: several Echo pages are rendered at once by the pager,
  // and SVG def ids are document-global.
  const gradientId = useRef(`echo-aura-${instanceCounter++}`).current;
  const breath = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      Animated.timing(breath, {
        toValue: 0,
        duration: 900,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration: 2600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 0.34,
          duration: 2600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    loop.start();

    return () => {
      loop.stop();
    };
  }, [active, breath]);

  const opacity = breath.interpolate({
    inputRange: [0, 1],
    outputRange: [0.5, 1],
  });
  const scale = breath.interpolate({
    inputRange: [0, 1],
    outputRange: [0.94, 1.06],
  });

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center, style]}>
      <Animated.View
        style={{
          width: size,
          height: size,
          opacity,
          transform: [{ scale }],
        }}
      >
        <Svg width={size} height={size}>
          <Defs>
            <RadialGradient id={gradientId} cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={C.accent} stopOpacity={0.2} />
              <Stop offset="42%" stopColor={C.accent} stopOpacity={0.075} />
              <Stop offset="100%" stopColor={C.accent} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width={size} height={size} fill={`url(#${gradientId})`} />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
