import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Touchable from './Touchable';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  FrequencyColors as C,
  FrequencyRadius as R,
  FrequencySpacing as S,
} from '@/constants/frequencyTheme';

type EchoActionToastProps = {
  visible: boolean;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  countdownSeconds?: number;
};

// A calm, floating confirmation for Archive/Delete -- fades and glides,
// never bounces. Sits just above the bottom dock. Used in both non-undo
// mode ("Moved to Archives") and undo mode (Delete, with a ticking
// countdown next to the action label).
export default function EchoActionToast({
  visible,
  message,
  actionLabel,
  onAction,
  countdownSeconds,
}: EchoActionToastProps) {
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(visible ? 1 : 0, { duration: visible ? 320 : 220 });
  }, [visible, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: 16 - progress.value * 16 }],
  }));

  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        { bottom: Math.max(insets.bottom, 12) + 88 },
        animatedStyle,
      ]}
    >
      <View style={styles.card}>
        <Text style={styles.message} numberOfLines={2}>
          {message}
        </Text>

        {actionLabel && onAction && (
          <Touchable activeOpacity={0.78} onPress={onAction} style={styles.action}>
            <Text style={styles.actionText}>
              {actionLabel}
              {typeof countdownSeconds === 'number' ? ` · ${countdownSeconds}s` : ''}
            </Text>
          </Touchable>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: S.lg,
    right: S.lg,
    alignItems: 'center',
  },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: S.md,
    paddingVertical: 14,
    paddingHorizontal: S.md,
    borderRadius: R.md,
    backgroundColor: C.elevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.divider,
    width: '100%',
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },

  message: {
    flex: 1,
    color: C.text,
    fontSize: 15,
    fontWeight: '600',
  },

  action: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },

  actionText: {
    color: C.accentSoft,
    fontSize: 15,
    fontWeight: '800',
  },
});
