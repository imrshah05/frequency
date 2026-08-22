import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FrequencyLogo } from '@/components/branding/FrequencyLogo';
import SpringIn from '@/components/SpringIn';
import Touchable from '@/components/Touchable';
import ResolvingWaveform, { WELCOME_RESOLVE_MS } from '@/components/tutorial/ResolvingWaveform';
import { FrequencyColors as C, FrequencyRadius as R } from '@/constants/frequencyTheme';

/**
 * The first thing anyone sees, once ever.
 *
 * The brief was "creative and eye-catching", which in this app cannot mean
 * busy. The design bible rules out bounce, restless motion and anything
 * playful, and reserves full-screen takeovers for the Echo Impact reveal. So
 * this earns its screen the same way that one does: true black, one idea, and
 * motion that reads as physical rather than decorative.
 *
 * THE IDEA IS A SIGNAL ARRIVING IN A DARK ROOM -- which is the metaphor the
 * app is named after, already used by the Feed's suggestion card. Nothing here
 * is a new visual language:
 *
 *   1. rings   -- three fronts expanding out of the centre and dissolving,
 *                 once. Not a loop; a loop would be a beacon, and a beacon is
 *                 restless.
 *   2. mark    -- the logo, behind a halo that breathes on the same slow
 *                 four-second cycle the Echo Impact reveal uses, so it reads
 *                 as something alive in the room rather than an animation
 *                 asking to be watched.
 *   3. waveform-- the auth screen's own bars, resolving out of grey static
 *                 into sage. Reused wholesale rather than reinvented, so the
 *                 welcome and the screen behind it are visibly one thing.
 *   4. words   -- last, and only after the picture has finished saying it.
 *
 * The whole sequence is under two seconds to the button. A welcome that has to
 * be waited out is a splash screen.
 */
const RING_COUNT = 3;
const RING_MAX = 460;

/** One expanding front. Fires once, staggered behind the one before it. */
function SignalRing({ index, size }: { index: number; size: number }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      60 + index * 220,
      withTiming(1, { duration: 1900, easing: Easing.out(Easing.cubic) })
    );
  }, [progress, index]);

  const style = useAnimatedStyle(() => ({
    opacity: (1 - progress.value) * 0.34,
    transform: [{ scale: 0.24 + progress.value * 1.15 }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        { width: size, height: size, borderRadius: size / 2 },
        style,
      ]}
    />
  );
}

export default function WelcomeToFrequency({ onBegin }: { onBegin: () => void }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [leaving, setLeaving] = useState(false);

  const ringSize = Math.min(RING_MAX, width * 1.05);
  const haloSize = ringSize * 0.78;

  const breath = useSharedValue(0);
  const markPresence = useSharedValue(0);
  const exit = useSharedValue(0);

  useEffect(() => {
    markPresence.value = withDelay(
      200,
      withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) })
    );

    // Same four-second cycle and shallow range as the Echo Impact reveal.
    breath.value = withRepeat(
      withTiming(1, { duration: 4200, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
  }, [breath, markPresence]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: markPresence.value * (0.18 + breath.value * 0.22),
    transform: [{ scale: 0.92 + breath.value * 0.14 }],
  }));

  const markStyle = useAnimatedStyle(() => ({
    opacity: markPresence.value,
    // Settles forward out of the dark rather than fading flat onto it.
    transform: [{ scale: 0.88 + markPresence.value * 0.12 }],
  }));

  const rootStyle = useAnimatedStyle(() => ({ opacity: 1 - exit.value }));

  function handleBegin() {
    if (leaving) return;
    setLeaving(true);

    // Hands over to the auth screen underneath by dissolving, so the waveform
    // that just resolved is still there when this clears -- one continuous
    // screen rather than a cut.
    exit.value = withTiming(1, { duration: 420, easing: Easing.inOut(Easing.quad) });
    setTimeout(onBegin, 380);
  }

  return (
    <Animated.View style={[styles.screen, rootStyle]}>
      <View style={[styles.stage, { paddingTop: insets.top }]}>
        {Array.from({ length: RING_COUNT }).map((_, index) => (
          <SignalRing key={index} index={index} size={ringSize} />
        ))}

        {/*
          A radial gradient, not a translucent circle. A flat fill on true
          black has a hard edge and reads as a grey plate behind the mark;
          only a falloff reads as light.
        */}
        <Animated.View
          pointerEvents="none"
          style={[styles.halo, { width: haloSize, height: haloSize }, haloStyle]}
        >
          <Svg width={haloSize} height={haloSize}>
            <Defs>
              <RadialGradient id="welcomeHalo" cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor={C.accent} stopOpacity={0.5} />
                <Stop offset="0.45" stopColor={C.accent} stopOpacity={0.16} />
                <Stop offset="1" stopColor={C.accent} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx={haloSize / 2} cy={haloSize / 2} r={haloSize / 2} fill="url(#welcomeHalo)" />
          </Svg>
        </Animated.View>

        <Animated.View style={markStyle}>
          <FrequencyLogo size={96} />
        </Animated.View>
      </View>

      <ResolvingWaveform resolving style={styles.wave} restOpacity={0.2} />

      <View style={[styles.copy, { paddingBottom: insets.bottom + 36 }]}>
        <SpringIn delay={WELCOME_RESOLVE_MS * 0.55}>
          <Text style={styles.eyebrow}>Welcome to</Text>
          <Text style={styles.title}>Frequency</Text>
        </SpringIn>

        <SpringIn delay={WELCOME_RESOLVE_MS * 0.72}>
          <Text style={styles.subtitle}>Some thoughts are better spoken.</Text>
        </SpringIn>

        <SpringIn delay={WELCOME_RESOLVE_MS * 0.95} style={styles.footer}>
          <Touchable style={styles.button} activeOpacity={0.86} onPress={handleBegin}>
            <Text style={styles.buttonText}>Begin</Text>
          </Touchable>
        </SpringIn>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // True black rather than the app's #111614, matching the Echo Impact
  // reveal: the one other place Frequency steps out of its own way.
  screen: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    zIndex: 10,
    elevation: 10,
  },

  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  ring: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: C.accent,
  },

  halo: {
    position: 'absolute',
  },

  // Positioned against the screen, not the centring stage -- inside the stage
  // its offset depended on however much room the copy left, and it landed
  // across the glyph. It sits below the mark so the bars read as the voice
  // coming off it, and it fills what was otherwise a dead band between the
  // mark and the copy. The rotate is repeated because overriding `transform`
  // replaces the whole array.
  wave: {
    top: '44%',
    transform: [{ rotate: '-3deg' }],
  },

  copy: {
    paddingHorizontal: 34,
    gap: 14,
  },

  eyebrow: {
    color: C.muted,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 6,
  },

  // The app's full-screen header scale: 44/800/-1.2.
  title: {
    color: C.text,
    fontSize: 44,
    fontWeight: '800',
    letterSpacing: -1.2,
  },

  subtitle: {
    color: C.accentSoft,
    fontSize: 18,
    lineHeight: 26,
  },

  footer: {
    marginTop: 18,
  },

  button: {
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
