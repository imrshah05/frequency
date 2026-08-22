import { supabase } from './supabase';

/**
 * Signed playback URLs for the private `voice-notes` bucket.
 *
 * The bucket holds Echoes, 1:1 Whisper audio and Group Whisper audio. It
 * used to be public, which meant every file in it -- including archived
 * Echoes and recordings nobody ever posted -- was downloadable with no
 * session at all. Rows now store `audio_path` and playback mints a
 * short-lived signed URL from it.
 *
 * Three moving parts, in the order they matter:
 *
 *   prefetchAudioUrls()  one batch signing call per screen load, so
 *                        pressing play is instant rather than paying a
 *                        round trip per tap.
 *   getAudioUrl()        cache hit in the normal case.
 *   withAudioUrl()       runs playback and, if the URL turns out to be
 *                        dead, re-signs that one path and retries once.
 *
 * The retry is the part that matters on mobile. A signed URL outlives a
 * screen but not a backgrounded app, so without it someone who leaves
 * Frequency open overnight comes back to playback that fails silently --
 * the hardest kind of bug to report.
 */

const BUCKET = 'voice-notes';

// 24 hours. Chosen to match an Echo's own live run: a URL signed when the
// feed loads stays good for as long as the Echo it points at is live.
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24;

// Re-sign slightly before true expiry so a URL handed out at the edge of
// the window is not already dead by the time playback starts.
const EXPIRY_SAFETY_MARGIN_MS = 60 * 1000;

type CacheEntry = { url: string; expiresAt: number };

const cache = new Map<string, CacheEntry>();

function isFresh(entry: CacheEntry | undefined): entry is CacheEntry {
  return !!entry && entry.expiresAt - EXPIRY_SAFETY_MARGIN_MS > Date.now();
}

function remember(path: string, url: string) {
  cache.set(path, { url, expiresAt: Date.now() + SIGNED_URL_TTL_SECONDS * 1000 });
}

/**
 * Signs many paths in one request. Call this when a screen's rows land,
 * not when someone presses play.
 *
 * Never throws: a screen that cannot sign should still render, with
 * playback failing per item rather than the whole list refusing to load.
 */
export async function prefetchAudioUrls(paths: (string | null | undefined)[]): Promise<void> {
  const wanted = [...new Set(paths.filter((p): p is string => !!p))].filter(
    (path) => !isFresh(cache.get(path))
  );

  if (wanted.length === 0) return;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(wanted, SIGNED_URL_TTL_SECONDS);

  if (error) {
    console.warn('[Audio] Batch signing failed.', error.message);
    return;
  }

  (data ?? []).forEach((row) => {
    if (row.signedUrl && !row.error) remember(row.path ?? '', row.signedUrl);
  });
}

/**
 * Returns a playable URL for one path, signing it if the cache has
 * nothing fresh. Returns null when signing is refused -- which is the
 * correct answer for an Echo whose run has ended, not an error.
 */
export async function getAudioUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;

  const cached = cache.get(path);
  if (isFresh(cached)) return cached.url;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    console.warn('[Audio] Could not sign audio path.', error?.message);
    return null;
  }

  remember(path, data.signedUrl);
  return data.signedUrl;
}

/** Drops a path so the next read re-signs it. */
export function invalidateAudioUrl(path: string) {
  cache.delete(path);
}

/**
 * Runs a playback attempt against a freshly resolved URL and retries once
 * with a new signature if the first attempt fails.
 *
 * Deliberately generic over the playback call rather than wrapping
 * expo-av: the six playback sites build their Sound objects differently
 * (initial status, progress callbacks, seek position), and the thing
 * worth having in one place is the retry rule, not the player setup.
 */
export async function withAudioUrl<T>(
  path: string | null | undefined,
  run: (uri: string) => Promise<T>
): Promise<T | null> {
  const url = await getAudioUrl(path);
  if (!url || !path) return null;

  try {
    return await run(url);
  } catch (error) {
    // Could be an expired signature or a genuinely broken file. Re-signing
    // is cheap and settles which, so it is worth one attempt either way.
    invalidateAudioUrl(path);
    const refreshed = await getAudioUrl(path);
    if (!refreshed) return null;

    try {
      return await run(refreshed);
    } catch (retryError) {
      console.warn('[Audio] Playback failed after re-signing.', retryError);
      return null;
    }
  }
}
