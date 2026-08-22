import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

/**
 * Which tutorial moments the signed-in person has already been shown.
 *
 * One round trip per session, not one per moment. Every completed moment_key
 * is loaded once into a Set and answered from memory after that -- a tutorial
 * asks "have I run yet" on nearly every screen mount, and a query each time
 * would put a network call in front of a render that has to be instant.
 *
 * WHY THIS IS A SUBSCRIBABLE STORE AND NOT JUST A CACHE
 *
 * Two screens hold this hook at once: the Feed runs the tutorial, and Profile
 * owns the "Show tutorials again" button. Tabs stay mounted, so when Profile
 * resets, the Feed's copy of the answer has to change *underneath it* -- there
 * is no remount to reload on.
 *
 * The first version kept the Set in a ref per hook instance and cleared only
 * the resetting instance's ref, so the Feed went on believing everything was
 * finished and the reset button did nothing visible. The Set now lives in one
 * module-level store, and every mounted hook subscribes to it. `version` is
 * what makes that change reach memoised consumers: it is in hasCompleted's
 * dependency list, so anything derived from hasCompleted recomputes when
 * progress moves.
 */
type Snapshot = {
  userId: string;
  completed: Set<string>;
};

let store: Snapshot | null = null;
let inFlight: Promise<Snapshot> | null = null;

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

async function loadCompleted(userId: string): Promise<Snapshot> {
  if (store?.userId === userId) return store;

  // A second caller arriving while the first query is open waits on the same
  // promise rather than firing its own -- two screens mounting together is
  // the normal case, not the exception.
  if (inFlight) {
    const pending = await inFlight;
    if (pending.userId === userId) return pending;
  }

  inFlight = (async () => {
    const { data, error } = await supabase
      .from('tutorial_progress')
      .select('moment_key')
      .eq('user_id', userId)
      .not('completed_at', 'is', null);

    if (error) {
      // Failing closed -- treating every moment as already seen -- is the
      // right default. A tutorial that silently does not run is a missed
      // nicety; one that runs on every launch because a read failed is the
      // thing people uninstall over.
      console.warn('[tutorial] Failed to read progress.', error.message);
      return { userId, completed: new Set<string>(['*']) };
    }

    return {
      userId,
      completed: new Set(data?.map((row) => row.moment_key as string) ?? []),
    };
  })();

  const loaded = await inFlight;
  inFlight = null;
  store = loaded;
  return loaded;
}

export function useTutorialProgress(userId: string | null | undefined) {
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const listener = () => setVersion((current) => current + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!userId) {
      setReady(false);
      return;
    }

    let active = true;
    setReady(false);

    void loadCompleted(userId).then(() => {
      if (!active) return;
      setReady(true);
    });

    return () => {
      active = false;
    };
  }, [userId]);

  /**
   * Synchronous by design. Callers ask this during render to decide whether to
   * mount a spotlight, and an async answer would mean the moment flashes a
   * frame late or not at all. `ready` is what says the answer is trustworthy;
   * until then this reports true, so nothing runs on a half-loaded store.
   */
  const hasCompleted = useCallback(
    (momentKey: string) => {
      if (!ready) return true;

      // Captured once: `store` is module state and could in principle be
      // replaced between the guard and the read.
      const snapshot = store;
      if (!snapshot || snapshot.userId !== userId) return true;

      return snapshot.completed.has('*') || snapshot.completed.has(momentKey);
    },
    // version is the invalidation key, not an unused dependency: it is what
    // makes memoised callers recompute when the store changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, userId, version]
  );

  const markCompleted = useCallback(
    async (momentKey: string) => {
      if (!userId) return;

      // Local first, so a moment can never run twice while the write is in
      // flight -- the tap that finishes a step often navigates, and the
      // destination may ask this question before the round trip lands.
      if (store?.userId === userId) {
        store.completed.add(momentKey);
        notify();
      }

      const { error } = await supabase
        .from('tutorial_progress')
        .upsert(
          { user_id: userId, moment_key: momentKey, completed_at: new Date().toISOString() },
          { onConflict: 'user_id,moment_key' }
        );

      if (error) console.warn('[tutorial] Failed to record progress.', error.message);
    },
    [userId]
  );

  /** "Show tutorials again": clears every moment for this account. */
  const resetAll = useCallback(async () => {
    if (!userId) return;

    const { error } = await supabase.from('tutorial_progress').delete().eq('user_id', userId);

    if (error) {
      console.warn('[tutorial] Failed to reset progress.', error.message);
      return;
    }

    // Emptied in place rather than replaced, so every hook instance reading
    // this store sees it -- and notified, so they actually re-render.
    if (store?.userId === userId) {
      store.completed.clear();
    } else {
      store = { userId, completed: new Set() };
    }
    notify();
  }, [userId]);

  return { ready, hasCompleted, markCompleted, resetAll };
}
