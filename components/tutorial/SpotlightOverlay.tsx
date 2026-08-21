import { BlurView } from 'expo-blur';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  requestTutorialTargetRemeasure,
  useTutorialTargetFrame,
  type TutorialTargetFrame,
} from '@/components/tutorial/TutorialTarget';
import {
  FrequencyColors as C,
  FrequencyRadius as R,
  FrequencySpacing as S,
} from '@/constants/frequencyTheme';
import { light, success } from '@/lib/haptics';

/**
 * A dim over the screen with one thing left lit, and a card saying why.
 *
 * For static chrome only -- the record button, a dock icon, the profile
 * entry point. Anything that scrolls uses TutorialIntroCard, because a
 * cutout cannot follow content that moves.
 *
 * Tap anywhere to advance. There is no Next button and no Skip: the whole
 * screen is the control, which is both the largest possible target and one
 * fewer element on a screen whose job is to point at something else.
 *
 * ## Why nothing here uses Reanimated
 *
 * This renders inside a React Native <Modal>, and Reanimated's animated
 * styles do not drive views in a modal's separate native hierarchy -- they
 * hold whatever value they were first given. That is what broke the first
 * version of this component: the dim's opacity and the card's entrance
 * both started at 0 and stayed there, while the full-screen Pressable
 * underneath them was a plain view and kept swallowing every touch. The
 * result was an invisible sheet of glass over the whole app.
 *
 * Two rules came out of that, and both are load-bearing:
 *
 *   1. The blocking layer is never animated. The dim and the cutout are
 *      plain views positioned from React state, so they are visible the
 *      instant this mounts. Something that can swallow touches must not be
 *      able to become invisible.
 *   2. Anything that does animate uses React Native's own Animated, which
 *      works inside a modal, and animates only decoration that cannot trap
 *      anyone if it fails.
 *
 * The old onboarding overlay avoided this by not using a Modal at all
 * (absoluteFill + zIndex, inline in the tree). A Modal is kept here because
 * the tab dock is rendered above screen content, so an inline overlay
 * cannot dim it -- and the dock is where most of the spotlit chrome lives.
 */

export type SpotlightStep = {
  /** Must match a mounted TutorialTarget's id. */
  targetId: string;
  title: string;
  body: string;
};

// Breathing room between the lit element and the edge of the dim.
const CUTOUT_PADDING = 10;
// How far the card sits from the cutout.
const CARD_GAP = 18;
const CARD_MARGIN = 22;
// Below this much free space on one side, the card goes to the other.
const MIN_CARD_SPACE = 200;

const CARD_ENTRANCE_MS = 320;

/**
 * How long to wait after dismissing a TutorialIntroCard before opening a
 * spotlight behind it.
 *
 * Both are native modals, and presenting one while another is still
 * sliding out is the classic way to get a dropped presentation or a flash
 * of bare screen. Matches the slide-out a screen has to sit through, so
 * the two beats read as one handoff rather than a stutter.
 */
export const SHEET_HANDOFF_MS = 320;

