import { useEffect } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutRectangle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import GlassPanel from '@/components/GlassPanel';
import { SPRING_IN_CONFIG } from '@/components/SpringIn';
import { FrequencyColors as C, FrequencyRadius as R } from '@/constants/frequencyTheme';
import { selection } from '@/lib/haptics';

/**
 * One tutorial moment: a cutout over the thing being talked about, and the
 * card that talks about it.
 *
 * THE CUTOUT AND THE CARD ARE ONE COMPONENT ON PURPOSE. The system this
 * replaces let a spotlight render with no card attached -- a screen would dim,
 * something would be highlighted, and nothing would say why. Keeping them in
 * one component with one `visible` prop means that state does not exist: there
 * is no way to mount the hole without the explanation.
 *
 * COORDINATE SPACE -- the one thing a caller has to get right.
 *
 * `targetRect` comes from an `onLayout` on the target itself, which reports
 * coordinates relative to the target's *parent*, not the window. So this
 * overlay must be rendered as an absolutely-positioned sibling inside that
 * same parent, and it fills that parent rather than the screen. Render it at
 * the root of the screen and pass a rect measured deep inside a scroll view
 * and the hole lands in the wrong place.
 *
 * onLayout rather than ref.measureInWindow polling, deliberately: measurement
 * on a timer is what made the old spotlight race its own scroll animation and
 * lock onto a stale position, dimming the screen with nothing highlighted.
 * onLayout fires when the layout is actually settled, and again whenever it
 * changes.
 */
export type SpotlightShape = 'circle' | 'pill';

const SCRIM = 'rgba(0,0,0,0.76)';

/** Breathing room between the hole's edge and the dimmed area. */
const CUTOUT_PADDING = 10;

/** Gap between the cutout and the card. */
const CARD_GAP = 18;

const CARD_MARGIN = 20;

/**
 * The rounded-rectangle subpath for the hole, as an SVG path string.
 *
 * Drawn counter-clockwise while the outer screen rect is drawn clockwise, so
 * the even-odd fill rule punches it out rather than filling it in.
 */
function holePath(rect: LayoutRectangle, shape: SpotlightShape) {
  const x = rect.x - CUTOUT_PADDING;
  const y = rect.y - CUTOUT_PADDING;
  const width = rect.width + CUTOUT_PADDING * 2;
  const height = rect.height + CUTOUT_PADDING * 2;

  // A circle cutout on a non-square target should still be a circle, so it
  // takes the larger side and centres on the target rather than stretching
  // into an ellipse.
  if (shape === 'circle') {
    const radius = Math.max(width, height) / 2;
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;

    return [
      `M ${cx - radius} ${cy}`,
      `a ${radius} ${radius} 0 1 0 ${radius * 2} 0`,
      `a ${radius} ${radius} 0 1 0 ${-radius * 2} 0`,
      'Z',
    ].join(' ');
  }

  const radius = Math.min(height / 2, width / 2);

  return [
    `M ${x + radius} ${y}`,
    `H ${x + width - radius}`,
    `A ${radius} ${radius} 0 0 1 ${x + width} ${y + radius}`,
    `V ${y + height - radius}`,
    `A ${radius} ${radius} 0 0 1 ${x + width - radius} ${y + height}`,
    `H ${x + radius}`,
    `A ${radius} ${radius} 0 0 1 ${x} ${y + height - radius}`,
    `V ${y + radius}`,
    `A ${radius} ${radius} 0 0 1 ${x + radius} ${y}`,
    'Z',
  ].join(' ');
}

export default function SpotlightMoment({
  visible,
  targetRect,
  shape = 'circle',
  title,
  body,
  actionLabel = 'Got it',
  step,
  totalSteps,
  onAdvance,
}: {
  visible: boolean;
  /** From the target's own onLayout. See the coordinate-space note above. */
  targetRect: LayoutRectangle | null;
  shape?: SpotlightShape;
  title: string;
  body: string;
  actionLabel?: string;
  step?: number;
  totalSteps?: number;
  onAdvance: () => void;
}) {
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const presence = useSharedValue(0);
  const cardPresence = useSharedValue(0);

  useEffect(() => {
    if (visible && targetRect) {
      // The scrim fades rather than springs -- a dimming that overshoots
      // reads as a flash. The card is the thing that arrives.
      presence.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.quad) });
      cardPresence.value = withSpring(1, SPRING_IN_CONFIG);
      return;
    }

    presence.value = withTiming(0, { duration: 200, easing: Easing.in(Easing.quad) });
    cardPresence.value = withTiming(0, { duration: 160, easing: Easing.in(Easing.quad) });
  }, [visible, targetRect, presence, cardPresence]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: presence.value }));

  const cardStyle = useAnimatedStyle(() => ({
    opacity: cardPresence.value,
    transform: [{ translateY: (1 - cardPresence.value) * 14 }],
  }));

  // Nothing renders until the target has been laid out. A spotlight with no
  // measured hole is exactly the "dimmed screen, nothing highlighted" state
  // this component exists to make impossible.
  if (!visible || !targetRect) return null;

  const holeTop = targetRect.y - CUTOUT_PADDING;
  const holeBottom = targetRect.y + targetRect.height + CUTOUT_PADDING;

  // Above if there is room for a card of reasonable height, below otherwise.
  // Measured against the space that actually exists rather than a fixed
  // threshold, so it stays right on a small screen and a large one.
  const roomAbove = holeTop - CARD_GAP;
  const placeAbove = roomAbove > 190;

  function handleAdvance() {
    void selection();
    onAdvance();
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, scrimStyle]}>
        {/*
          The scrim is one Pressable covering everything, so a tap anywhere
          advances -- including on the highlighted element itself. A tutorial
          that requires hitting a small target to continue is a puzzle.
        */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={handleAdvance}
          accessibilityRole="button"
          accessibilityLabel={`${title}. ${body}. Tap to continue.`}
        >
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <Svg width="100%" height="100%">
              <Path
                d={`M 0 0 H ${windowWidth} V ${windowHeight} H 0 Z ${holePath(targetRect, shape)}`}
                fill={SCRIM}
                fillRule="evenodd"
              />
            </Svg>
          </View>
        </Pressable>
      </Animated.View>

      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.cardWrap,
          placeAbove
            ? { bottom: windowHeight - holeTop + CARD_GAP }
            : { top: holeBottom + CARD_GAP },
          cardStyle,
        ]}
      >
        <GlassPanel radius={R.lg}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>

          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              onPress={handleAdvance}
              style={styles.action}
              hitSlop={8}
            >
              <Text style={styles.actionText}>{actionLabel}</Text>
            </Pressable>

            {/*
              Only when there is more than one, same rule the Echo Impact
              reveal uses. Without it a second card reads as the app
              repeating itself; with it on a single card it reads as a form.
            */}
            {typeof step === 'number' && typeof totalSteps === 'number' && totalSteps > 1 && (
              <Text style={styles.progress}>
                {step} of {totalSteps}
              </Text>
            )}
          </View>
        </GlassPanel>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  cardWrap: {
    position: 'absolute',
    left: CARD_MARGIN,
    right: CARD_MARGIN,
  },

  // The app's sheet header scale, 26/800/-0.4, one step down for a card this
  // small. Nothing here shouts in capitals.
  title: {
    color: C.text,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.4,
  },

  body: {
    color: C.accentSoft,
    fontSize: 16,
    lineHeight: 24,
    marginTop: 8,
  },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
  },

  action: {
    paddingVertical: 4,
  },

  actionText: {
    color: C.accent,
    fontSize: 16,
    fontWeight: '700',
  },

  progress: {
    color: C.faint,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
});
