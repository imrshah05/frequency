import { supabase } from './supabase';
import type { ResonanceMood } from '@/constants/resonanceTheme';
import {
  LEGACY_MOOD_TO_EMOTION,
  ResonanceEmotions,
  dominantLegacyMoodForBlend,
  emotionLabel,
  sortBlend,
  type ResonanceEmotionBlend,
} from '@/constants/resonanceEmotions';

export type ResonanceEntry = {
  id: string;
  user_id: string;
  entry_date: string;
  mood: ResonanceMood;
  // Populated server-side (see the resonance_backfill_emotions trigger) for
  // every row, old and new, by reinterpreting `mood` as a blend if it
  // wasn't written directly. Typed as nullable since the column itself is,
  // but resolveEntryBlend() below guarantees a usable value regardless.
  emotions: ResonanceEmotionBlend[] | null;
  audio_path: string;
  waveform: number[] | null;
  sticky_note: string | null;
  created_at: string;
};

// The single source of truth for "what blend does this entry represent."
// Prefers the real emotions array; falls back to reinterpreting the legacy
// `mood` (mirrors the DB trigger) for the rare case emotions came back
// null/empty from the client.
export function resolveEntryBlend(
  entry: Pick<ResonanceEntry, 'mood' | 'emotions'>
): ResonanceEmotionBlend[] {
  if (entry.emotions && entry.emotions.length > 0) return entry.emotions;
  return [{ emotion: LEGACY_MOOD_TO_EMOTION[entry.mood], percentage: 100 }];
}

// Names only, no percentages — for places where the weights are already
// visible on screen (the blend picker's pills) and repeating them as text
// would just be noise.
export function formatBlendNames(blend: ResonanceEmotionBlend[]) {
  const labels = blend.map(
    (entry) => ResonanceEmotions.find((option) => option.key === entry.emotion)?.label ?? entry.emotion
  );

  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} & ${labels[labels.length - 1]}`;
}

// A blend said out loud rather than tabulated — "Mostly Joy", "Joy &
// Sadness". Used where the weights are already visible as colour (the
// Resonance Field entry sheet, where the orb itself is the chart) and a
// row of percentages would just be noise in a headline slot.
export function formatBlendHeadline(blend: ResonanceEmotionBlend[]) {
  const [first, second] = sortBlend(blend);
  if (!first) return 'Resonance';
  if (!second || first.percentage >= 55) {
    return second ? `Mostly ${emotionLabel(first.emotion)}` : emotionLabel(first.emotion);
  }
  return `${emotionLabel(first.emotion)} & ${emotionLabel(second.emotion)}`;
}

export function formatBlendSummary(blend: ResonanceEmotionBlend[]) {
  return blend
    .map((entry) => {
      const label = ResonanceEmotions.find((option) => option.key === entry.emotion)?.label ?? entry.emotion;
      return `${label} ${entry.percentage}%`;
    })
    .join(' · ');
}

// Resonance is a once-a-day ritual tied to the user's own calendar day, so
// this deliberately uses local device time rather than UTC.
export function getLocalDateString(date: Date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function fetchTodaysResonance(userId: string): Promise<ResonanceEntry | null> {
  const { data, error } = await supabase
    .from('resonances')
    .select('*')
    .eq('user_id', userId)
    .eq('entry_date', getLocalDateString())
    .maybeSingle();

  if (error) {
    console.warn('[Resonance] Failed to check today\'s entry.', error.message);
    return null;
  }

  return data as ResonanceEntry | null;
}

export function formatResonanceDate(entryDate: string) {
  const [year, month, day] = entryDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);

  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}

export async function fetchAllResonances(userId: string): Promise<ResonanceEntry[]> {
  const { data, error } = await supabase
    .from('resonances')
    .select('*')
    .eq('user_id', userId)
    .order('entry_date', { ascending: false });

  if (error) {
    console.warn('[Resonance] Failed to fetch entries.', error.message);
    return [];
  }

  return (data ?? []) as ResonanceEntry[];
}

const SIGNED_URL_TTL_SECONDS = 60 * 5;

// resonance-audio is a private bucket (unlike Echo's public voice-notes), so
// playback needs a short-lived signed URL rather than a stored public one.
export async function getResonanceAudioUrl(audioPath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('resonance-audio')
    .createSignedUrl(audioPath, SIGNED_URL_TTL_SECONDS);

  if (error) {
    console.warn('[Resonance] Failed to sign audio URL.', error.message);
    return null;
  }

  return data.signedUrl;
}

export async function createResonance(params: {
  userId: string;
  emotions: ResonanceEmotionBlend[];
  audioPath: string;
  waveform: number[] | null;
  stickyNote: string | null;
}) {
  const { data, error } = await supabase
    .from('resonances')
    .insert({
      user_id: params.userId,
      entry_date: getLocalDateString(),
      // `mood` stays required for now — derived from the blend's dominant
      // emotion purely so the result screen, Field, and Calendar (which
      // still render off `mood`) keep working until they read blends
      // directly. `emotions` is the real data going forward.
      mood: dominantLegacyMoodForBlend(params.emotions),
      emotions: params.emotions,
      audio_path: params.audioPath,
      waveform: params.waveform,
      sticky_note: params.stickyNote,
    })
    .select('id')
    .single();

  if (error) throw error;

  return data;
}
