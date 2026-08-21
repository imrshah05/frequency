import { useMemo, useRef } from 'react';
import { PanResponder, View, LayoutChangeEvent } from 'react-native';

// Matches React Native's own Pressable default, so a hold feels the same
// whether the finger lands on the waveform or on the bubble around it.
const LONG_PRESS_MS = 500;

// Below this the finger is resting, not moving.
const MOVE_SLOP = 4;

/**
 * Drag-to-seek gesture for any waveform bar row. Uses the touch event's
 * pageX (absolute screen coordinates) rather than locationX, since locationX
 * is relative to whichever individual bar view was hit, not the row as a
 * whole.
 *
 * onScrubStart/onScrubEnd let the parent feed disable its own scroll view
 * while a drag is active. A horizontal scrub gesture is never perfectly
 * horizontal, and the parent is a paging FlatList — a few points of
 * incidental vertical movement is enough for the native scroll view to
 * independently register its own "begin drag" and stop/unload whatever
 * sound is currently playing, out from under an in-flight seek.
 *
 * onLongPress is here for the same reason: because this responder claims the
 * touch the moment a finger lands, a Pressable wrapped around the waveform
 * would never see a hold. Callers that want one pass it in and get it back
 * without the release also landing as a seek.
 *
 * That lock-out is deliberately deferred until a drag proves itself
 * horizontal. Claiming it on touch-down instead would turn the whole
 * waveform into a region where vertical swipes do nothing — barely
 * noticeable when the waveform was a small strip in a corner, but the feed
 * now runs one edge to edge across the middle of every Echo page. So:
 * taps seek, horizontal drags scrub and lock the parent out, and vertical
 * drags are released back to whatever is scrolling behind.
 */
export function useWaveformScrub(
  onSeek?: (fraction: number) => void,
  onScrubStart?: () => void,
  onScrubEnd?: () => void,
  onLongPress?: () => void
) {
  const containerRef = useRef<View>(null);
  const widthRef = useRef(0);
  const pageXRef = useRef(0);
  // Whether the current gesture has committed to being a scrub. Until it
  // does, the parent scroll view is still free to take the gesture over.
  const scrubbingRef = useRef(false);
  const onSeekRef = useRef(onSeek);
  onSeekRef.current = onSeek;
  const onScrubStartRef = useRef(onScrubStart);
  onScrubStartRef.current = onScrubStart;
  const onScrubEndRef = useRef(onScrubEnd);
  onScrubEndRef.current = onScrubEnd;
  const onLongPressRef = useRef(onLongPress);
  onLongPressRef.current = onLongPress;
  // A hold is detected here rather than by a Pressable wrapped around the
  // waveform: this responder takes the touch on contact, so nothing outside
  // it ever hears about a finger resting on a bar.
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressedRef = useRef(false);

  function cancelLongPress() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function measureContainer() {
    containerRef.current?.measure((_x, _y, _width, _height, pageX) => {
      pageXRef.current = pageX;
    });
  }

  function fractionFromScreenX(screenX: number) {
    if (!widthRef.current) return null;
    return Math.max(0, Math.min(1, (screenX - pageXRef.current) / widthRef.current));
  }

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !!onSeekRef.current || !!onLongPressRef.current,
        onMoveShouldSetPanResponder: () => !!onSeekRef.current || !!onLongPressRef.current,
        onPanResponderGrant: () => {
          measureContainer();
          scrubbingRef.current = false;
          longPressedRef.current = false;

          if (!onLongPressRef.current) return;

          longPressTimer.current = setTimeout(() => {
            longPressTimer.current = null;
            longPressedRef.current = true;
            onLongPressRef.current?.();
          }, LONG_PRESS_MS);
        },
        onPanResponderMove: (evt, gesture) => {
          // Any real movement means the finger is scrubbing or scrolling,
          // not resting.
          if (Math.abs(gesture.dx) >= MOVE_SLOP || Math.abs(gesture.dy) >= MOVE_SLOP) {
            cancelLongPress();
          }

          if (!scrubbingRef.current) {
            // Undecided: a vertical-leaning drag belongs to whatever is
            // scrolling behind us, and a drag this small hasn't picked a
            // direction yet. Either way, don't seek and don't lock the
            // parent out.
            if (Math.abs(gesture.dy) >= Math.abs(gesture.dx)) return;
            if (Math.abs(gesture.dx) < 4) return;

            scrubbingRef.current = true;
            onScrubStartRef.current?.();
          }

          // Use the touch's actual current position rather than
          // gestureState.moveX, which React Native only derives from move
          // samples within the last ~100ms. Pausing briefly before lifting
          // the finger — common when dragging backward to land precisely
          // on an earlier point — leaves no recent sample, so moveX falls
          // back to 0 and the seek snaps to the very start of the track.
          const fraction = fractionFromScreenX(evt.nativeEvent.pageX);
          if (fraction != null) onSeekRef.current?.(fraction);
        },
        onPanResponderRelease: (evt, gesture) => {
          cancelLongPress();

          // Seek on a committed scrub, or on a tap. A vertical drag that
          // was never taken over by the parent must not land as a seek at
          // wherever the finger happened to lift. A hold that already
          // revealed something isn't a tap either -- asking when a Whisper
          // was sent should never move its playhead.
          const isTap =
            !longPressedRef.current &&
            Math.abs(gesture.dx) < 4 &&
            Math.abs(gesture.dy) < 4;

          if (scrubbingRef.current || isTap) {
            const fraction = fractionFromScreenX(evt.nativeEvent.pageX);
            if (fraction != null) onSeekRef.current?.(fraction);
          }

          if (scrubbingRef.current) {
            scrubbingRef.current = false;
            onScrubEndRef.current?.();
          }
        },
        onPanResponderTerminate: () => {
          cancelLongPress();

          if (!scrubbingRef.current) return;

          scrubbingRef.current = false;
          onScrubEndRef.current?.();
        },
        // Refuse once the drag is a real scrub — that is the original
        // reason this exists. Before then, let the parent have it.
        onPanResponderTerminationRequest: () => !scrubbingRef.current,
        onShouldBlockNativeResponder: () => true,
      }),
    []
  );

  function onLayout(event: LayoutChangeEvent) {
    widthRef.current = event.nativeEvent.layout.width;
    measureContainer();
  }

  return { containerRef, onLayout, panHandlers: panResponder.panHandlers };
}