export default function SpotlightOverlay({
  visible,
  steps,
  onFinish,
}: {
  visible: boolean;
  steps: SpotlightStep[];
  onFinish: () => void;
}) {
  const [index, setIndex] = useState(0);
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const step = steps[index] ?? null;
  const frame = useTutorialTargetFrame(step?.targetId ?? null);

  // Decoration only -- see the note above. If this never runs, the card is
  // plain instead of fading, and nothing is trapped.
  const cardEntrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    setIndex(0);
  }, [visible]);

  // A fresh reading before pointing at anything. A target inside a scroll
  // view reports where it was when it was laid out, so a screen that
  // scrolled it into view first would otherwise be lit in its old position.
  useEffect(() => {
    if (visible) requestTutorialTargetRemeasure();
  }, [index, visible]);

  // Each step's copy enters on its own.
  useEffect(() => {
    if (!visible) {
      cardEntrance.setValue(0);
      return;
    }

    cardEntrance.setValue(0);
    const animation = Animated.timing(cardEntrance, {
      toValue: 1,
      duration: CARD_ENTRANCE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });

    animation.start();
    return () => animation.stop();
  }, [cardEntrance, index, visible]);

  const advance = useCallback(() => {
    if (index >= steps.length - 1) {
      void success();
      onFinish();
      return;
    }

    void light();
    setIndex((current) => current + 1);
  }, [index, onFinish, steps.length]);

  if (!visible || !step) return null;

  const cut = frame && {
    top: Math.max(0, frame.y - CUTOUT_PADDING),
    left: Math.max(0, frame.x - CUTOUT_PADDING),
    width: frame.width + CUTOUT_PADDING * 2,
    height: frame.height + CUTOUT_PADDING * 2,
  };

  // A round target (the record button, a dock icon) stays round; a wide row
  // keeps the app's card radius rather than becoming a pill.
  const cutRadius = cut ? Math.max(R.sm, Math.min(R.lg, cut.height / 2)) : 0;
  const card = placement(frame, screenHeight, insets.top, insets.bottom);

  return (
    <Modal visible transparent statusBarTranslucent animationType="fade" onRequestClose={onFinish}>
      {/* One press target covering everything, so any tap advances. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={advance} accessibilityRole="button">
        {/*
          Plain views, no opacity animation. This is the layer that blocks
          touches, so it has to be visible from the first frame.
        */}
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {cut ? (
            <>
              <View style={[styles.panel, styles.horizontal, { top: 0, height: cut.top }]} />
              <View
                style={[styles.panel, { top: cut.top, left: 0, width: cut.left, height: cut.height }]}
              />
              <View
                style={[
                  styles.panel,
                  { top: cut.top, left: cut.left + cut.width, right: 0, height: cut.height },
                ]}
              />
              <View
                style={[styles.panel, styles.horizontal, { top: cut.top + cut.height, bottom: 0 }]}
              />

              <View
                style={[
                  styles.ring,
                  {
                    top: cut.top,
                    left: cut.left,
                    width: cut.width,
                    height: cut.height,
                    borderRadius: cutRadius,
                  },
                ]}
              />
            </>
          ) : (
            // Nothing reported a frame -- the target is not mounted on this
            // screen. The copy still stands on its own, so this dims
            // everything and centres it rather than pointing at nowhere.
            <View style={[StyleSheet.absoluteFill, styles.solidDim]} />
          )}
        </View>

        <Animated.View
          pointerEvents="none"
          style={[
            styles.cardPositioner,
            card.anchor === 'center'
              ? { top: screenHeight / 2 - 110 }
              : card.anchor === 'above'
                ? { bottom: screenHeight - card.edge }
                : { top: card.edge },
            { maxWidth: screenWidth - CARD_MARGIN * 2 },
            {
              opacity: cardEntrance,
              transform: [
                {
                  translateY: cardEntrance.interpolate({
                    inputRange: [0, 1],
                    outputRange: [card.anchor === 'above' ? 10 : -10, 0],
                  }),
                },
              ],
            },
          ]}
        >
          {/*
            The same frosted material GlassSheet uses -- bloom behind the
            blur so it has something to pick up, then the blur, then a
            hairline. GlassSheet itself cannot be reused here: it is a
            bottom-anchored sheet with its own Modal and backdrop, and
            nesting a modal inside this one is exactly the presentation bug
            SHEET_HANDOFF_MS exists to avoid.
          */}
          <View pointerEvents="none" style={styles.bloom}>
            <View style={styles.bloomAccent} />
          </View>

          <BlurView
            intensity={34}
            tint="systemThinMaterialDark"
            experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
            style={styles.card}
          >
            <View style={styles.cardBody}>
              <Text style={styles.title}>{step.title}</Text>
              <Text style={styles.body}>{step.body}</Text>

              <View style={styles.footer}>
                <Text style={styles.hint}>Tap anywhere to continue</Text>
                {/* Only when steps chain -- a "1 of 1" is noise. */}
                {steps.length > 1 && (
                  <Text style={styles.counter}>
                    {index + 1} of {steps.length}
                  </Text>
                )}
              </View>
            </View>
          </BlurView>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

/**
 * Which side of the lit element the copy sits on.
 *
 * Chooses whichever side has room, preferring above -- most spotlit chrome
 * in this app is the dock, at the bottom of the screen.
 */
function placement(
  frame: TutorialTargetFrame | null,
  screenHeight: number,
  topInset: number,
  bottomInset: number
): { anchor: 'above' | 'below' | 'center'; edge: number } {
  if (!frame) return { anchor: 'center', edge: 0 };

  const spaceAbove = frame.y - topInset;
  const spaceBelow = screenHeight - (frame.y + frame.height) - bottomInset;

  if (spaceAbove >= MIN_CARD_SPACE) return { anchor: 'above', edge: frame.y - CARD_GAP };
  if (spaceBelow >= MIN_CARD_SPACE) return { anchor: 'below', edge: frame.y + frame.height + CARD_GAP };

  return { anchor: 'center', edge: 0 };
}

// Solid rather than four blurred panels: a blur per panel is four extra
// render passes for a surface whose whole job is to recede, and the old
// system's blurred panels were one of its real costs.
const DIM = 'rgba(9, 12, 11, 0.86)';

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    backgroundColor: DIM,
  },

  horizontal: {
    left: 0,
    right: 0,
  },

  solidDim: {
    backgroundColor: DIM,
  },

  // A single soft edge, not a glow. Enough to say the cutout is deliberate.
  ring: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(168,205,183,0.22)',
  },

  cardPositioner: {
    position: 'absolute',
    left: CARD_MARGIN,
    right: CARD_MARGIN,
    shadowColor: '#000000',
    shadowOpacity: 0.32,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 16 },
    elevation: 18,
  },

  bloom: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: R.lg,
    overflow: 'hidden',
  },

  bloomAccent: {
    position: 'absolute',
    left: -30,
    top: -40,
    width: 240,
    height: 180,
    borderRadius: 120,
    backgroundColor: 'rgba(107,168,130,0.16)',
  },

  card: {
    borderRadius: R.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(226,237,232,0.09)',
    borderTopColor: 'rgba(226,237,232,0.20)',
  },

  cardBody: {
    padding: S.lg,
    gap: S.sm,
  },

  // The sheet header scale, 26/800/-0.4 -- this is an aside, not a
  // destination, so it does not take the full-screen 44.
  title: {
    color: C.text,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.4,
  },

  body: {
    color: C.accentSoft,
    fontSize: 17,
    lineHeight: 25,
  },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: S.md,
  },

  hint: {
    color: C.faint,
    fontSize: 14,
  },

  counter: {
    color: C.faint,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
});
