import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { useTutorialProgress } from '@/lib/tutorial/useTutorialProgress';
import {
  subscribeToTutorialProgress,
  tutorialResetGeneration,
  type TutorialMoment,
} from '@/lib/tutorial/tutorialProgress';

/**
 * Master switch for every tutorial moment, including the welcome screen.
 *
 * Set this to false to make the whole system inert -- nothing in
 * components/tutorial mounts, and the app behaves as though none of it
 * existed. That is the first thing to try if a tutorial ever appears to
 * lock the app up again, and it doubles as a diagnostic: if the app is
 * still stuck with this off, the cause is somewhere else entirely.
 *
 * The failure that made this switch necessary was an overlay that blocked
 * every touch without being visible. SpotlightOverlay is now built so that
 * cannot recur -- its blocking layer is a plain, unanimated view -- but the
 * switch stays as the one-line way out.
 */
const TUTORIALS_ENABLED = false;

/**
 * Whether one tutorial moment should be running right now.
 *
 * The decision is taken once -- when progress has loaded and the screen
 * says it is ready -- and revisited only when progress is deliberately
 * cleared. Two things depend on that latch:
 *
 *   - Supabase hands down a fresh Session object on every token refresh,
 *     so anything re-deciding on identity rather than value would restart
 *     a moment mid-watch.
 *   - Marking the moment complete flips `hasCompleted`, which would
 *     otherwise re-run this effect and fight the dismissal.
 *
 * "Show tutorials again" is the one thing that must reopen the decision,
 * and it is told apart from a completion by the reset generation rather
 * than by the progress set changing. Without that, the button deleted the
 * rows correctly and appeared to do nothing.
 *
 * `enabled` is for moments that depend on what a screen has loaded -- the
 * Echo Impact card only makes sense once an Echo with an Impact is on
 * screen. While it is false no decision is made at all, so the moment
 * waits rather than being skipped.
 */
export function useTutorialMoment(
  moment: TutorialMoment,
  { enabled = true }: { enabled?: boolean } = {}
) {
  const { loading, userId, hasCompleted, markCompleted } = useTutorialProgress();
  const resetGeneration = useSyncExternalStore(
    subscribeToTutorialProgress,
    tutorialResetGeneration,
    () => 0
  );
  const [active, setActive] = useState(false);
  const decidedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!TUTORIALS_ENABLED) {
      setActive(false);
      return;
    }

    if (!userId) {
      decidedForRef.current = null;
      setActive(false);
      return;
    }

    // `loading` is what keeps this honest. hasCompleted is false before the
    // first read lands, so deciding on that alone would show every moment
    // to someone who finished them months ago.
    if (loading) return;

    // The condition that made this moment relevant is gone -- the screen
    // lost focus, or moved past the step this was explaining. Close it.
    //
    // This used to only skip *deciding*, which meant a moment that was
    // already showing outlived the thing it described: the Resonance
    // check-in card stayed mounted through recording and saving, and was
    // still a live modal when the screen was dismissed. A visible modal
    // torn down mid-dismissal is how iOS ends up with an orphaned,
    // transparent window that swallows every touch.
    //
    // The decision is forgotten rather than spent, so the moment arrives
    // again next time instead of being silently lost.
    if (!enabled) {
      decidedForRef.current = null;
      setActive(false);
      return;
    }

    // The generation is part of the key, so a reset reopens the decision
    // for every moment while an ordinary completion does not.
    const decision = `${userId}:${moment}:${resetGeneration}`;
    if (decidedForRef.current === decision) return;

    decidedForRef.current = decision;
    setActive(!hasCompleted(moment));
  }, [enabled, hasCompleted, loading, moment, resetGeneration, userId]);

  const finish = useCallback(() => {
    // Closed first, so the moment leaves on the frame it was dismissed
    // rather than after a round trip.
    setActive(false);
    void markCompleted(moment);
  }, [markCompleted, moment]);

  return { active, finish };
}
