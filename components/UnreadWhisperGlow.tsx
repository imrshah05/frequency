import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { FrequencyColors as C } from '@/constants/frequencyTheme';

type Props = {
  width: number;
  height: number;
};

let instanceCounter = 0;

/**
 * A soft wash of Frequency green behind an unread Whisper row. Same glow
 * language the feed uses for a playing Echo, flattened into a wide ellipse
 * so it reads as a band of warmth across the row rather than a circle
 * drawn behind it.
 *
 * Centred over the avatar rather than the row's midpoint, so the glow
 * appears to come from the person who sent it and fades out toward the
 * timestamp.
 */
export default function UnreadWhisperGlow({ width, height }: Props) {
  // Unique per mount -- many rows can be glowing at once, and SVG def ids
  // are document-global.
  const gradientId = useRef(`unread-whisper-glow-${instanceCounter++}`).current;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.layer]}>
      <Svg width={width} height={height}>
        <Defs>
          <RadialGradient id={gradientId} cx="22%" cy="50%" rx="62%" ry="52%">
            <Stop offset="0%" stopColor={C.accent} stopOpacity={0.13} />
            <Stop offset="45%" stopColor={C.accent} stopOpacity={0.05} />
            <Stop offset="100%" stopColor={C.accent} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width={width} height={height} fill={`url(#${gradientId})`} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
});
