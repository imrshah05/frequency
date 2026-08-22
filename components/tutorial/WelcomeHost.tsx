import WelcomeToFrequency from '@/components/tutorial/WelcomeToFrequency';
import { TUTORIAL_MOMENTS } from '@/lib/tutorial/moments';
import { useTutorialProgress } from '@/lib/tutorial/useTutorialProgress';

/**
 * Shows the welcome once per account, on the first launch after signing in.
 *
 * WHY THIS IS NOT ON THE AUTH SCREEN ANY MORE, AND NOT DEVICE-LOCAL.
 *
 * It used to be both. The reasoning was that the welcome belongs to the app's
 * front door rather than to a person, so a device flag was the honest scope --
 * and it had to be device-local anyway, because on the auth screen nobody is
 * signed in and there is no auth.uid() to key a row on.
 *
 * Both halves were wrong in practice. Creating a second account on a phone
 * that had already been welcomed showed nothing, because the flag was already
 * set. And someone signing up never saw it at all: the welcome rendered on the
 * login screen, which a new account passes through on its way in rather than
 * lingering on.
 *
 * Being welcomed is something that happens to a person joining, not to a
 * handset. So it now waits until there IS an account, which also means it can
 * live in tutorial_progress with every other moment instead of needing its own
 * storage -- and "Show tutorials again" brings it back for free, since that
 * already deletes this account's rows.
 *
 * Mounted at the root, outside the navigator, the same way the Echo Impact
 * reveal is: it takes over the whole screen and belongs to no one tab.
 */
export default function WelcomeHost({ userId }: { userId: string | null }) {
  const { ready, hasCompleted, markCompleted } = useTutorialProgress(userId);

  // hasCompleted reports true until the read lands, so there is no frame where
  // this flashes up and then disappears on a returning account.
  if (!userId || !ready || hasCompleted(TUTORIAL_MOMENTS.welcome)) return null;

  return (
    <WelcomeToFrequency onBegin={() => void markCompleted(TUTORIAL_MOMENTS.welcome)} />
  );
}
