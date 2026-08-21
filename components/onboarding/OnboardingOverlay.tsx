import { BlurView } from 'expo-blur';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FrequencyLogo } from '@/components/branding/FrequencyLogo';
import { FloatingGuidanceCard } from '@/components/onboarding/FloatingGuidanceCard';
import { PeopleSuggestionsLayer } from '@/components/onboarding/PeopleSuggestionsLayer';
import { FrequencyColors as C, FrequencySpacing as S } from '@/constants/frequencyTheme';
import { PROFILE_ONBOARDING_TARGET_ORDER } from '@/lib/onboarding/events';
import type { OnboardingStep, OnboardingTargetFrame } from '@/components/onboarding/types';

const APP_SETTLE_DELAY = 780;
const TARGET_RETRY_MS = 100;
const TARGET_RETRY_LIMIT = 16;
const SPOTLIGHT_PADDING = 10;

type OnboardingOverlayProps = {
  active: boolean;
  currentStep: OnboardingStep | null;
  guidanceVisible: boolean;
  userId: string | null;
  measureTarget: (targetId: string) => Promise<OnboardingTargetFrame | null>;
  onAbort?: () => void;
  onSkip?: () => void;
  onNext?: () => void;
};

export function OnboardingOverlay({
  active,
  currentStep,
  guidanceVisible,
  userId,
  measureTarget,
  onAbort,
  onSkip,
  onNext,
}: OnboardingOverlayProps) {
  if (!active || !currentStep) return null;

  if (currentStep.id === 'intro') {
    return <WelcomeLayer step={currentStep} />;
  }

  if (currentStep.id === 'search_people_suggestions') {
    return <PeopleSuggestionsLayer step={currentStep} userId={userId} onNext={onNext} onSkip={onSkip} />;
  }

  if (
    currentStep.id === 'echo_intro' ||
    currentStep.id === 'record_intro' ||
    currentStep.id === 'whispers_intro' ||
    currentStep.id === 'profile_intro' ||
    currentStep.id === 'echo_impact' ||
    currentStep.id === 'search_intro'
  ) {
    return (
      <EchoSpotlightLayer
        step={currentStep}
        guidanceVisible={guidanceVisible}
        measureTarget={measureTarget}
        onAbort={onAbort}
        onBackgroundTap={currentStep.spotlight?.dismissOnBackgroundTap ? onSkip : undefined}
      />
    );
  }

  return null;
}

