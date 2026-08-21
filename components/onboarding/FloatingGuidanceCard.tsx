import { BlurView } from 'expo-blur';
import { useEffect, useMemo, useRef, useState } from 'react';
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

import {
  FrequencyColors as C,
  FrequencyRadius as R,
  FrequencySpacing as S,
} from '@/constants/frequencyTheme';
import type { OnboardingGuidanceContent, OnboardingTargetFrame } from '@/components/onboarding/types';

const SCREEN_MARGIN = 20;
const TARGET_GAP = 18;
const MAX_CARD_WIDTH = 340;
const MIN_CARD_WIDTH = 260;
const BOTTOM_SAFE_MARGIN = 112;

type FloatingGuidanceCardProps = OnboardingGuidanceContent & {
  screen: { width: number; height: number };
  targetFrame: OnboardingTargetFrame | null;
  placementTargetFrame?: OnboardingTargetFrame | null;
  visible: boolean;
  placement?: 'auto' | 'center';
  onRendered?: () => void;
};

type CardPlacement = {
  top: number;
  left: number;
  width: number;
};

export const FLOATING_GUIDANCE_PLACEHOLDER: OnboardingGuidanceContent = {
  title: 'A quieter way in',
  description: 'A short, focused note can live here when this step is ready.',
  primaryActionLabel: 'Continue',
  secondaryActionLabel: "I'll explore myself",
  progress: {
    current: 1,
    total: 3,
  },
};

export function FloatingGuidanceCard({
  title,
  description,
  primaryActionLabel,
  onPrimaryAction,
  secondaryActionLabel,
  onSecondaryAction,
  progress,
  screen,
  targetFrame,
  placementTargetFrame,
  visible,
  placement: placementMode = 'auto',
  onRendered,
}: FloatingGuidanceCardProps) {
  const entrance = useRef(new Animated.Value(0)).current;
  const targetKeyRef = useRef<string | null>(null);
  // Tracks the same thing as `rendered` state, but as a ref so this effect
  // doesn't depend on `rendered` itself. It used to: the entrance animation
  // fired setRendered(true), which is a dependency of this same effect, so
  // React re-ran it immediately afterward and its cleanup called
  // animation.stop() on the fade-in it had just started — killing the
  // animation within a frame or two of it beginning, before opacity ever
  // reached 1. The card would then sit fully mounted but invisible forever,
  // since nothing else was left to restart the animation.
  const hasEnteredRef = useRef(false);
  const [rendered, setRendered] = useState(visible);
  const [displayTargetFrame, setDisplayTargetFrame] = useState<OnboardingTargetFrame | null>(
    targetFrame
  );
  const [cardSize, setCardSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const nextTargetKey = targetFrame ? keyForTargetFrame(targetFrame) : null;

    if (!visible) {
      hasEnteredRef.current = false;
      targetKeyRef.current = nextTargetKey;
      entrance.stopAnimation();
      const animation = Animated.timing(entrance, {
        toValue: 0,
        duration: 170,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      });

      animation.start(({ finished }) => {
        if (finished) {
          setRendered(false);
        }
      });

      return () => {
        animation.stop();
      };
    }

    if (!hasEnteredRef.current) {
      hasEnteredRef.current = true;
      targetKeyRef.current = nextTargetKey;
      setDisplayTargetFrame(targetFrame);
      setRendered(true);
      entrance.stopAnimation();
      entrance.setValue(0);
      const animation = animateIn(entrance);

      return () => {
        animation.stop();
      };
    }

    if (targetKeyRef.current !== nextTargetKey) {
      targetKeyRef.current = nextTargetKey;
      entrance.stopAnimation();
      const animation = Animated.timing(entrance, {
        toValue: 0,
        duration: 150,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      });

      animation.start(() => {
        setDisplayTargetFrame(targetFrame);
        entrance.setValue(0);
        animateIn(entrance);
      });

      return () => {
        animation.stop();
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entrance, targetFrame, visible]);

  const placement = useMemo(
    () =>
      resolvePlacement({
        targetFrame: placementTargetFrame ?? displayTargetFrame,
        screen,
        cardSize,
        placementMode,
      }),
    [cardSize, displayTargetFrame, placementMode, placementTargetFrame, screen]
  );

  useEffect(() => {
    if (rendered && visible && screen.width > 0 && screen.height > 0) {
      onRendered?.();
    }
  }, [onRendered, rendered, screen.height, screen.width, visible]);

  if (!rendered || !screen.width || !screen.height) {
    return null;
  }

  const translateY = entrance.interpolate({
    inputRange: [0, 1],
    outputRange: [12, 0],
  });
  const scale = entrance.interpolate({
    inputRange: [0, 1],
    outputRange: [0.97, 1],
  });

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.positioner,
        {
          top: placement.top,
          left: placement.left,
          width: placement.width,
          opacity: entrance,
          transform: [{ translateY }, { scale }],
        },
      ]}
    >
      <BlurView
        intensity={34}
        tint="systemThinMaterialDark"
        experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
        style={styles.card}
        onLayout={(event: LayoutChangeEvent) => setCardSize(event.nativeEvent.layout)}
      >
        <View style={styles.glassTint}>
          {progress ? (
            <View style={styles.progressRow}>
              {Array.from({ length: progress.total }).map((_, index) => (
                <View
                  key={index}
                  style={[
                    styles.progressDot,
                    index < progress.current && styles.progressDotActive,
                  ]}
                />
              ))}
            </View>
          ) : null}

          <Text style={styles.title}>{title}</Text>
          <Text style={styles.description}>{description}</Text>

          <View style={styles.actions}>
            {secondaryActionLabel ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={secondaryActionLabel}
                onPress={onSecondaryAction}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.secondaryButtonText}>{secondaryActionLabel}</Text>
              </Pressable>
            ) : null}

            {primaryActionLabel ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={primaryActionLabel}
                onPress={onPrimaryAction}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.primaryButtonText}>{primaryActionLabel}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </BlurView>
    </Animated.View>
  );
}

