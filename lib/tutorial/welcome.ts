import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Whether the welcome moment has played on this device.
 *
 * WHY THIS IS NOT IN tutorial_progress, WHICH IS OTHERWISE THE ONE SOURCE
 * OF TRUTH FOR TUTORIAL STATE:
 *
 * The welcome plays on the auth screen, before anyone has signed in. There is
 * no auth.uid() at that point, so a user-scoped row under RLS can be neither
 * read nor written -- the question "has this person seen the welcome" has no
 * answer yet, because there is no person yet.
 *
 * Device-local is also the honest scope for it. The welcome is a first-launch
 * greeting attached to the app's front door, not to an account: someone who
 * signs out and back in on the same phone has already been welcomed, and
 * someone opening Frequency for the first time on a new phone has not,
 * whichever account they then reach for.
 *
 * Every other moment is account state and belongs in tutorial_progress.
 */
const WELCOME_SEEN_KEY = 'frequency:tutorial:welcome-seen';

export async function hasSeenWelcome() {
  try {
    return (await AsyncStorage.getItem(WELCOME_SEEN_KEY)) === 'true';
  } catch {
    // A storage read that fails should not strand someone on a blank screen.
    // Treating it as "already seen" skips the animation and leaves the auth
    // screen immediately usable, which is the safer of the two failures.
    return true;
  }
}

export async function markWelcomeSeen() {
  try {
    await AsyncStorage.setItem(WELCOME_SEEN_KEY, 'true');
  } catch {
    // Worst case the welcome plays once more next launch. Not worth surfacing.
  }
}

/** Used by "Show tutorials again" in Settings, so the reset covers this too. */
export async function clearWelcomeSeen() {
  try {
    await AsyncStorage.removeItem(WELCOME_SEEN_KEY);
  } catch {
    // Same reasoning as above -- a failed reset is a non-event.
  }
}
