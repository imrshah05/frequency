import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { FrequencyColors as C } from '@/constants/frequencyTheme';
import { ResonanceEmotions, type ResonanceEmotionBlend } from '@/constants/resonanceEmotions';

type Props = {
  blend: ResonanceEmotionBlend[];
  size: number;
  style?: StyleProp<ViewStyle>;
};

// A halo layer for one emotion. Every layer shares the same centre, so the
// blend reads as a single mixed glow rather than separate blobs. Presence is
// the emotion's share of the blend (0 when it isn't picked at all).
function AuraLayer({ id, color, presence, size }: {
  id: string;
  color: string;
  presence: number;
  size: number;
}) {
  const value = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(value, {
      toValue: presence,
      duration: 620,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [presence, value]);

  const radius = size / 2;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        styles.layer,
        {
          // Even a small share stays visible — a 10% emotion should still
          // tint the room, just faintly.
          opacity: value.interpolate({ inputRange: [0, 0.001, 1], outputRange: [0, 0.45, 1] }),
          transform: [
            { scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.78, 1.1] }) },
          ],
        },
      ]}
    >
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={color} stopOpacity={0.22} />
            <Stop offset="45%" stopColor={color} stopOpacity={0.07} />
            <Stop offset="100%" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={radius} cy={radius} r={radius} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

// The light the orb casts into the room. Before anything is picked the space
// holds a faint accent-green glow; as emotions are chosen it warms into their
// colours. Every emotion keeps a mounted layer so adding and removing one
// cross-fades instead of cutting.
export default function ResonanceAura({ blend, size, style }: Props) {
  return (
    <View pointerEvents="none" style={[styles.stage, { width: size, height: size }, style]}>
      <AuraLayer
        id="resonance-aura-resting"
        color={C.accent}
        presence={blend.length === 0 ? 0.4 : 0}
        size={size}
      />

      {ResonanceEmotions.map((option) => (
        <AuraLayer
          key={option.key}
          id={`resonance-aura-${option.key}`}
          color={option.color}
          presence={(blend.find((entry) => entry.emotion === option.key)?.percentage ?? 0) / 100}
          size={size}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    position: 'absolute',
  },

  layer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
