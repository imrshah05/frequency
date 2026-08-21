import { supabase } from '@/lib/supabase';

/**
 * Which tutorial moments exist, and whether this person has seen them.
 *
 * The data side only. `useTutorialProgress` is the React surface; keeping
 * the queries here matches how echoMetrics/loadEchoMetrics are split, so a
 * screen can ask a question without pulling a hook into a callback.
 */

// The full set. A moment is a string in the database, but never a loose
// string in the app -- a typo'd key would silently mean "never completed",
// which is exactly the failure the old search step had.
//
// `feed`, `record` and `whispers` are declared but nothing writes them yet:
// those screens are not wired. They are kept here rather than added later
// so the shape of the finished rollout is visible in one place, and so
// `profile_discovery` has a documented successor to be gated on once the
// Feed moment exists (it currently follows `welcome` instead).
export const TUTORIAL_MOMENTS = [
  'welcome',

  // Not wired yet.
  'feed',
  'record',
  'whispers',

  // Wired.
  'profile_discovery',
  'profile',
  'resonance_field',
  'resonance_checkin',
  'echo_impact',
] as const;

export type TutorialMoment = (typeof TUTORIAL_MOMENTS)[number];

type CacheEntry = {
  userId: string;
  completed: Set<TutorialMoment>;
};

// One read per app session per account, not one per screen mount. Several
// screens will ask the same question as the user moves around, and the
// answer only changes when this app changes it.
//
// Module level rather than React state because the cache has to outlive
// every individual screen -- a hook's state would be refetched on every
// mount, which is the thing being avoided.
let cache: CacheEntry | null = null;
let inFlight: Promise<Set<TutorialMoment>> | null = null;

// Consumers are notified when the set changes, so "Show tutorials again"
// in Settings takes effect everywhere at once rather than on next launch.
const listeners = new Set<() => void>();

// Bumped only by resetTutorialProgress.
//
// Moments latch their decision once, so that completing one -- or clearing
// progress from Settings -- cannot make a tutorial jump onto the screen the
// user is currently looking at. That latch also meant "Show tutorials
// again" appeared to do nothing: the rows really were deleted, but every
// already-mounted moment had made up its mind and never asked again.
//
// This is what distinguishes the two cases. Completing a moment leaves the
// generation alone, so it stays gone. Resetting bumps it, which changes
// every moment's decision key and lets them all decide afresh.
let resetGeneration = 0;

export function tutorialResetGeneration() {
  return resetGeneration;
}

function emit() {
  listeners.forEach((listener) => listener());
}

export function subscribeToTutorialProgress(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The cached answer, or null if this user's progress has not loaded yet. */
export function cachedTutorialProgress(userId: string | null): Set<TutorialMoment> | null {
  if (!userId || cache?.userId !== userId) return null;
  return cache.completed;
}

/**
 * Every moment this user has finished.
 *
 * Concurrent callers share one request: several screens mounting at once
 * on a cold start would otherwise each fire the same query.
 */
export async function loadTutorialProgress(userId: string): Promise<Set<TutorialMoment>> {
  const cached = cachedTutorialProgress(userId);
  if (cached) return cached;

  if (inFlight) return inFlight;

  inFlight = (async () => {
    const { data, error } = await supabase
      .from('tutorial_progress')
      .select('moment_key, completed_at')
      .eq('user_id', userId);

    if (error) {
      // A failed read must not mean "show every tutorial again". Returning
      // an empty set here would do exactly that, so the failure is treated
      // as "nothing known yet" and left uncached, to be retried.
      if (__DEV__) console.warn('[tutorial] Failed to read progress.', error.message);
      throw error;
    }

    const completed = new Set<TutorialMoment>();
    (data ?? []).forEach((row) => {
      if (row.completed_at) completed.add(row.moment_key as TutorialMoment);
    });

    cache = { userId, completed };
    emit();
    return completed;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/**
 * Records that a moment has been seen.
 *
 * The cache is updated first so the tutorial disappears on the same frame
 * it was dismissed, rather than after a round trip. An upsert rather than
 * an insert, so a moment that was started earlier and left unfinished
 * (a row with a null completed_at) is completed rather than conflicting.
 */
export async function markTutorialMomentCompleted(userId: string, moment: TutorialMoment) {
  if (cache?.userId === userId) {
    cache.completed.add(moment);
    // A new Set, not the mutated one: consumers compare by reference to
    // decide whether to re-render.
    cache = { userId, completed: new Set(cache.completed) };
    emit();
  }

  const { error } = await supabase
    .from('tutorial_progress')
    .upsert(
      { user_id: userId, moment_key: moment, completed_at: new Date().toISOString() },
      { onConflict: 'user_id,moment_key' }
    );

  if (error && __DEV__) {
    console.warn('[tutorial] Failed to record progress.', error.message);
  }
}

/**
 * Clears every moment, so the tutorials run again from the beginning.
 *
 * Deletes the rows rather than nulling completed_at: an absent row and a
 * row with no completion mean the same thing to every reader, and the
 * smaller of the two is no rows at all.
 */
export async function resetTutorialProgress(userId: string) {
  const { error } = await supabase.from('tutorial_progress').delete().eq('user_id', userId);

  if (error) {
    if (__DEV__) console.warn('[tutorial] Failed to reset progress.', error.message);
    throw error;
  }

  cache = { userId, completed: new Set() };
  resetGeneration += 1;
  emit();
}

/** Drops the cache on sign-out or account switch. */
export function clearTutorialProgressCache() {
  cache = null;
  emit();
}
