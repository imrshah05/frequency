import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FrequencyLogo } from '@/components/branding/FrequencyLogo';
import Touchable from '@/components/Touchable';
import { FrequencyColors as C, FrequencyRadius as R } from '@/constants/frequencyTheme';
import { success } from '@/lib/haptics';

/**
 * The first thing anyone sees. Once, ever.
 *
 * Deliberately the same shape as the Echo Impact reveal's opening beat --
 * true black, the mark breathing behind an accent halo, one line of
 * product and one button -- because those are the only two moments in
 * Frequency that take over the whole app, and they should read as the same
 * kind of thing happening.
 *
 * Nothing is taught here. It is a greeting, not step one of a tutorial:
 * the contextual moments explain each screen when the person actually
 * reaches it.
 */
export default function TutorialWelcome({ onDismiss }: { onDismiss: () => void }) {
  const insets = useSafeAreaInsets();

  // React Native's own Animated, not Reanimated.
  //
  // This whole screen renders inside a <Modal>, and Reanimated's animated
  // styles do not drive views in a modal's separate native hierarchy --
  // they hold their initial value. That is what made the first version of
  // this screen a black rectangle: the copy and the Begin button both
  // entered from opacity 0 and never left it, leaving nothing to tap.
  // See the note in SpotlightOverlay for the full account.
  const breath = useRef(new Animated.Value(0)).current;
  const copyEntrance = useRef(new Animated.Value(0)).current;
  const footerEntrance = useRef(new Animated.Value(0)).current;

  // The same slow breath as the reveal -- four seconds each way, shallow
  // range, so it reads as something alive rather than an animation asking
  // to be watched.
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration: 4200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 0,
          duration: 4200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    loop.start();
    return () => loop.stop();
  }, [breath]);

  useEffect(() => {
    const entrance = Animated.stagger(160, [
      Animated.timing(copyEntrance, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(footerEntrance, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);

    entrance.start();
    return () => entrance.stop();
  }, [copyEntrance, footerEntrance]);

  const haloStyle = {
    opacity: breath.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.44] }),
    transform: [
      { scale: breath.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.06] }) },
    ],
  };

  function entranceStyle(value: Animated.Value) {
    return {
      opacity: value,
      transform: [
        { translateY: value.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
      ],
    };
  }

  function begin() {
    void success();
    onDismiss();
  }

  return (
    <View style={styles.screen}>
      {/*
        The desaturated sage wash, well under the mark. Same two blooms the
        reveal and GlassSheet use -- no brighter green anywhere, the accent
        only ever arrives as low-opacity light.
      */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={styles.bloomAccent} />
        <View style={styles.bloomLight} />
      </View>

      <View
        style={[
          styles.content,
          { paddingTop: insets.top + 96, paddingBottom: insets.bottom + 44 },
        ]}
      >
        <View style={styles.mark}>
          <Animated.View style={[styles.halo, haloStyle]} />
          <FrequencyLogo size={82} opacity={0.9} />
        </View>

        <Animated.View style={[styles.copy, entranceStyle(copyEntrance)]}>
          <Text style={styles.headline}>Welcome to{'\n'}Frequency.</Text>
          <Text style={styles.line}>Some thoughts are better spoken.</Text>
        </Animated.View>

        <Animated.View style={[styles.footer, entranceStyle(footerEntrance)]}>
          <Touchable style={styles.button} activeOpacity={0.86} onPress={begin}>
            <Text style={styles.buttonText}>Begin</Text>
          </Touchable>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // True black rather than the app's #111614 surface, matching the Echo
  // Impact reveal: the two screens that take over the app are the two that
  // step off it.
  screen: {
    flex: 1,
    backgroundColor: '#000000',
  },

  bloomAccent: {
    position: 'absolute',
    left: -90,
    top: -40,
    width: 420,
    height: 420,
    borderRadius: 210,
    backgroundColor: 'rgba(107,168,130,0.13)',
  },

  bloomLight: {
    position: 'absolute',
    right: -120,
    bottom: -110,
    width: 420,
    height: 380,
    borderRadius: 200,
    backgroundColor: 'rgba(226,237,232,0.045)',
  },

  content: {
    flex: 1,
    paddingHorizontal: 34,
    justifyContent: 'space-between',
  },

  mark: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  halo: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(107,168,130,0.22)',
  },

  copy: {
    gap: 16,
  },

  // The app's full-screen header scale, 44/800/-1.2.
  headline: {
    color: C.text,
    fontSize: 44,
    fontWeight: '800',
    lineHeight: 49,
    letterSpacing: -1.2,
  },

  line: {
    color: C.accentSoft,
    fontSize: 18,
    lineHeight: 26,
  },

  footer: {
    alignItems: 'center',
  },

  button: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.accent,
    borderRadius: R.md,
    paddingVertical: 17,
  },

  buttonText: {
    color: '#0B100D',
    fontSize: 17,
    fontWeight: '700',
  },
});
