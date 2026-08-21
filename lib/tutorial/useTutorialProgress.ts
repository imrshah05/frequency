import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { supabase } from '@/lib/supabase';
import {
  cachedTutorialProgress,
  clearTutorialProgressCache,
  loadTutorialProgress,
  markTutorialMomentCompleted,
  resetTutorialProgress,
  subscribeToTutorialProgress,
  type TutorialMoment,
} from '@/lib/tutorial/tutorialProgress';

/**
 * Who is signed in, watched once for the whole app.
 *
 * Six screens now ask about tutorial progress, and several ask twice (once
 * directly, once through useTutorialMoment). One auth subscription and one
 * session read is shared between all of them rather than each hook
 * instance opening its own.
 *
 * getSession, not getUser: getUser calls the auth server, and the only
 * thing needed here is which account the stored session belongs to.
 */
let currentUserId: string | null = null;
let userResolved = false;
let authWatcherStarted = false;
const userListeners = new Set<() => void>();

function emitUser() {
  userListeners.forEach((listener) => listener());
}

function applyUser(nextUserId: string | null) {
  userResolved = true;

  // Compared by value. Supabase emits a fresh Session object on every token
  // refresh and every return to the foreground, so reacting to identity
  // instead would clear the cache -- and restart a moment -- for no reason.
  if (nextUserId !== currentUserId) {
    currentUserId = nextUserId;
    // The cached progress belongs to whoever just signed out.
    clearTutorialProgressCache();
  }

  emitUser();
}

function startAuthWatcher() {
  if (authWatcherStarted) return;
  authWatcherStarted = true;

  void supabase.auth.getSession().then(({ data }) => applyUser(data.session?.user.id ?? null));

  // Never unsubscribed: it is one listener for the lifetime of the app, and
  // tearing it down when the last screen unmounts would only mean starting
  // it again on the next mount.
  supabase.auth.onAuthStateChange((_event, session) => applyUser(session?.user.id ?? null));
}

function subscribeToUser(listener: () => void) {
  startAuthWatcher();
  userListeners.add(listener);
  return () => {
    userListeners.delete(listener);
  };
}

/**
 * Whether this person has seen a given tutorial moment.
 *
 * Resolves the signed-in user itself rather than taking one as a prop --
 * tutorial progress is always about "me", and no screen should have to
 * plumb a user id down for it.
 *
 * `loading` is true until the answer is actually known. Nothing should
 * decide to *show* a tutorial while it is true: `hasCompleted` returns
 * false before the first read lands, and treating that as "not seen yet"
 * would flash a tutorial at someone who finished it months ago.
 */
export function useTutorialProgress() {
  const userId = useSyncExternalStore(
    subscribeToUser,
    () => currentUserId,
    () => null
  );
  const resolvedUser = useSyncExternalStore(
    subscribeToUser,
    () => userResolved,
    () => false
  );

  const [completed, setCompleted] = useState<Set<TutorialMoment> | null>(null);

  // Follows the shared cache, so a moment completed on one screen (or
  // cleared from Settings) is reflected everywhere without a refetch.
  useEffect(
    () =>
      subscribeToTutorialProgress(() => {
        setCompleted(cachedTutorialProgress(userId));
      }),
    [userId]
  );

  useEffect(() => {
    if (!userId) {
      setCompleted(null);
      return;
    }

    let active = true;
    setCompleted(cachedTutorialProgress(userId));

    void loadTutorialProgress(userId)
      .then((next) => {
        if (active) setCompleted(next);
      })
      .catch(() => {
        // Left as "not loaded". hasCompleted keeps returning false and
        // `loading` stays true, so callers hold off rather than showing a
        // tutorial on the strength of a failed read.
      });

    return () => {
      active = false;
    };
  }, [userId]);

  const hasCompleted = useCallback(
    (moment: TutorialMoment) => completed?.has(moment) ?? false,
    [completed]
  );

  const markCompleted = useCallback(
    async (moment: TutorialMoment) => {
      if (!userId) return;
      await markTutorialMomentCompleted(userId, moment);
    },
    [userId]
  );

  const resetAll = useCallback(async () => {
    if (!userId) return;
    await resetTutorialProgress(userId);
  }, [userId]);

  return {
    /** True until this user's progress is known. Do not show a tutorial while true. */
    loading: !resolvedUser || (!!userId && completed === null),
    userId,
    hasCompleted,
    markCompleted,
    resetAll,
  };
}
