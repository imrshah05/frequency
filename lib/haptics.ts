import { Platform } from 'react-native';
import * as ExpoHaptics from 'expo-haptics';

type HapticKind = 'light' | 'medium' | 'selection' | 'success' | 'error';

const SAME_KIND_COOLDOWN_MS = 320;
const GLOBAL_COOLDOWN_MS = 90;

let lastHapticAt = 0;
const lastHapticByKind: Partial<Record<HapticKind, number>> = {};

function canPlay(kind: HapticKind) {
  const now = Date.now();
  const lastForKind = lastHapticByKind[kind] ?? 0;

  if (
    now - lastHapticAt < GLOBAL_COOLDOWN_MS ||
    now - lastForKind < SAME_KIND_COOLDOWN_MS
  ) {
    return false;
  }

  lastHapticAt = now;
  lastHapticByKind[kind] = now;
  return true;
}

async function play(kind: HapticKind, trigger: () => Promise<void>) {
  if (!canPlay(kind)) return;

  try {
    await trigger();
  } catch {
    // Haptics are sensory polish. They should never interrupt the app flow.
  }
}

function android(type: ExpoHaptics.AndroidHaptics) {
  return ExpoHaptics.performAndroidHapticsAsync(type);
}

export function light() {
  return play('light', () =>
    Platform.OS === 'android'
      ? android(ExpoHaptics.AndroidHaptics.Context_Click)
      : ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Light)
  );
}

export function medium() {
  return play('medium', () =>
    Platform.OS === 'android'
      ? android(ExpoHaptics.AndroidHaptics.Gesture_Start)
      : ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Medium)
  );
}

export function selection() {
  return play('selection', () =>
    Platform.OS === 'android'
      ? android(ExpoHaptics.AndroidHaptics.Segment_Tick)
      : ExpoHaptics.selectionAsync()
  );
}

export function success() {
  return play('success', () =>
    Platform.OS === 'android'
      ? android(ExpoHaptics.AndroidHaptics.Confirm)
      : ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Success)
  );
}

export function error() {
  return play('error', () =>
    Platform.OS === 'android'
      ? android(ExpoHaptics.AndroidHaptics.Reject)
      : ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Error)
  );
}
