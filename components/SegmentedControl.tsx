import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';

import { FrequencyColors as C, FrequencyRadius as R } from '@/constants/frequencyTheme';
import { selection } from '@/lib/haptics';

export type SegmentOption<T extends string> = {
  key: T;
  label: string;
};

type SegmentedControlProps<T extends string> = {
  options: [SegmentOption<T>, SegmentOption<T>];
  value: T;
  onChange: (value: T) => void;
};

export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  const [trackWidth, setTrackWidth] = useState(0);
  const translateX = useRef(new Animated.Value(0)).current;
  const activeIndex = options.findIndex((option) => option.key === value);
  const segmentWidth = trackWidth / options.length;

  function handleLayout(event: LayoutChangeEvent) {
    setTrackWidth(event.nativeEvent.layout.width);
  }

  useEffect(() => {
    if (trackWidth === 0) return;

    Animated.timing(translateX, {
      toValue: activeIndex * segmentWidth,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [activeIndex, segmentWidth, trackWidth, translateX]);

  return (
    <View style={styles.track} onLayout={handleLayout}>
      {trackWidth > 0 && (
        <Animated.View
          style={[
            styles.thumb,
            {
              width: segmentWidth - 4,
              transform: [{ translateX }],
            },
          ]}
        />
      )}

      {options.map((option) => {
        const active = option.key === value;

        return (
          <Pressable
            key={option.key}
            style={styles.segment}
            onPress={() => {
              if (option.key === value) return;
              void selection();
              onChange(option.key);
            }}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    height: 44,
    padding: 2,
    borderRadius: R.md,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.divider,
  },

  thumb: {
    position: 'absolute',
    top: 2,
    left: 2,
    bottom: 2,
    borderRadius: R.md - 2,
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.divider,
  },

  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  label: {
    color: C.muted,
    fontSize: 15,
    fontWeight: '700',
  },

  labelActive: {
    color: C.text,
  },
});
