import { BlurView } from 'expo-blur';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { FrequencyRadius as R } from '@/constants/frequencyTheme';

/**
 * The app's frosted material, without a sheet around it.
 *
 * GlassSheet owns the same three layers but is a bottom-anchored `Modal` with
 * its own backdrop, which makes it the wrong shape for anything that has to
 * sit at a particular place on screen. EchoImpactReveal hit that first and
 * rebuilt the material inline; this is that material lifted out so the next
 * one does not have to.
 *
 * The three layers, in hierarchy order, because a blur only ever shows what
 * is beneath it:
 *
 *   1. bloom  -- a soft accent wash rendered *behind* the blur. Blurring a
 *                flat colour just returns that colour, so without this the
 *                panel collapses into a plain card.
 *   2. blur   -- the material itself. No surface colour on top of it, or the
 *                bloom is muted back into a flat fill.
 *   3. sheen  -- the specular highlight down the top edge. This is what
 *                separates glass from a translucent panel.
 *
 * GlassSheet and EchoImpactReveal still carry their own copies. Moving them
 * onto this is a worthwhile follow-up, but it touches live screens, so it is
 * deliberately not bundled into the change that introduced this file.
 */
export default function GlassPanel({
  children,
  style,
  contentStyle,
  radius = R.lg,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  radius?: number;
}) {
  return (
    <View style={[styles.root, { borderRadius: radius }, style]}>
      <View pointerEvents="none" style={[styles.bloom, { borderRadius: radius }]}>
        <View style={styles.bloomAccent} />
        <View style={styles.bloomLight} />
      </View>

      <BlurView
        intensity={44}
        tint="systemThinMaterialDark"
        experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
        style={[styles.blur, { borderRadius: radius }]}
      >
        <View style={[styles.content, contentStyle]}>{children}</View>

        {/*
          pointerEvents on <Svg> is not honoured -- react-native-svg's root
          view claims every touch in its bounds -- so a plain View is what
          actually opts this layer out. Same wrapper GlassSheet uses.
        */}
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
            <Defs>
              <LinearGradient id="glassPanelSheen" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.12} />
                <Stop offset="0.34" stopColor="#FFFFFF" stopOpacity={0.03} />
                <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#glassPanelSheen)" />
          </Svg>
        </View>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.34,
    shadowRadius: 26,
    elevation: 12,
  },

  bloom: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },

  bloomAccent: {
    position: 'absolute',
    left: -40,
    top: -60,
    width: 300,
    height: 220,
    borderRadius: 150,
    backgroundColor: 'rgba(107,168,130,0.16)',
  },

  bloomLight: {
    position: 'absolute',
    right: -70,
    bottom: -80,
    width: 320,
    height: 240,
    borderRadius: 160,
    backgroundColor: 'rgba(226,237,232,0.05)',
  },

  blur: {
    overflow: 'hidden',
    flexShrink: 1,
    borderWidth: 1,
    borderColor: 'rgba(226,237,232,0.09)',
    borderTopColor: 'rgba(226,237,232,0.20)',
  },

  content: {
    paddingHorizontal: 22,
    paddingVertical: 20,
    backgroundColor: 'transparent',
    flexShrink: 1,
  },
});
