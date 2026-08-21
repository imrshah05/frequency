import { BlurView } from 'expo-blur';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { FrequencyColors as C, FrequencyRadius as R, FrequencySpacing as S } from '@/constants/frequencyTheme';

type SearchBarProps = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
};

/**
 * The search field is a frosted material rather than a flat surface fill --
 * same BlurView + translucent "glass" layer idiom the Whisper reply preview
 * already uses, so it reads as one system.
 *
 * Three layers, in hierarchy order, because a blur only ever shows what is
 * beneath it:
 *
 *   1. bloom   -- a soft accent wash rendered *before* the blur, so it sits
 *                 behind it. Search sits on the flat app background, and
 *                 blurring a flat colour just returns that colour; without
 *                 this the glass has nothing to refract and collapses into a
 *                 plain fill. The blur is what softens the blobs, so they can
 *                 be crude shapes.
 *   2. sheen   -- the specular highlight down the top edge. This is what
 *                 separates glass from a translucent panel; the 1px lighter
 *                 top border alone reads as a stroke, not as light.
 *   3. ring    -- focus state, a sibling *above* the blur rather than a
 *                 border on it, because the blur needs overflow: 'hidden' to
 *                 keep its corners.
 */
export default function SearchBar({
  value,
  onChangeText,
  placeholder = 'Search by username...',
}: SearchBarProps) {
  const focus = useSharedValue(0);

  const focusRingStyle = useAnimatedStyle(() => ({
    opacity: focus.value,
  }));

  // The bloom lifts slightly on focus, so the material brightens from within
  // instead of the ring simply switching on.
  const bloomStyle = useAnimatedStyle(() => ({
    opacity: 0.75 + focus.value * 0.25,
  }));

  return (
    <View style={styles.wrap}>
      <Animated.View pointerEvents="none" style={[styles.bloom, bloomStyle]}>
        <View style={styles.bloomAccent} />
        <View style={styles.bloomLight} />
      </Animated.View>

      <BlurView
        intensity={44}
        tint="systemThinMaterialDark"
        experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
        style={styles.blur}
      >
        <View style={styles.glass}>
          <Text style={styles.searchGlyph}>@</Text>
          <TextInput
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={C.faint}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            selectionColor={C.accent}
            onFocus={() => {
              focus.value = withTiming(1, { duration: 220 });
            }}
            onBlur={() => {
              focus.value = withTiming(0, { duration: 220 });
            }}
            style={styles.input}
          />
        </View>

        {/*
          The sheen covers the whole field, so it sits on top of the input --
          and pointerEvents on <Svg> itself is not honoured: react-native-svg's
          root view overrides hitTest and claims every touch inside its bounds.
          A plain View is what actually opts the layer out of touch handling,
          same wrapper the Whispers header glow uses.
        */}
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
            <Defs>
              <LinearGradient id="searchSheen" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.13} />
                <Stop offset="0.42" stopColor="#FFFFFF" stopOpacity={0.03} />
                <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#searchSheen)" />
          </Svg>
        </View>
      </BlurView>

      <Animated.View pointerEvents="none" style={[styles.focusRing, focusRingStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: R.lg,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.26,
    shadowRadius: 18,
    elevation: 8,
  },

  // Clipped to the field's own radius so the blobs cannot bleed past the
  // corners before the blur reaches them.
  bloom: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: R.lg,
    overflow: 'hidden',
  },

  bloomAccent: {
    position: 'absolute',
    left: -30,
    top: -34,
    width: 190,
    height: 130,
    borderRadius: 95,
    backgroundColor: 'rgba(107,168,130,0.17)',
  },

  bloomLight: {
    position: 'absolute',
    right: -46,
    bottom: -40,
    width: 210,
    height: 140,
    borderRadius: 105,
    backgroundColor: 'rgba(226,237,232,0.07)',
  },

  blur: {
    borderRadius: R.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(226,237,232,0.10)',
    borderTopColor: 'rgba(226,237,232,0.22)',
  },

  // No fill at all: the field is the blur material itself. Body comes from
  // the tint the BlurView already applies, so a surface colour on top would
  // only mute the bloom back into a flat pill.
  glass: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    paddingHorizontal: 20,
    height: 64,
    backgroundColor: 'transparent',
  },

  focusRing: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: 'rgba(107,168,130,0.42)',
  },

  searchGlyph: {
    color: C.accentSoft,
    fontSize: 22,
    fontWeight: '800',
  },

  input: {
    flex: 1,
    color: C.text,
    fontSize: 18,
    fontWeight: '600',
    paddingVertical: 0,
  },
});
