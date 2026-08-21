import { BlurView } from 'expo-blur';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type ViewStyle,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FrequencyColors as C, FrequencyRadius as R } from '@/constants/frequencyTheme';

/**
 * The app's shared frosted bottom sheet.
 *
 * Same three-layer glass idiom SearchBar established, lifted out so sheets
 * stop each rebuilding it:
 *
 *   1. bloom  -- a soft accent wash rendered *behind* the blur. A blur only
 *                shows what is beneath it, and blurring a flat colour just
 *                returns that colour, so without this the panel collapses
 *                into a plain fill.
 *   2. blur   -- the material itself. No surface colour on top of it, or the
 *                bloom is muted back into a flat card.
 *   3. sheen  -- the specular highlight down the top edge. This is what
 *                separates glass from a translucent panel.
 *
 * Presentation stays `animationType="slide"`, matching every other sheet in
 * the app, rather than inventing a new entrance for one screen.
 */
export default function GlassSheet({
  visible,
  onClose,
  children,
  maxHeight,
  contentStyle,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxHeight?: number;
  contentStyle?: ViewStyle;
}) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  // A sheet must never be taller than the screen. The root is bottom
  // anchored, so an unbounded sheet grows off the *top* -- taking its
  // handle and close button with it -- and covers the backdrop, leaving
  // no way out at all. Callers can tighten this, but never opt out of it.
  const cappedHeight = Math.min(
    maxHeight ?? Number.POSITIVE_INFINITY,
    windowHeight - insets.top - insets.bottom - 24
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />

        <View
          style={[
            styles.sheet,
            {
              maxHeight: cappedHeight,
              marginBottom: Math.max(12, insets.bottom + 8),
            },
          ]}
        >
          <View pointerEvents="none" style={styles.bloom}>
            <View style={styles.bloomAccent} />
            <View style={styles.bloomLight} />
          </View>

          <BlurView
            intensity={44}
            tint="systemThinMaterialDark"
            experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
            style={styles.blur}
          >
            <View style={[styles.content, contentStyle]}>
              <View style={styles.handle} />
              {children}
            </View>

            {/*
              pointerEvents on <Svg> is not honoured -- react-native-svg's root
              view claims every touch in its bounds -- so a plain View is what
              actually opts this layer out, same wrapper SearchBar uses.
            */}
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
                <Defs>
                  <LinearGradient id="sheetSheen" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.12} />
                    <Stop offset="0.34" stopColor="#FFFFFF" stopOpacity={0.03} />
                    <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
                  </LinearGradient>
                </Defs>
                <Rect x="0" y="0" width="100%" height="100%" fill="url(#sheetSheen)" />
              </Svg>
            </View>
          </BlurView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },

  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.52)',
  },

  sheet: {
    marginHorizontal: 12,
    borderRadius: R.xl,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.34,
    shadowRadius: 26,
    elevation: 12,
  },

  bloom: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: R.xl,
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
    borderRadius: R.xl,
    overflow: 'hidden',
    // Without these the sheet's maxHeight is inherited by nothing: the
    // blur lays out at its content's full height and overflows the cap.
    flexShrink: 1,
    borderWidth: 1,
    borderColor: 'rgba(226,237,232,0.09)',
    borderTopColor: 'rgba(226,237,232,0.20)',
  },

  content: {
    paddingHorizontal: 26,
    paddingTop: 14,
    paddingBottom: 26,
    backgroundColor: 'transparent',
    flexShrink: 1,
  },

  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 3,
    backgroundColor: 'rgba(226,237,232,0.24)',
    marginBottom: 20,
  },
});

export const GlassSheetTokens = {
  hairline: 'rgba(226,237,232,0.09)',
  accentHairline: 'rgba(168,205,183,0.20)',
  text: C.text,
};
