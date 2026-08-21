import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, RadialGradient, Rect, Stop } from 'react-native-svg';
import { emotionColor, sortBlend, type ResonanceEmotionBlend } from '@/constants/resonanceEmotions';

type Props = {
  blend: ResonanceEmotionBlend[];
  size?: number;
  style?: StyleProp<ViewStyle>;
  // Off by default in dense layouts (e.g. the Resonance Field cluster) —
  // many orbs each looping their own ripple animation adds up fast.
  ripple?: boolean;
};

let instanceCounter = 0;

// A slow, alive breathing pulse plus two staggered soundwave ripples —
// deliberately gentle (multi-second loops) so it reads as calm, not busy.
// The fill is a set of straight color bands (one per emotion, widest
// first) clipped to the circle, with a translucent highlight layered on
// top for the glass look — bands stay visually distinct, never blended.
export default function ResonanceOrb({ blend, size = 148, style, ripple = true }: Props) {
  const breath = useRef(new Animated.Value(0)).current;
  const rippleA = useRef(new Animated.Value(0)).current;
  const rippleB = useRef(new Animated.Value(0)).current;
  // Unique per mounted orb so multiple instances (Field/Calendar can render
  // dozens at once) never collide on the same SVG def id.
  const instanceId = useRef(`resonance-orb-${instanceCounter++}`).current;

  useEffect(() => {
    const breathing = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration: 2600,
          easing: Easing.inOut(Easing.sin),
          // Drives shadowOpacity below, which the native driver can't animate.
          useNativeDriver: false,
        }),
        Animated.timing(breath, {
          toValue: 0,
          duration: 2600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
      ])
    );

    breathing.start();
    return () => breathing.stop();
  }, [breath]);

  useEffect(() => {
    if (!ripple) return;

    function rippleLoop(value: Animated.Value, delay: number) {
      value.setValue(0);
      const animation = Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(value, {
            toValue: 1,
            duration: 3200,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ])
      );
      animation.start();
      return animation;
    }

    const animA = rippleLoop(rippleA, 0);
    const animB = rippleLoop(rippleB, 1600);

    return () => {
      animA.stop();
      animB.stop();
    };
  }, [ripple, rippleA, rippleB]);

  const radius = size / 2;
  const wrapScale = ripple ? 1.9 : 1.2;

  // Waiting, not missing — a thin ring breathing on the same slow rhythm as a
  // filled orb, sized to the same stage so nothing shifts when the first
  // emotion lands.
  if (blend.length === 0) {
    return (
      <View
        pointerEvents="none"
        style={[styles.wrap, { width: size * wrapScale, height: size * wrapScale }, style]}
      >
        <Animated.View
          style={[
            styles.empty,
            {
              width: size,
              height: size,
              borderRadius: radius,
              opacity: breath.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
              transform: [
                { scale: breath.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1.03] }) },
              ],
            },
          ]}
        />
      </View>
    );
  }

  const scale = breath.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1.05] });
  const glowOpacity = breath.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0.8] });

  const sortedBlend = sortBlend(blend);
  const dominantColor = emotionColor(sortedBlend[0].emotion);

  let cumulativeX = 0;
  const bands = sortedBlend.map((entry) => {
    const width = (entry.percentage / 100) * size;
    const band = { x: cumulativeX, width, color: emotionColor(entry.emotion) };
    cumulativeX += width;
    return band;
  });

  const clipId = `${instanceId}-clip`;
  const highlightId = `${instanceId}-highlight`;

  function rippleStyle(value: Animated.Value) {
    return {
      borderColor: dominantColor,
      transform: [
        { scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1.55] }) },
      ],
      opacity: value.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.3, 0] }),
    };
  }

  return (
    <View pointerEvents="none" style={[styles.wrap, { width: size * wrapScale, height: size * wrapScale }, style]}>
      {ripple && (
        <>
          <Animated.View
            style={[styles.ripple, { width: size, height: size, borderRadius: radius }, rippleStyle(rippleA)]}
          />
          <Animated.View
            style={[styles.ripple, { width: size, height: size, borderRadius: radius }, rippleStyle(rippleB)]}
          />
        </>
      )}

      <Animated.View
        style={{
          transform: [{ scale }],
          shadowColor: dominantColor,
          shadowOpacity: glowOpacity as unknown as number,
          shadowRadius: size * 0.4,
          shadowOffset: { width: 0, height: 0 },
        }}
      >
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Defs>
            <ClipPath id={clipId}>
              <Circle cx={radius} cy={radius} r={radius - 1.5} />
            </ClipPath>
            <RadialGradient id={highlightId} cx="36%" cy="30%" r="75%">
              <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.4} />
              <Stop offset="55%" stopColor="#FFFFFF" stopOpacity={0.05} />
              <Stop offset="100%" stopColor="#000000" stopOpacity={0.16} />
            </RadialGradient>
          </Defs>
          <G clipPath={`url(#${clipId})`}>
            {bands.map((band, index) => (
              // +0.6 avoids hairline antialiasing gaps between bands.
              <Rect key={index} x={band.x} y={0} width={band.width + 0.6} height={size} fill={band.color} />
            ))}
            <Circle cx={radius} cy={radius} r={radius} fill={`url(#${highlightId})`} />
          </G>
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  ripple: {
    position: 'absolute',
    borderWidth: 1.5,
  },

  empty: {
    borderWidth: 1,
    borderColor: 'rgba(226,237,232,0.14)',
    backgroundColor: 'rgba(226,237,232,0.02)',
  },
});
