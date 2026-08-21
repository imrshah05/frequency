// Module-level state, not component state -- it lives for as long as the JS
// engine instance does. Backgrounding/foregrounding an RN app suspends the
// JS context without reloading this module, so this naturally resets only
// on a true cold start (a fresh app launch), with no AppState listener
// needed. Nothing else in the app currently tracks "session" in any form;
// this is intentionally the smallest primitive that satisfies "once per
// app session."
//
// Keyed by user id, not a single flag -- logging out and into a different
// account doesn't restart the JS engine (no cold start happens), so a
// single unscoped flag would leak across accounts: seeing the card as one
// user would silently suppress it for the next person who logs in during
// the same app run.
const suggestionFeedCardShownByUserId = new Set<string>();

export function hasShownSuggestionFeedCardThisSession(userId: string): boolean {
  return suggestionFeedCardShownByUserId.has(userId);
}

export function markSuggestionFeedCardShown(userId: string): void {
  suggestionFeedCardShownByUserId.add(userId);
}
