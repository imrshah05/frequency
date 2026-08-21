import { useCallback, useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

/**
 * Marks a piece of static chrome that a spotlight can point at.
 *
 * Position is reported from the target's own `onLayout`, not discovered by
 * the overlay. The overlay never searches, never retries and never waits:
 * either a frame has been reported or it has not, and if it has not, the
 * spotlight degrades to a plain dim rather than stalling.
 *
 * `onLayout` gives parent-relative coordinates, but the overlay renders in
 * a Modal with its own coordinate space -- so one `measureInWindow` runs
 * inside the layout handler to convert. That is a single call caused by a
 * layout event, not a poll: it re-runs when the view actually moves
 * (rotation, a reflow) and never otherwise.
 *
 * Only for chrome that does not scroll -- the record button, dock icons,
 * the profile entry point. Anything inside a list or a scroll view uses
 * TutorialIntroCard instead, because a cutout cannot follow content that
 * moves under the finger.
 */

export type TutorialTargetFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const frames = new Map<string, TutorialTargetFrame>();
const listeners = new Set<() => void>();

// Every mounted target's own measure function.
//
// onLayout reports where a view is *when it is laid out*, but scrolling
// moves a view through the window without changing its layout, so a target
// inside a ScrollView reports a stale window position after any scroll.
// A spotlight asks for a fresh reading just before it points at something.
const remeasurers = new Set<() => void>();

/**
 * Re-reads every mounted target's position.
 *
 * Cheap: setFrame ignores a frame identical to the one it already holds,
 * so targets that have not moved cost one native measure and no render.
 */
export function requestTutorialTargetRemeasure() {
  remeasurers.forEach((remeasure) => remeasure());
}

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function framesMatch(a: TutorialTargetFrame, b: TutorialTargetFrame) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function setFrame(id: string, frame: TutorialTargetFrame) {
  const existing = frames.get(id);
  // Replacing an identical frame would hand useSyncExternalStore a new
  // object every layout pass and re-render the overlay for nothing.
  if (existing && framesMatch(existing, frame)) return;
  frames.set(id, frame);
  emit();
}

function clearFrame(id: string) {
  if (!frames.delete(id)) return;
  emit();
}

/**
 * The measured frame for a target, or null if nothing has reported one.
 *
 * A module-level registry rather than a context, so a screen can render a
 * target and a spotlight without a provider being mounted above it.
 */
export function useTutorialTargetFrame(id: string | null): TutorialTargetFrame | null {
  return useSyncExternalStore(
    subscribe,
    () => (id ? frames.get(id) ?? null : null),
    () => null
  );
}

export default function TutorialTarget({
  id,
  children,
  style,
  onLayout,
}: {
  id: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * Runs alongside the target's own measurement, never instead of it --
   * for a screen that also needs the layout (to scroll this into view, say).
   */
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const ref = useRef<View>(null);

  const measure = useCallback(() => {
    ref.current?.measureInWindow((x, y, width, height) => {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !width || !height) return;
      setFrame(id, { x, y, width, height });
    });
  }, [id]);

  useEffect(() => {
    remeasurers.add(measure);
    return () => {
      remeasurers.delete(measure);
      clearFrame(id);
    };
  }, [id, measure]);

  return (
    // collapsable={false} keeps this View in the native hierarchy on
    // Android; without it a layout-only wrapper is optimised away and has
    // nothing to measure.
    <View
      ref={ref}
      collapsable={false}
      style={style}
      onLayout={(event) => {
        measure();
        onLayout?.(event);
      }}
    >
      {children}
    </View>
  );
}
