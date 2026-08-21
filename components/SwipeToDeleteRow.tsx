import Ionicons from '@expo/vector-icons/Ionicons';
import { type ReactNode, useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { FrequencyColors as C } from '@/constants/frequencyTheme';

const DELETE_WIDTH = 88;
const OPEN_THRESHOLD = DELETE_WIDTH / 2;
const SPRING = { damping: 20, stiffness: 260 };

function clamp(value: number, min: number, max: number) {
  'worklet';
  return Math.max(min, Math.min(max, value));
}

type SwipeToDeleteRowProps = {
  children: ReactNode;
  onDelete: () => void;
  /**
   * Shared across every row in the same list so opening one closes
   * whichever other row was left open -- otherwise a quick series of
   * swipes leaves several Delete panels exposed at once, which reads as
   * broken rather than deliberate.
   */
  activeRowRef?: React.MutableRefObject<(() => void) | null>;
};

/**
 * iOS Mail/Messages-style swipe left to reveal a Delete button, tap to
 * confirm -- no modal, since deleting one Activity card is low-stakes and
 * the swipe-then-tap gesture is already a deliberate two-step.
 *
 * Built with react-native-gesture-handler's Gesture.Pan rather than the
 * legacy PanResponder that SwipeReplyRow (app/whispers/[threadId].tsx)
 * uses. This row lives inside a BottomSheetFlatList, and @gorhom/bottom-sheet
 * is itself built entirely on RNGH -- a PanResponder, which runs on RN's
 * separate legacy responder system, never got a chance to see the drag
 * because the sheet's own RNGH gesture handlers already claimed it
 * natively first. Gesture.Pan participates in that same RNGH arena, so it
 * can actually negotiate with the sheet instead of losing to it silently.
 * activeOffsetX/failOffsetY do the same "only if this is clearly
 * horizontal" job the old dx/dy comparison did, but as a native-thread
 * gesture-arena rule instead of a JS-thread heuristic.
 */
export default function SwipeToDeleteRow({ children, onDelete, activeRowRef }: SwipeToDeleteRowProps) {
  const translateX = useSharedValue(0);
  const baseOffset = useSharedValue(0);
  const openShared = useSharedValue(false);
  const [isOpen, setIsOpen] = useState(false);

  // Holds this row's own close function under a stable identity, so
  // activeRowRef can later tell "this row" apart from "some other row"
  // without snapTo needing to reference a function defined in terms of
  // itself.
  const closeSelfRef = useRef<() => void>(() => {});

  const snapTo = useCallback(
    (open: boolean) => {
      openShared.value = open;
      setIsOpen(open);
      translateX.value = withSpring(open ? -DELETE_WIDTH : 0, SPRING);

      if (open) {
        if (activeRowRef?.current && activeRowRef.current !== closeSelfRef.current) {
          activeRowRef.current();
        }
        if (activeRowRef) activeRowRef.current = closeSelfRef.current;
      } else if (activeRowRef?.current === closeSelfRef.current) {
        activeRowRef.current = null;
      }
    },
    [activeRowRef, openShared, translateX]
  );

  closeSelfRef.current = () => snapTo(false);

  const pan = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-10, 10])
    .onStart(() => {
      baseOffset.value = openShared.value ? -DELETE_WIDTH : 0;
    })
    .onUpdate((event) => {
      translateX.value = clamp(baseOffset.value + event.translationX, -DELETE_WIDTH, 0);
    })
    .onEnd((event) => {
      const settled = baseOffset.value + event.translationX;
      runOnJS(snapTo)(settled <= -OPEN_THRESHOLD);
    })
    .onFinalize((_event, success) => {
      if (!success) runOnJS(snapTo)(openShared.value);
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <View style={styles.container}>
      <View style={styles.deleteTrack}>
        <Pressable
          style={styles.deleteButton}
          onPress={() => {
            if (activeRowRef?.current === closeSelfRef.current) activeRowRef.current = null;
            onDelete();
          }}
        >
          <Ionicons name="trash-outline" size={18} color="#1A0E0E" />
          <Text style={styles.deleteText}>Delete</Text>
        </Pressable>
      </View>

      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.content, animatedStyle]}>
          {children}
          {isOpen && (
            <Pressable style={StyleSheet.absoluteFill} onPress={() => snapTo(false)} />
          )}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },

  deleteTrack: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'flex-end',
  },

  deleteButton: {
    width: DELETE_WIDTH,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    backgroundColor: C.danger,
  },

  deleteText: {
    color: '#1A0E0E',
    fontSize: 12,
    fontWeight: '800',
  },

  content: {
    backgroundColor: C.surface,
  },
});
