import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from '@/lib/supabase';
import { clearWelcomeSeen } from '@/lib/tutorial/welcome';

/**
 * Which tutorial moments the signed-in person has already been shown.
 *
 * One round trip per session, not one per moment. Every completed moment_key
 * is loaded once into a Set and answered from memory after that -- a tutorial
 * asks "have I run yet" on nearly every screen mount, and a query each time
 * would put a network call in front of a render that has to be instant to
 * feel like anything but a stutter.
 *
 * The cache lives outside React, keyed by user, so it survives unmounts and
 * remounts within a session. A tutorial that reappears because its screen was
 * navigated away from and back is the whole failure this avoids.
 */
type MomentCache = {
  userId: string;
  completed: Set<string>;
};

let cache: MomentCache | null = null;
let inFlight: Promise<MomentCache> | null = null;

async function loadCompleted(userId: string): Promise<MomentCache> {
  if (cache?.userId === userId) return cache;

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
  cache = loaded;
  return loaded;
}

/** Drops the session cache. Exported for sign-out and for the Settings reset. */
export function resetTutorialCache() {
  cache = null;
  inFlight = null;
}

export function useTutorialProgress(userId: string | null | undefined) {
  const [ready, setReady] = useState(false);
  const completedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) {
      completedRef.current = new Set();
      setReady(false);
      return;
    }

    let active = true;
    setReady(false);

    void loadCompleted(userId).then((loaded) => {
      if (!active) return;
      completedRef.current = loaded.completed;
      setReady(true);
    });

    return () => {
      active = false;
    };
  }, [userId]);

  /**
   * Synchronous by design. Callers ask this during render to decide whether to
   * mount a spotlight, and an async answer would mean the moment flashes in a
   * frame late or not at all. `ready` is what says the answer is trustworthy;
   * until then this reports true, so nothing runs on a half-loaded cache.
   */
  const hasCompleted = useCallback(
    (momentKey: string) => {
      if (!ready) return true;
      return completedRef.current.has('*') || completedRef.current.has(momentKey);
    },
    [ready]
  );

  const markCompleted = useCallback(
    async (momentKey: string) => {
      if (!userId) return;

      // Local first, so a moment can never run twice while the write is in
      // flight -- the tap that finishes a tutorial often navigates, and the
      // destination may ask this question before the round trip lands.
      completedRef.current.add(momentKey);

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

    completedRef.current = new Set();
    resetTutorialCache();
    // The welcome is device-local rather than a row in this table, so the
    // reset has to reach it separately or "again" would quietly mean
    // "everything except the first thing you ever saw".
    await clearWelcomeSeen();
  }, [userId]);

  return { ready, hasCompleted, markCompleted, resetAll };
}