function WelcomeLayer({ step }: { step: OnboardingStep }) {
  const insets = useSafeAreaInsets();
  const treatmentOpacity = useRef(new Animated.Value(0)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoY = useRef(new Animated.Value(10)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const descriptionOpacity = useRef(new Animated.Value(0)).current;
  const actionsOpacity = useRef(new Animated.Value(0)).current;
  const [interactive, setInteractive] = useState(false);

  useEffect(() => {
    const values = [
      treatmentOpacity,
      logoOpacity,
      logoY,
      titleOpacity,
      descriptionOpacity,
      actionsOpacity,
    ];
    values.forEach((value) => value.stopAnimation());

    treatmentOpacity.setValue(0);
    logoOpacity.setValue(0);
    logoY.setValue(10);
    titleOpacity.setValue(0);
    descriptionOpacity.setValue(0);
    actionsOpacity.setValue(0);
    setInteractive(false);

    const childTimers: ReturnType<typeof setTimeout>[] = [];
    const entrance = setTimeout(() => {
      setInteractive(true);
      Animated.timing(treatmentOpacity, timing(360)).start();
      Animated.parallel([
        Animated.timing(logoOpacity, timing(360)),
        Animated.timing(logoY, timing(360, 0)),
      ]).start();
      const titleTimer = setTimeout(() => Animated.timing(titleOpacity, timing(320)).start(), 100);
      const descriptionTimer = setTimeout(
        () => Animated.timing(descriptionOpacity, timing(320)).start(),
        180
      );
      const actionsTimer = setTimeout(
        () => Animated.timing(actionsOpacity, timing(340)).start(),
        280
      );

      childTimers.push(titleTimer, descriptionTimer, actionsTimer);
    }, APP_SETTLE_DELAY);

    return () => {
      clearTimeout(entrance);
      childTimers.forEach(clearTimeout);
    };
  }, [actionsOpacity, descriptionOpacity, logoOpacity, logoY, titleOpacity, treatmentOpacity]);

  return (
    <Animated.View
      pointerEvents={interactive ? 'auto' : 'none'}
      style={[styles.overlay, { opacity: treatmentOpacity }]}
    >
      <BlurView
        intensity={28}
        tint="dark"
        experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.dim} />
      <View
        style={[
          styles.content,
          { paddingTop: insets.top + S.xxl, paddingBottom: insets.bottom + S.xxl },
        ]}
      >
        <Animated.View style={{ opacity: logoOpacity, transform: [{ translateY: logoY }] }}>
          <FrequencyLogo size={76} colorMode="white" />
        </Animated.View>
        <Animated.Text style={[styles.title, { opacity: titleOpacity }]}>
          {step.title}
        </Animated.Text>
        <Animated.Text style={[styles.description, { opacity: descriptionOpacity }]}>
          {step.description}
        </Animated.Text>
        <Animated.View style={[styles.actions, { opacity: actionsOpacity }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={step.primaryButtonLabel}
            onPress={step.guidance?.onPrimaryAction}
            style={styles.beginButton}
          >
            <Text style={styles.beginText}>{step.primaryButtonLabel}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={step.secondaryButtonLabel}
            onPress={step.guidance?.onSecondaryAction}
            hitSlop={12}
            style={styles.skipButton}
          >
            <Text style={styles.skipText}>{step.secondaryButtonLabel}</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

function EchoSpotlightLayer({
  step,
  guidanceVisible,
  measureTarget,
  onAbort,
  onBackgroundTap,
}: {
  step: OnboardingStep;
  guidanceVisible: boolean;
  measureTarget: (targetId: string) => Promise<OnboardingTargetFrame | null>;
  onAbort?: () => void;
  onBackgroundTap?: () => void;
}) {
  const [screen, setScreen] = useState({ width: 0, height: 0 });
  const [targetFrame, setTargetFrame] = useState<OnboardingTargetFrame | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [placementFrame, setPlacementFrame] = useState<OnboardingTargetFrame | null>(null);
  const [targetReady, setTargetReady] = useState(false);
  const [cardRendered, setCardRendered] = useState(false);
  const isProfileStep = step.id === 'profile_intro';
  const guidanceReady = Boolean(
    (step.guidance?.title ?? step.title)?.trim() &&
      (step.guidance?.description ?? step.description)?.trim()
  );
  const dimOpacity = useRef(new Animated.Value(0)).current;
  const spotlight = useRef({
    top: new Animated.Value(0),
    left: new Animated.Value(0),
    right: new Animated.Value(0),
    bottom: new Animated.Value(0),
    width: new Animated.Value(0),
    height: new Animated.Value(0),
    radius: new Animated.Value(24),
  }).current;

  useEffect(() => {
    let attempts = 0;
    let mounted = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    // A target can measure successfully but still be mid-animation (a
    // parent scroll, a layout reflow) — the frame is valid, just stale.
    // Require the same target to report the identical frame on two
    // consecutive attempts before trusting it, so the spotlight can never
    // lock onto a position that's about to change out from under it.
    let lastStableFrame: OnboardingTargetFrame | null = null;
    let lastStableTargetId: string | null = null;

    setTargetFrame(null);
    setSelectedTargetId(null);
    setPlacementFrame(null);
    setTargetReady(false);
    setCardRendered(false);
    dimOpacity.stopAnimation();
    dimOpacity.setValue(0);

    // A native measureInWindow call can occasionally never call back if the
    // measured view is re-laid-out mid-measurement (happens on Profile,
    // which loads avatar/stats data asynchronously). Racing every
    // measurement against a timeout guarantees this loop always advances
    // instead of stalling forever on one stuck call.
    const measureWithTimeout = (targetId: string) =>
      Promise.race<OnboardingTargetFrame | null>([
        measureTarget(targetId),
        new Promise((resolve) => setTimeout(() => resolve(null), TARGET_RETRY_MS)),
      ]);

    const sync = async () => {
      const targetIds: string[] = isProfileStep
        ? [...PROFILE_ONBOARDING_TARGET_ORDER]
        : [step.targetId ?? 'dock_record_button'];
      let frame: OnboardingTargetFrame | null = null;
      let resolvedTargetId: string | null = null;

      for (const targetId of targetIds) {
        const candidate = await measureWithTimeout(targetId);
        if (candidate && isValidTargetFrame(candidate)) {
          frame = candidate;
          resolvedTargetId = targetId;
          break;
        }
      }
      const cardFrame = await measureWithTimeout('feed_primary_echo_card');
      if (!mounted) return;

      const isStable =
        frame &&
        resolvedTargetId &&
        lastStableTargetId === resolvedTargetId &&
        lastStableFrame &&
        framesMatch(frame, lastStableFrame);

      lastStableFrame = frame;
      lastStableTargetId = resolvedTargetId;

      if (cardFrame && isValidTargetFrame(cardFrame)) {
        setPlacementFrame(cardFrame);
      }
      attempts += 1;

      if (isStable && frame && resolvedTargetId) {
        setTargetFrame(frame);
        setSelectedTargetId(resolvedTargetId);
        setTargetReady(true);
        if (__DEV__ && isProfileStep) {
          console.debug('[onboarding] Profile selected target', resolvedTargetId);
          console.debug('[onboarding] Profile measured target', {
            x: frame.pageX,
            y: frame.pageY,
            width: frame.width,
            height: frame.height,
          });
        }
        return;
      }

      if (attempts >= TARGET_RETRY_LIMIT) {
        // Ran out of retries without two matching reads in a row — use
        // whatever was last measured rather than nothing at all.
        if (frame && resolvedTargetId) {
          setTargetFrame(frame);
          setSelectedTargetId(resolvedTargetId);
        }
        setTargetReady(true);
        if (__DEV__ && isProfileStep) {
          console.debug('[onboarding] Profile target measurement fallback used');
        }
        return;
      }

      retryTimer = setTimeout(sync, TARGET_RETRY_MS);
    };

    void sync();

    return () => {
      mounted = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [dimOpacity, isProfileStep, measureTarget, step.targetId]);

  useEffect(() => {
    if (guidanceReady) return;
    if (__DEV__) console.debug('[onboarding] Onboarding step aborted: guidance unavailable', step.id);
    onAbort?.();
  }, [guidanceReady, onAbort, step.id]);

  const handleCardRendered = useCallback(() => {
    setCardRendered(true);
    if (__DEV__) console.debug('[onboarding] Onboarding guidance card rendered', step.id);
  }, [step.id]);

  useEffect(() => {
    if (!targetReady || !guidanceVisible || !guidanceReady || cardRendered) {
      return;
    }

    const timeout = setTimeout(() => {
      if (__DEV__) {
        console.debug('[onboarding] Onboarding step aborted: guidance card did not render', step.id);
      }
      onAbort?.();
    }, 2000);

    return () => clearTimeout(timeout);
  }, [cardRendered, guidanceReady, guidanceVisible, onAbort, step.id, targetReady]);

  useEffect(() => {
    if (!targetReady || !guidanceVisible || !guidanceReady) return;

    if (!targetFrame) {
      if (isProfileStep) {
        Animated.timing(dimOpacity, timing(220)).start();
        if (__DEV__) {
          console.debug('[onboarding] Profile showing centered card fallback without dimming');
        }
      }
      return;
    }

    if (__DEV__ && isProfileStep) {
      console.debug('[onboarding] Profile overlay activated');
    }

    Animated.timing(dimOpacity, timing(320)).start();
    const frame = targetFrame ?? {
      pageX: screen.width * 0.08,
      pageY: screen.height * 0.28,
      width: screen.width * 0.84,
      height: 240,
    };
    const left = Math.max(0, frame.pageX - SPOTLIGHT_PADDING);
    const top = Math.max(0, frame.pageY - SPOTLIGHT_PADDING);
    const right = Math.min(screen.width, frame.pageX + frame.width + SPOTLIGHT_PADDING);
    const bottom = Math.min(screen.height, frame.pageY + frame.height + SPOTLIGHT_PADDING);
    const radius = Math.max(20, Math.min(32, frame.height / 8));

    if (
      !isFiniteNumber(left) ||
      !isFiniteNumber(top) ||
      !isFiniteNumber(right) ||
      !isFiniteNumber(bottom) ||
      !isFiniteNumber(radius)
    ) {
      return;
    }

    if (__DEV__) {
      console.debug(
        '[onboarding] resolved spotlight frame',
        'targetId:', selectedTargetId ?? step.targetId ?? 'dock_record_button',
        'x:', left,
        'y:', top,
        'width:', Math.max(0, right - left),
        'height:', Math.max(0, bottom - top),
        'radius:', radius,
        'padding:', SPOTLIGHT_PADDING
      );
      console.debug(
        '[onboarding] guidance placement frame',
        'x:', placementFrame?.pageX ?? null,
        'y:', placementFrame?.pageY ?? null,
        'width:', placementFrame?.width ?? null,
        'height:', placementFrame?.height ?? null,
        'screenWidth:', screen.width,
        'screenHeight:', screen.height
      );
    }

    Animated.parallel([
      Animated.timing(spotlight.top, frameTiming(top)),
      Animated.timing(spotlight.left, frameTiming(left)),
      Animated.timing(spotlight.right, frameTiming(right)),
      Animated.timing(spotlight.bottom, frameTiming(bottom)),
      Animated.timing(spotlight.width, frameTiming(Math.max(0, right - left))),
      Animated.timing(spotlight.height, frameTiming(Math.max(0, bottom - top))),
      Animated.timing(spotlight.radius, frameTiming(radius)),
    ]).start();
  }, [dimOpacity, guidanceReady, guidanceVisible, isProfileStep, placementFrame, screen, selectedTargetId, spotlight, step.targetId, targetFrame, targetReady]);

  if (!screen.width || !screen.height) {
    return (
      <View
        pointerEvents="none"
        style={styles.overlay}
        onLayout={(event) => setScreen(event.nativeEvent.layout)}
      />
    );
  }

  return (
    <Animated.View
      style={[styles.overlay, { opacity: dimOpacity }]}
      onLayout={(event: LayoutChangeEvent) => setScreen(event.nativeEvent.layout)}
      pointerEvents="box-none"
    >
      {targetReady && targetFrame ? (
        <>
          <DimmingPanel style={[styles.panel, styles.topPanel, { height: spotlight.top }]} onDismiss={onBackgroundTap} />
          <DimmingPanel
            style={[styles.panel, styles.leftPanel, { top: spotlight.top, width: spotlight.left, height: spotlight.height }]}
            onDismiss={onBackgroundTap}
          />
          <DimmingPanel
            style={[styles.panel, styles.rightPanel, { top: spotlight.top, left: spotlight.right, height: spotlight.height }]}
            onDismiss={onBackgroundTap}
          />
          <DimmingPanel style={[styles.panel, styles.bottomPanel, { top: spotlight.bottom }]} onDismiss={onBackgroundTap} />
        </>
      ) : targetReady && !isProfileStep ? (
        <DimmingPanel style={StyleSheet.absoluteFill} onDismiss={onBackgroundTap} />
      ) : null}

      {targetReady && targetFrame ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.spotlightEdge,
            {
              top: spotlight.top,
              left: spotlight.left,
              width: spotlight.width,
              height: spotlight.height,
              borderRadius: spotlight.radius,
            },
          ]}
        />
      ) : null}

      <FloatingGuidanceCard
        {...(step.guidance ?? {
          title: step.title ?? 'This is an Echo.',
          description: step.description ?? 'A live voice thought, shared in the moment.',
          primaryActionLabel: step.primaryButtonLabel ?? 'Continue',
        })}
        screen={screen}
        targetFrame={targetFrame}
        placementTargetFrame={placementFrame}
        visible={targetReady && guidanceVisible && guidanceReady}
        placement={targetFrame ? 'auto' : 'center'}
        onRendered={handleCardRendered}
      />
      {__DEV__ && targetReady && !targetFrame ? (
        <Text style={styles.diagnosticLabel}>Profile target unavailable; showing safe fallback</Text>
      ) : null}
    </Animated.View>
  );
}

function DimmingPanel({ style, onDismiss }: { style: object; onDismiss?: () => void }) {
  return (
    <Animated.View
      onStartShouldSetResponder={() => true}
      onResponderRelease={onDismiss}
      style={style}
    >
      <BlurView
        pointerEvents="none"
        intensity={16}
        tint="dark"
        experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
        style={StyleSheet.absoluteFill}
      >
        <View style={styles.dim} />
      </BlurView>
    </Animated.View>
  );
}

function isValidTargetFrame(frame: OnboardingTargetFrame) {
  return (
    isFiniteNumber(frame.x) &&
    isFiniteNumber(frame.y) &&
    isFiniteNumber(frame.width) &&
    isFiniteNumber(frame.height) &&
    isFiniteNumber(frame.pageX) &&
    isFiniteNumber(frame.pageY) &&
    frame.width > 0 &&
    frame.height > 0
  );
}

function framesMatch(a: OnboardingTargetFrame, b: OnboardingTargetFrame) {
  return (
    a.pageX === b.pageX &&
    a.pageY === b.pageY &&
    a.width === b.width &&
    a.height === b.height
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function timing(duration: number, toValue = 1) {
  return {
    toValue,
    duration,
    easing: Easing.out(Easing.cubic),
    useNativeDriver: true,
  } as const;
}

function frameTiming(toValue: number) {
  return {
    toValue,
    duration: 300,
    easing: Easing.out(Easing.cubic),
    useNativeDriver: false,
  } as const;
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 999 },
  panel: { position: 'absolute', overflow: 'hidden' },
  topPanel: { top: 0, left: 0, right: 0 },
  leftPanel: { left: 0 },
  rightPanel: { right: 0 },
  bottomPanel: { left: 0, right: 0, bottom: 0 },
  spotlightEdge: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(226, 237, 232, 0.18)',
    shadowColor: C.accent,
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 3,
  },
  dim: { flex: 1, backgroundColor: 'rgba(17, 22, 20, 0.40)' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: S.xxl },
  title: { color: C.text, fontSize: 30, fontWeight: '700', letterSpacing: -0.5, marginTop: 30, textAlign: 'center' },
  description: { color: C.muted, fontSize: 17, lineHeight: 25, marginTop: 14, textAlign: 'center' },
  actions: { alignItems: 'center', marginTop: 44, width: '100%' },
  beginButton: { alignItems: 'center', backgroundColor: C.accent, borderRadius: 22, justifyContent: 'center', minHeight: 56, maxWidth: 360, width: '100%' },
  beginText: { color: '#111614', fontSize: 17, fontWeight: '700' },
  skipButton: { marginTop: 24, padding: 4 },
  skipText: { color: C.muted, fontSize: 15, fontWeight: '500' },
  diagnosticLabel: {
    position: 'absolute',
    bottom: 42,
    alignSelf: 'center',
    color: C.faint,
    fontSize: 12,
  },
});
