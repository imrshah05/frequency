export const ECHO_LIVE_DURATION_MS = 24 * 60 * 60 * 1000;

export function echoExpiresAt(createdAt: string) {
  return new Date(new Date(createdAt).getTime() + ECHO_LIVE_DURATION_MS);
}

export function echoExpiresAtIso(createdAt: string) {
  return echoExpiresAt(createdAt).toISOString();
}

export function liveEchoCutoffIso(now = Date.now()) {
  return new Date(now - ECHO_LIVE_DURATION_MS).toISOString();
}

export function isEchoLive(createdAt: string, now = Date.now()) {
  return echoExpiresAt(createdAt).getTime() > now;
}

export function formatRemainingLiveDuration(createdAt: string, now = Date.now()) {
  const remainingMs = Math.max(0, echoExpiresAt(createdAt).getTime() - now);
  const totalMinutes = Math.ceil(remainingMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) return `${Math.max(1, minutes)}m left`;
  if (minutes === 0) return `${hours}h left`;
  return `${hours}h ${minutes}m left`;
}
