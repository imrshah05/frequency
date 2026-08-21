import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FrequencyColors as C } from '@/constants/frequencyTheme';
import type { ResonanceEmotionOption } from '@/constants/resonanceEmotions';

type Props = {
  option: ResonanceEmotionOption;
  // The emotion's share of the blend, or null when it isn't part of it.
  percentage: number | null;
  onPress: () => void;
  onRemove: () => void;
};

// An emotion in the blend picker. Tapping adds weight, and that weight fills
// the pill with the emotion's own colour — so the blend is something you can
// see growing rather than a number that quietly changes.
export default function EmotionPill({ option, percentage, onPress, onRemove }: Props) {
  const [width, setWidth] = useState(0);
  const fill = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const selected = percentage !== null;

  useEffect(() => {
    Animated.timing(fill, {
      toValue: (percentage ?? 0) / 100,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      // Drives width, which the native driver can't animate.
      useNativeDriver: false,
    }).start();
  }, [fill, percentage]);

  function animateScale(toValue: number) {
    Animated.spring(scale, {
      toValue,
      damping: 20,
      stiffness: 260,
      mass: 0.6,
      useNativeDriver: true,
    }).start();
  }

  function handleLayout(event: LayoutChangeEvent) {
    setWidth(event.nativeEvent.layout.width);
  }

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => animateScale(0.96)}
      onPressOut={() => animateScale(1)}
    >
      <Animated.View
        onLayout={handleLayout}
        style={[
          styles.pill,
          selected && { borderColor: `${option.color}66` },
          { transform: [{ scale }] },
        ]}
      >
        <Animated.View
          style={[
            styles.fill,
            {
              backgroundColor: `${option.color}26`,
              width: fill.interpolate({ inputRange: [0, 1], outputRange: [0, width] }),
            },
          ]}
        />

        <View style={[styles.dot, { backgroundColor: option.color }]} />
        <Text style={styles.label}>{option.label}</Text>

        {selected && (
          <>
            <Text style={[styles.percentage, { color: option.color }]}>{percentage}%</Text>
            <Pressable hitSlop={10} onPress={onRemove}>
              <Ionicons name="close" size={14} color={C.muted} />
            </Pressable>
          </>
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.divider,
    backgroundColor: C.card,
    overflow: 'hidden',
  },

  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },

  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },

  label: {
    color: C.text,
    fontSize: 15,
    fontWeight: '700',
  },

  percentage: {
    fontSize: 14,
    fontWeight: '800',
  },
});
