export type ResonanceMood = 'joyful' | 'calm' | 'sad' | 'anxious' | 'angry' | 'tired';

export type ResonanceMoodOption = {
  key: ResonanceMood;
  label: string;
  color: string;
};

// Desaturated, dark-palette-friendly tones for each mood — chosen to sit
// quietly alongside FrequencyColors rather than read as bright/neon.
export const ResonanceMoods: ResonanceMoodOption[] = [
  { key: 'joyful', label: 'Joyful', color: '#D9B65C' },
  { key: 'calm', label: 'Calm', color: '#4FA69C' },
  { key: 'sad', label: 'Sad', color: '#5C82B8' },
  { key: 'anxious', label: 'Anxious', color: '#8A79BE' },
  { key: 'angry', label: 'Angry', color: '#C06A63' },
  { key: 'tired', label: 'Tired', color: '#8A9490' },
];