function resolvePlacement({
  targetFrame,
  screen,
  cardSize,
  placementMode,
}: {
  targetFrame: OnboardingTargetFrame | null;
  screen: { width: number; height: number };
  cardSize: { width: number; height: number };
  placementMode: 'auto' | 'center';
}): CardPlacement {
  const availableWidth = Math.max(0, screen.width - SCREEN_MARGIN * 2);
  const width = Math.min(MAX_CARD_WIDTH, Math.max(MIN_CARD_WIDTH, availableWidth));
  const estimatedHeight = cardSize.height || 178;

  if (placementMode === 'center' || !targetFrame) {
    return {
      top: clamp(
        screen.height / 2 - estimatedHeight / 2,
        SCREEN_MARGIN,
        screen.height - estimatedHeight - BOTTOM_SAFE_MARGIN
      ),
      left: clamp(screen.width / 2 - width / 2, SCREEN_MARGIN, screen.width - width - SCREEN_MARGIN),
      width,
    };
  }

  const targetTop = targetFrame.pageY;
  const targetBottom = targetFrame.pageY + targetFrame.height;
  const targetLeft = targetFrame.pageX;
  const targetRight = targetFrame.pageX + targetFrame.width;
  const targetCenterX = targetLeft + targetFrame.width / 2;
  const targetCenterY = targetTop + targetFrame.height / 2;

  const usableBottom = screen.height - BOTTOM_SAFE_MARGIN;
  const belowSpace = usableBottom - targetBottom - TARGET_GAP;
  const aboveSpace = targetTop - TARGET_GAP - SCREEN_MARGIN;
  const rightSpace = screen.width - targetRight - TARGET_GAP - SCREEN_MARGIN;
  const leftSpace = targetLeft - TARGET_GAP - SCREEN_MARGIN;

  if (belowSpace >= estimatedHeight) {
    return {
      top: targetBottom + TARGET_GAP,
      left: clamp(targetCenterX - width / 2, SCREEN_MARGIN, screen.width - width - SCREEN_MARGIN),
      width,
    };
  }

  if (aboveSpace >= estimatedHeight) {
    return {
      top: targetTop - estimatedHeight - TARGET_GAP,
      left: clamp(targetCenterX - width / 2, SCREEN_MARGIN, screen.width - width - SCREEN_MARGIN),
      width,
    };
  }

  if (rightSpace >= width) {
    return {
      top: clamp(
        targetCenterY - estimatedHeight / 2,
        SCREEN_MARGIN,
        usableBottom - estimatedHeight
      ),
      left: targetRight + TARGET_GAP,
      width,
    };
  }

  if (leftSpace >= width) {
    return {
      top: clamp(
        targetCenterY - estimatedHeight / 2,
        SCREEN_MARGIN,
        usableBottom - estimatedHeight
      ),
      left: targetLeft - width - TARGET_GAP,
      width,
    };
  }

  const prefersBelow = belowSpace >= aboveSpace;
  const fallbackTop = prefersBelow
    ? targetBottom + TARGET_GAP
    : targetTop - estimatedHeight - TARGET_GAP;

  return {
    top: clamp(fallbackTop, SCREEN_MARGIN, usableBottom - estimatedHeight),
    left: clamp(targetCenterX - width / 2, SCREEN_MARGIN, screen.width - width - SCREEN_MARGIN),
    width,
  };
}

function animateIn(value: Animated.Value) {
  const animation = Animated.timing(value, {
    toValue: 1,
    duration: 300,
    easing: Easing.out(Easing.cubic),
    useNativeDriver: true,
  });

  animation.start();
  return animation;
}

function keyForTargetFrame(frame: OnboardingTargetFrame) {
  return [
    Math.round(frame.pageX),
    Math.round(frame.pageY),
    Math.round(frame.width),
    Math.round(frame.height),
  ].join(':');
}

function clamp(value: number, min: number, max: number) {
  if (max < min) return min;

  return Math.min(Math.max(value, min), max);
}

const styles = StyleSheet.create({
  positioner: {
    position: 'absolute',
    zIndex: 1001,
    shadowColor: '#000',
    shadowOpacity: 0.32,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 18 },
    elevation: 22,
  },

  card: {
    overflow: 'hidden',
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: 'rgba(226, 237, 232, 0.12)',
  },

  glassTint: {
    padding: S.lg,
    backgroundColor: 'rgba(24, 33, 27, 0.94)',
  },

  progressRow: {
    flexDirection: 'row',
    gap: 7,
    marginBottom: S.md,
  },

  progressDot: {
    width: 22,
    height: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(226, 237, 232, 0.16)',
  },

  progressDotActive: {
    backgroundColor: C.accent,
  },

  title: {
    color: C.text,
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 25,
  },

  description: {
    marginTop: S.sm,
    color: C.muted,
    fontSize: 15,
    lineHeight: 22,
  },

  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: S.sm,
    marginTop: S.lg,
  },

  primaryButton: {
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: S.lg,
    borderRadius: R.md,
    backgroundColor: C.accent,
  },

  primaryButtonText: {
    color: '#0B100D',
    fontSize: 14,
    fontWeight: '700',
  },

  secondaryButton: {
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: S.md,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: 'rgba(226, 237, 232, 0.14)',
  },

  secondaryButtonText: {
    color: C.text,
    fontSize: 14,
    fontWeight: '600',
  },

  buttonPressed: {
    opacity: 0.82,
  },
});
