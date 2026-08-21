import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { FrequencyColors as C } from '@/constants/frequencyTheme';

// Far fewer bars than the full player waveform. At inbox scale the shape is
// read as a silhouette, not scrubbed -- past about this many bars it stops
// looking like a voice and starts looking like texture.
const BAR_COUNT = 14;

// Used when a thread's last message predates waveform capture, or is a
// shared Echo rather than a recording. Deliberately calm and even so it
// never draws more attention than a real recording's shape.
const FALLBACK_GLYPH = [
  0.3, 0.45, 0.6, 0.4, 0.55, 0.72, 0.5, 0.36, 0.58, 0.44, 0.66, 0.4, 0.5, 0.32,
];

type Props = {
  waveform?: number[] | null;
  tint?: string;
  height?: number;
};

// Peak of each evenly-sized chunk, so a loud moment survives the reduction
// instead of being averaged away into a flat line.
function toGlyphBars(waveform?: number[] | null) {
  if (!waveform || waveform.length === 0) return FALLBACK_GLYPH;

  const chunkSize = waveform.length / BAR_COUNT;

  return Array.from({ length: BAR_COUNT }, (_unused, index) => {
    const chunk = waveform.slice(
      Math.floor(index * chunkSize),
      Math.max(Math.floor((index + 1) * chunkSize), Math.floor(index * chunkSize) + 1)
    );

    return chunk.length > 0 ? Math.max(...chunk) : 0;
  });
}

/**
 * The silhouette of a Whisper's most recent voice note, shown in the inbox
 * row. Its only job is to say "this thread holds a voice" at a glance --
 * an inbox of plain preview text is indistinguishable from a text-messaging
 * app, which Frequency is not.
 */
export default function WhisperWaveGlyph({ waveform, tint = C.faint, height = 18 }: Props) {
  const bars = useMemo(() => toGlyphBars(waveform), [waveform]);

  return (
    <View style={[styles.container, { height }]}>
      {bars.map((amplitude, index) => (
        <View
          key={index}
          style={[
            styles.bar,
            {
              height: 3 + amplitude * (height - 3),
              backgroundColor: tint,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },

  bar: {
    width: 2,
    borderRadius: 999,
  },
});
