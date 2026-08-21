import { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { FrequencyColors as C } from '@/constants/frequencyTheme';

const FADE_IN = 160;
const FADE_OUT = 260;

const MS_PER_DAY = 86400000;

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * The answer to "when was this sent", written the way someone would say it
 * out loud. A bare clock time is only unambiguous for something sent today,
 * so anything older carries just enough date to place it.
 */
function formatSentAt(dateString: string) {
  const sentAt = new Date(dateString);
  const time = sentAt.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  const daysAgo = Math.round((startOfDay(new Date()) - startOfDay(sentAt)) / MS_PER_DAY);

  if (daysAgo <= 0) return time;
  if (daysAgo === 1) return `Yesterday, ${time}`;

  if (daysAgo < 7) {
    return `${sentAt.toLocaleDateString(undefined, { weekday: 'long' })}, ${time}`;
  }

  return `${sentAt.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`;
}

/**
 * Sits inside a message bubble and rests at zero opacity, so revealing a
 * time never changes the height of anything. A thread is pinned to its
 * newest message; if a reveal grew a bubble, holding an old Whisper would
 * throw the list to the bottom.
 */
export default function MessageTimeReveal({
  createdAt,
  visible,
}: {
  createdAt: string;
  visible: boolean;
}) {
  const shown = useSharedValue(0);
  const label = useMemo(() => formatSentAt(createdAt), [createdAt]);

  useEffect(() => {
    shown.value = withTiming(visible ? 1 : 0, {
      duration: visible ? FADE_IN : FADE_OUT,
      easing: Easing.out(Easing.quad),
    });
  }, [shown, visible]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ scale: 0.96 + shown.value * 0.04 }],
  }));

  return (
    <Animated.View pointerEvents="none" style={[styles.layer, animatedStyle]}>
      <View style={styles.pill}>
        <Text style={styles.time} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Opaque enough to read cleanly over a waveform without dimming the
  // message underneath it.
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(11,16,13,0.94)',
    borderWidth: 1,
    borderColor: C.divider,
  },

  time: {
    color: C.text,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
