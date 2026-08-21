import { View, StyleSheet } from 'react-native';
import { FrequencyColors as C } from '@/constants/frequencyTheme';
import { getFallbackWaveform } from '@/lib/waveform';
import { useWaveformScrub } from '@/hooks/useWaveformScrub';

type Props = {
  active?: boolean;
  progress?: number;
  waveform?: number[] | null;
  onSeek?: (fraction: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
  // Colour of the played portion. Defaults to Frequency green; the Resonance
  // Field entry sheet passes the entry's dominant emotion instead, so the
  // recording is heard in the same colour the orb is seen in.
  tint?: string;
  // Overall height of the waveform. Bar heights scale with it, so the same
  // recording reads identically at any size.
  height?: number;
  gap?: number;
  // Bars normally sit at a fixed width and centre themselves, overflowing a
  // narrow container. `fill` instead divides the container's width evenly
  // between them, so the whole recording is always visible end to end. The
  // feed uses this; every other surface keeps the fixed-width default.
  fill?: boolean;
};

export default function FrequencyWaveform({
  active = false,
  progress = 0,
  waveform,
  onSeek,
  onScrubStart,
  onScrubEnd,
  tint = C.accent,
  height = 90,
  gap = 4,
  fill = false,
}: Props) {
  const bars = waveform && waveform.length > 0 ? waveform : getFallbackWaveform();
  const playedIndex = Math.floor(Math.max(0, Math.min(1, progress)) * bars.length);

  const { containerRef, onLayout, panHandlers } = useWaveformScrub(onSeek, onScrubStart, onScrubEnd);

  return (
    <View
      ref={containerRef}
      style={[styles.container, { height, gap }]}
      onLayout={onLayout}
      {...panHandlers}
    >
      {bars.map((amplitude, index) => {
        const isPlayed = active && index <= playedIndex;

        return (
          <View
            key={index}
            style={[
              styles.bar,
              fill ? styles.fillBar : styles.fixedBar,
              {
                height: 12 + amplitude * (height - 22),
                backgroundColor: isPlayed ? tint : C.muted,
                opacity: active ? (isPlayed ? 1 : 0.42) : 0.68,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },

  bar: {
    borderRadius: 999,
  },

  fixedBar: {
    width: 4,
  },

  fillBar: {
    flex: 1,
  },
});
