import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { FrequencyColors as C } from '@/constants/frequencyTheme';

type Props = {
  size?: number;
  style?: StyleProp<ViewStyle>;
};

// Same pin shape as TuneInRequestBadge -- tail pointing up, body hanging
// below it, accent-green fill -- reused for "someone liked your Echo" with
// a filled heart glyph in place of the person silhouette, cut out in the
// same near-black. Same family of badge, different notification type.
export default function EchoLikeBadge({ size = 20, style }: Props) {
  const height = size * 1.3;

  return (
    <View style={[styles.shadow, { width: size, height }, style]}>
      <Svg width={size} height={height} viewBox="0 0 20 26">
        <Path d="M7,11 L13,11 L10,2 Z" fill={C.accent} />
        <Rect x={1} y={10} width={18} height={15} rx={6} fill={C.accent} />
        <Path
          d="M10,15.2 C10,13 7,12 5.3,14 C3.6,16 4.2,18.4 6.5,20.3 L10,23.3 L13.5,20.3 C15.8,18.4 16.4,16 14.7,14 C13,12 10,13 10,15.2 Z"
          fill="#0B100D"
        />
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
