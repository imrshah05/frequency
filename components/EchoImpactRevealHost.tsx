import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Modal, StyleSheet, View } from 'react-native';

import EchoImpactReveal from '@/components/EchoImpactReveal';
import {
  loadPendingEchoReveals,
  markEchoRevealSeen,
  sealFinishedEchoes,
  type PendingEchoReveal,
} from '@/lib/echoImpactReveal';

// Held on true black between two reveals. Long enough to read as one
// moment ending and a separate one beginning, short enough that it never
// feels like waiting.
const BETWEEN_REVEALS_MS = 280;

/**
 * Watches for Impacts that have been sealed but never seen, and gives each
 * one its own full-screen moment.
 *
 * Mounted once at the root, above navigation, so a reveal can arrive
 * whatever screen the person happens to be on. It never blocks startup:
 * the check is fired and forgotten, the component renders nothing until
 * an answer comes back, and for the overwhelming majority of app opens --
 * where nothing is waiting -- it renders nothing at all and the app
 * behaves exactly as it did before.
 *
 * Reveals are strictly sequential. Each Echo is marked seen the moment its
 * own reveal is finished with, then the next one enters fresh rather than
 * scrolling on as a second chapter, because two Echoes' Impacts are two
 * separate things that happened, not one report covering both.
 */
export default function EchoImpactRevealHost({ userId }: { userId: string | null }) {
  const [queue, setQueue] = useState<PendingEchoReveal[]>([]);
  const [total, setTotal] = useState(0);
  const [betweenReveals, setBetweenReveals] = useState(false);

  // 'idle' is the only state a check may start from, so a foreground event
  // arriving mid-reveal cannot reload the queue out from under someone.
  const stageRef = useRef<'idle' | 'checking' | 'showing'>('idle');
  // Bumped whenever the account changes or the host unmounts, so a check
  // that was already in flight cannot deliver its result to the wrong user.
  const runIdRef = useRef(0);

  // The account a reveal on screen belongs to. Compared by value, so a new
  // Session object carrying the same user does not read as a change.
  const shownForUserRef = useRef<string | null>(null);

  const checkForReveals = useCallback(async () => {
    if (!userId || stageRef.current !== 'idle') return;

    const runId = runIdRef.current;
    stageRef.current = 'checking';

    // Seal first, then look. An Echo whose run ended while the app was
    // closed has no Impact at all until something writes one, so asking
    // for pending reveals before this would find nothing on the very
    // launch where the reveal is due. Failures here are already logged and
    // swallowed -- an Echo that cannot be sealed is simply not revealed
    // yet, and the next launch tries again.
    await sealFinishedEchoes();

    if (runId !== runIdRef.current) return;

    const pending = await loadPendingEchoReveals(userId);

    if (runId !== runIdRef.current) return;

    if (pending.length === 0) {
      stageRef.current = 'idle';
      return;
    }

    stageRef.current = 'showing';
    setTotal(pending.length);
    setQueue(pending);
  }, [userId]);

  // Launch, and every account switch.
  //
  // The teardown is deliberately gated on the user actually changing. This
  // effect re-runs whenever its callback identity does, and Supabase hands
  // the root layout a fresh Session object on every token refresh and
  // foreground -- so an unconditional reset here would wipe a reveal off
  // the screen mid-watch, and an unconditional run-id bump in the cleanup
  // would throw away a check that was still in flight. Both showed up as
  // the reveal appearing and vanishing again immediately.
  useEffect(() => {
    if (shownForUserRef.current !== userId) {
      shownForUserRef.current = userId;
      runIdRef.current += 1;
      stageRef.current = 'idle';
      setQueue([]);
      setTotal(0);
      setBetweenReveals(false);
    }

    void checkForReveals();
  }, [checkForReveals, userId]);

  // Only a real unmount invalidates an in-flight check.
  useEffect(() => () => {
    runIdRef.current += 1;
  }, []);

  // Returning to the app. An Impact is sealed by an hourly sweep, so the
  // usual way one becomes ready is that time passed while the app was in
  // the background -- which is exactly this event.
  useEffect(() => {
    let previousState = AppState.currentState;

    const subscription = AppState.addEventListener('change', (nextState) => {
      const returned = previousState !== 'active' && nextState === 'active';
      previousState = nextState;
      if (returned) void checkForReveals();
    });

    return () => subscription.remove();
  }, [checkForReveals]);

  const current = queue[0];

  function finishCurrentReveal() {
    if (!current || betweenReveals) return;

    // Recorded as soon as this Echo is done with, not at the end of the
    // whole run: someone who watches the first of three and closes the app
    // should never be shown that first one again.
    void markEchoRevealSeen(current.voiceNoteId);

    // Safe to read now rather than inside the updater: a check cannot run
    // while stageRef is 'showing', so nothing else can change the queue
    // between here and the timeout firing.
    const wasLast = queue.length === 1;

    setBetweenReveals(true);
    setTimeout(() => {
      setQueue((remaining) => remaining.slice(1));
      setBetweenReveals(false);
      if (wasLast) stageRef.current = 'idle';
    }, BETWEEN_REVEALS_MS);
  }

  return (
    <Modal
      visible={queue.length > 0}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={finishCurrentReveal}
    >
      <View style={styles.root}>
        {/*
          Keyed by Echo so the next reveal mounts clean and replays its own
          entrance from the top, rather than swapping its content in behind
          animations that have already finished.
        */}
        {!!current && !betweenReveals && (
          <EchoImpactReveal
            key={current.voiceNoteId}
            reveal={current}
            position={total - queue.length + 1}
            total={total}
            onDismiss={finishCurrentReveal}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
});
