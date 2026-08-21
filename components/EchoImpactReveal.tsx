import { BlurView } from 'expo-blur';
import { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FrequencyLogo } from '@/components/branding/FrequencyLogo';
import EchoImpactStory, { EchoImpactHeading } from '@/components/EchoImpactStory';
import SpringIn from '@/components/SpringIn';
import Touchable from '@/components/Touchable';
import { FrequencyColors as C, FrequencyRadius as R } from '@/constants/frequencyTheme';
import type { PendingEchoReveal } from '@/lib/echoImpactReveal';

/**
 * One Echo's reveal: the moment its creator is first shown what its 24
 * hours were.
 *
 * Two beats, on purpose. The first is an invitation on true black -- the
 * Echo is named, nothing is measured, and the only thing to do is decide
 * to look. The second is the Impact itself, on the app's frosted glass.
 * Landing straight on the story would make this a notification; the pause
 * is what makes it a moment.
 *
 * The component knows nothing about queues or persistence. It renders one
 * Echo and calls onDismiss when the person is finished with it, whether
 * they read to the end or closed it early. EchoImpactRevealHost owns what
 * happens next.
 */
export default function EchoImpactReveal({
  reveal,
  position,
  total,
  onDismiss,
}: {
  reveal: PendingEchoReveal;
  position: number;
  total: number;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<'invitation' | 'story'>('invitation');

  // A slow breath behind the mark. Four seconds each way and a shallow
  // range, so it reads as something alive in the room rather than an
  // animation asking to be watched.
  const breath = useSharedValue(0);

  useEffect(() => {
    breath.value = withRepeat(
      withTiming(1, { duration: 4200, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
  }, [breath]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.2 + breath.value * 0.24,
    transform: [{ scale: 0.94 + breath.value * 0.12 }],
  }));

  const caption = reveal.caption?.trim() || 'Untitled Echo';

  return (
    <View style={styles.screen}>
      {/*
        Bloom behind the blur, exactly as GlassSheet does it: a blur only
        shows what is under it, so without a wash to pick up, the frosted
        panel in the second beat would collapse into a flat card.
      */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={styles.bloomAccent} />
        <View style={styles.bloomLight} />
      </View>

      <Touchable
        style={[styles.close, { top: insets.top + 12 }]}
        activeOpacity={0.76}
        onPress={onDismiss}
        hitSlop={10}
      >
        <Ionicons name="close" size={20} color={C.muted} />
      </Touchable>

      {phase === 'invitation' ? (
        <View style={[styles.invitation, { paddingTop: insets.top + 72, paddingBottom: insets.bottom + 44 }]}>
          <View style={styles.mark}>
            <Animated.View style={[styles.halo, haloStyle]} />
            <FrequencyLogo size={70} opacity={0.9} />
          </View>

          <SpringIn delay={120} style={styles.invitationCopy}>
            <Text style={styles.eyebrow}>Echo Impact</Text>
            <Text style={styles.headline}>Your Echo{'\n'}had its 24 hours.</Text>
            <Text style={styles.caption}>{caption}</Text>
          </SpringIn>

          <SpringIn delay={280} style={styles.invitationFooter}>
            <Touchable
              style={styles.primaryButton}
              activeOpacity={0.86}
              onPress={() => setPhase('story')}
            >
              <Text style={styles.primaryButtonText}>See what happened</Text>
            </Touchable>

            {/*
              Only when more than one is waiting. Each Echo gets its own
              separate moment, so without this a second full screen after
              the first reads as the app repeating itself.
            */}
            {total > 1 && (
              <Text style={styles.queueNote}>
                {position} of {total}
              </Text>
            )}
          </SpringIn>
        </View>
      ) : (
        <View style={[styles.storyWrap, { paddingTop: insets.top + 64, paddingBottom: insets.bottom + 18 }]}>
          <BlurView
            intensity={44}
            tint="systemThinMaterialDark"
            experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
            style={styles.panel}
          >
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              bounces
            >
              <EchoImpactHeading
                eyebrow="Echo Impact"
                theme={reveal.story.personalityTitle}
                subtitle={reveal.story.storySubtitle}
              />

              <EchoImpactStory insights={reveal.story.insights} />

              <SpringIn delay={220} style={styles.storyFooter}>
                <Text style={styles.keptNote}>This Echo now lives in your Archives.</Text>
                <Touchable style={styles.primaryButton} activeOpacity={0.86} onPress={onDismiss}>
                  <Text style={styles.primaryButtonText}>
                    {position < total ? 'Next Echo' : 'Done'}
                  </Text>
                </Touchable>
              </SpringIn>
            </ScrollView>
          </BlurView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // True black rather than the app's #111614 surface. Everything else in
  // Frequency sits on that surface, so this is the one screen that reads
  // as the app stepping out of the way.
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

  close: {
    position: 'absolute',
    right: 20,
    zIndex: 5,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(226,237,232,0.06)',
  },

  invitation: {
    flex: 1,
    paddingHorizontal: 34,
    justifyContent: 'space-between',
  },

  mark: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 26,
  },

  halo: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(107,168,130,0.22)',
  },

  invitationCopy: {
    gap: 16,
  },

  eyebrow: {
    color: C.muted,
    fontSize: 15,
    fontWeight: '600',
  },

  // The app's full-screen header scale, 44/800/-1.2 -- this is a
  // destination, not a sheet.
  headline: {
    color: C.text,
    fontSize: 44,
    fontWeight: '800',
    lineHeight: 49,
    letterSpacing: -1.2,
  },

  caption: {
    color: C.accentSoft,
    fontSize: 18,
    lineHeight: 26,
  },

  invitationFooter: {
    gap: 18,
    alignItems: 'center',
  },

  primaryButton: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.accent,
    borderRadius: R.md,
    paddingVertical: 17,
  },

  primaryButtonText: {
    color: '#0B100D',
    fontSize: 17,
    fontWeight: '700',
  },

  queueNote: {
    color: C.faint,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },

  storyWrap: {
    flex: 1,
    paddingHorizontal: 12,
  },

  panel: {
    flex: 1,
    borderRadius: R.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(226,237,232,0.09)',
    borderTopColor: 'rgba(226,237,232,0.20)',
  },

  scroll: {
    flex: 1,
  },

  scrollContent: {
    paddingHorizontal: 26,
    paddingTop: 28,
    paddingBottom: 30,
  },

  storyFooter: {
    gap: 16,
    paddingTop: 26,
  },

  keptNote: {
    color: C.faint,
    fontSize: 14,
    lineHeight: 20,
  },
});
