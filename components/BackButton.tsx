import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import Touchable from '@/components/Touchable';
import { FrequencyColors as C } from '@/constants/frequencyTheme';

/**
 * The app's single back / dismiss control.
 *
 * Before this existed every screen hand-rolled its own, which drifted into six
 * different treatments — bordered pills, bordered circles, "← Back" text, and
 * bare chevrons at four different sizes. One component now owns the glyph, the
 * size, the colour and the tap target so those can never diverge again.
 *
 * Two variants, and the distinction is deliberate rather than cosmetic:
 *
 *   `back`  (chevron) — the screen was pushed. Goes up one level.
 *   `close` (X)       — the screen was presented as a modal. Dismisses it.
 *
 * Match the variant to the screen's `presentation` in app/_layout.tsx. A
 * chevron on a sheet that slid up from the bottom points the wrong way.
 */

// The box is glyph-width so the chevron's ink sits flush with body text at the
// same horizontal padding, rather than floating inset the way a square 44pt box
// would. The full 44pt tap target is restored with hitSlop instead.
const BOX_WIDTH = 32;
const BOX_HEIGHT = 44;
const HIT_SLOP = 12;

/**
 * Width of the control. Headers with a centred title balance it with an empty
 * spacer of this width on the opposite side — import it rather than hardcoding,
 * so a future size change keeps those titles centred.
 */
export const BACK_BUTTON_WIDTH = BOX_WIDTH;

const CHEVRON_SIZE = 26;
const CLOSE_SIZE = 24;

export type BackButtonProps = {
  variant?: 'back' | 'close';
  /** Defaults to `router.back()`. Override to tear down audio or step a wizard. */
  onPress?: () => void;
  /** Override only where the control sits over artwork rather than the app background. */
  color?: string;
  /** Blocks leaving — used while a recording or upload is in flight. */
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export default function BackButton({
  variant = 'back',
  onPress,
  color = C.text,
  disabled = false,
  style,
}: BackButtonProps) {
  return (
    <Touchable
      style={[styles.button, disabled && styles.disabled, style]}
      activeOpacity={0.78}
      hitSlop={HIT_SLOP}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={variant === 'close' ? 'Close' : 'Back'}
      onPress={onPress ?? (() => router.back())}
    >
      <Ionicons
        name={variant === 'close' ? 'close' : 'chevron-back'}
        size={variant === 'close' ? CLOSE_SIZE : CHEVRON_SIZE}
        color={color}
      />
    </Touchable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: BOX_WIDTH,
    height: BOX_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },

  disabled: {
    opacity: 0.35,
  },
});
