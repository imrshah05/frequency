// Multi-emotion blend palette, used by the blend picker (app/resonance.tsx).
// Kept separate from constants/resonanceTheme.ts — that file's legacy
// ResonanceMood / ResonanceMoods stay untouched, since the result screen,
// Field, and Calendar still render off the single `mood` column for now.
import type { ResonanceMood } from './resonanceTheme';

export type ResonanceEmotion =
  | 'joy'
  | 'serenity'
  | 'gratitude'
  | 'excitement'
  | 'love'
  | 'sadness'
  | 'anxiety'
  | 'anger'
  | 'gloom'
  | 'longing'
  | 'fatigue';

export type ResonanceEmotionCategory = 'positive' | 'negative';

export type ResonanceEmotionOption = {
  key: ResonanceEmotion;
  label: string;
  color: string;
  category: ResonanceEmotionCategory;
};

// A blend entry: one emotion's share of an entry's overall mood. An entry
// holds 1-3 of these, percentages summing to 100 — enforced in the
// database by resonance_emotions_valid().
export type ResonanceEmotionBlend = {
  emotion: ResonanceEmotion;
  percentage: number;
};

export const ResonanceEmotions: ResonanceEmotionOption[] = [
  { key: 'joy', label: 'Joy', color: '#E3B94E', category: 'positive' },
  { key: 'serenity', label: 'Serenity', color: '#4FA69C', category: 'positive' },
  { key: 'gratitude', label: 'Gratitude', color: '#D97F3D', category: 'positive' },
  { key: 'excitement', label: 'Excitement', color: '#D9488F', category: 'positive' },
  { key: 'love', label: 'Love', color: '#E58FA6', category: 'positive' },

  { key: 'sadness', label: 'Sadness', color: '#4C7FC9', category: 'negative' },
  { key: 'anxiety', label: 'Anxiety', color: '#8A63C4', category: 'negative' },
  { key: 'anger', label: 'Anger', color: '#C2453B', category: 'negative' },
  { key: 'gloom', label: 'Gloom', color: '#6B7680', category: 'negative' },
  { key: 'longing', label: 'Longing', color: '#5B5FA0', category: 'negative' },
  { key: 'fatigue', label: 'Fatigue', color: '#8D9088', category: 'negative' },
];

export function emotionColor(emotion: ResonanceEmotion) {
  return ResonanceEmotions.find((option) => option.key === emotion)?.color ?? '#91A19A';
}

export function emotionLabel(emotion: ResonanceEmotion) {
  return ResonanceEmotions.find((option) => option.key === emotion)?.label ?? emotion;
}

// Highest share first — the order the orb draws its bands in, and the order
// every blend readout in the app should follow.
export function sortBlend(blend: ResonanceEmotionBlend[]) {
  return [...blend].sort((a, b) => b.percentage - a.percentage);
}

// Maps the old single-mood values (constants/resonanceTheme.ts) to their
// closest new-palette equivalent — mirrors the mapping the database
// migration uses to backfill existing rows.
export const LEGACY_MOOD_TO_EMOTION: Record<string, ResonanceEmotion> = {
  joyful: 'joy',
  calm: 'serenity',
  sad: 'sadness',
  anxious: 'anxiety',
  angry: 'anger',
  tired: 'fatigue',
};

// The reverse direction: every new emotion mapped back to its nearest
// legacy mood. Lossy by nature (11 emotions -> 6 moods) — this exists only
// so newly-created blends can still populate the still-not-null `mood`
// column with something plausible, keeping the result screen, Field, and
// Calendar rendering correctly until they're updated to read blends
// directly.
export const EMOTION_TO_LEGACY_MOOD: Record<ResonanceEmotion, ResonanceMood> = {
  joy: 'joyful',
  serenity: 'calm',
  gratitude: 'joyful',
  excitement: 'joyful',
  love: 'joyful',
  sadness: 'sad',
  anxiety: 'anxious',
  anger: 'angry',
  gloom: 'sad',
  longing: 'sad',
  fatigue: 'tired',
};

// Picks the dominant (highest-percentage) emotion in a blend and maps it to
// its nearest legacy mood — see EMOTION_TO_LEGACY_MOOD above.
export function dominantLegacyMoodForBlend(emotions: ResonanceEmotionBlend[]): ResonanceMood {
  const dominant = [...emotions].sort((a, b) => b.percentage - a.percentage)[0];
  return EMOTION_TO_LEGACY_MOOD[dominant.emotion];
}
