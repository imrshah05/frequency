export const FrequencyColors = {
  background: '#111614',
  surface: '#151B18',
  card: '#1A221D',
  elevated: '#202A24',

  accent: '#6BA882',
  accentSoft: '#A8CDB7',
  logoSage: '#6F9A78',
  logoSageDeep: '#173B28',

  text: '#E2EDE8',
  muted: '#91A19A',
  faint: '#5F6F68',

  divider: '#2A322E',
  danger: '#D96B6B',
};

/**
 * The two sides of a Whisper thread.
 *
 * A voice note carries no text, so the bubble is the only thing on screen
 * saying who spoke — which means the two sides have to differ by more than
 * a few percent of opacity, the way a message app's own colour does the
 * work before you read a word.
 *
 * Yours takes the brand green as a fill; theirs stays neutral. Anything
 * inside a bubble has to flip with it, since green controls on a green
 * fill disappear.
 */
export const FrequencyBubble = {
  mine: {
    background: '#2C6046',
    border: 'rgba(168,205,183,0.32)',
    control: '#EDF8E9',
    wave: '#EDF8E9',
    wavePlayed: '#FFFFFF',
  },

  theirs: {
    background: '#1A221D',
    border: '#2A322E',
    control: '#A8CDB7',
    wave: '#6BA882',
    wavePlayed: '#A8CDB7',
  },
};

export const FrequencySpacing = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const FrequencyRadius = {
  sm: 12,
  md: 18,
  lg: 26,
  xl: 36,
};

/**
 * Press feedback timing, in milliseconds.
 *
 * React Native's TouchableOpacity hardcodes these internally — 150ms to dim,
 * 250ms to fade back — with no prop to change them. That release fade is why
 * taps read as a beat behind the finger across the whole app. `Touchable`
 * uses the values below instead: the dim effectively lands on contact, and
 * the release is quick but still eased, so it reads immediate rather than
 * snappy or cartoonish.
 */
export const FrequencyMotion = {
  pressIn: 40,
  pressOut: 130,
};
