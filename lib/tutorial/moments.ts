/**
 * Every tutorial moment's key, in one place.
 *
 * These strings are the `moment_key` column in tutorial_progress, so they are
 * durable data, not labels -- renaming one silently re-shows that moment to
 * everyone who had already seen it. Add new keys; do not repurpose old ones.
 */
export const TUTORIAL_MOMENTS = {
  /**
   * The waveform resolving behind "Find your frequency." on the auth screen.
   *
   * Not stored in tutorial_progress, unlike every other moment here: it plays
   * before anyone has signed in, so there is no auth.uid() to scope a row to
   * and no way to read one under RLS. It is tracked per device instead --
   * see lib/tutorial/welcome.ts. It lives in this list anyway so the full set
   * of moments stays readable in one place.
   */
  welcome: 'welcome',
} as const;

export type TutorialMomentKey = (typeof TUTORIAL_MOMENTS)[keyof typeof TUTORIAL_MOMENTS];
