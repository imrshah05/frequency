import { useCallback, useEffect, useRef, useState } from 'react';

import { selection } from '@/lib/haptics';

/**
 * Which message is currently showing when it was sent.
 *
 * A Whisper thread carries no timestamps on its face -- a wall of clock
 * times turns a quiet room into a log. The time is still there whenever it
 * is wanted: hold a message and it says so, then goes quiet again on its
 * own, so nothing has to be dismissed.
 *
 * One reveal at a time, and one timer for the whole thread rather than one
 * per message.
 */

// Long enough to read a time and a date without hurrying, short enough that
// the thread returns to rest before it feels stuck open.
const HOLD_MS = 2600;

export function useMessageTimeReveal(holdMs = HOLD_MS) {
  const [revealedMessageId, setRevealedMessageId] = useState<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const revealMessageTime = useCallback(
    (messageId: string) => {
      void selection();

      if (hideTimer.current) clearTimeout(hideTimer.current);

      setRevealedMessageId(messageId);
      hideTimer.current = setTimeout(() => setRevealedMessageId(null), holdMs);
    },
    [holdMs]
  );

  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    []
  );

  return { revealedMessageId, revealMessageTime };
}
