import { useRef } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

type Props = {
  color: string;
  size: number;
};

let instanceCounter = 0;

// A soft radial wash of an entry's dominant emotion, sitting behind the orb
// so the surface reads as lit by the mood rather than decorated with it.
// Fades fully to transparent at the edges, so it never shows a square seam
// against a rounded sheet.
export default function ResonanceHalo({ color, size }: Props) {
  // Unique per mount — several halos can be alive at once during a modal
  // transition, and SVG def ids are document-global.
  const gradientId = useRef(`resonance-halo-${instanceCounter++}`).current;

  return (
    <Svg width={size} height={size} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <RadialGradient id={gradientId} cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor={color} stopOpacity={0.26} />
          <Stop offset="52%" stopColor={color} stopOpacity={0.08} />
          <Stop offset="100%" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect width={size} height={size} fill={`url(#${gradientId})`} />
    </Svg>
  );
}
