import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { FrequencyColors as C } from '@/constants/frequencyTheme';

type Props = {
  size?: number;
  style?: StyleProp<ViewStyle>;
};

// The familiar "someone wants to follow you" pin badge, tailored to
// Frequency: accent-green body instead of red, with the person glyph cut
// out in the same near-black used for icons on every other filled-green
// button in the app (the record button's play glyph, etc.), so it reads as
// the same family of controls rather than a borrowed icon. The tail points
// up so it hangs off the bottom of whatever it's pinned to, with the body
// and person glyph sitting below it, upright.
export default function TuneInRequestBadge({ size = 20, style }: Props) {
  const height = size * 1.3;

  return (
    <View style={[styles.shadow, { width: size, height }, style]}>
      <Svg width={size} height={height} viewBox="0 0 20 26">
        <Path d="M7,11 L13,11 L10,2 Z" fill={C.accent} />
        <Rect x={1} y={10} width={18} height={15} rx={6} fill={C.accent} />
        <Circle cx={10} cy={16.2} r={2.6} fill="#0B100D" />
        <Path d="M5.2,23 C5.2,19.4 7.3,18 10,18 C12.7,18 14.8,19.4 14.8,23 Z" fill="#0B100D" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    shadowColor: C.accent,
    shadowOpacity: 0.5,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
});
