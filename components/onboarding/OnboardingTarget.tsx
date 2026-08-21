import type { PropsWithChildren } from 'react';
import { useEffect, useRef } from 'react';
import { Animated, Easing, View, type ViewProps } from 'react-native';

import { useOnboarding, useOnboardingTarget } from '@/components/onboarding/OnboardingProvider';

type OnboardingTargetProps = PropsWithChildren<
  ViewProps & {
    id: string;
  }
>;

export function OnboardingTarget({ id, children, ...viewProps }: OnboardingTargetProps) {
  const ref = useRef<View>(null);
  const scale = useRef(new Animated.Value(1)).current;
  const { active, currentStep } = useOnboarding();
  const isActiveTarget = active && currentStep?.targetId === id;

  useOnboardingTarget(id, ref);

  useEffect(() => {
    scale.stopAnimation();
    const animation = Animated.timing(scale, {
      toValue: isActiveTarget ? 1.025 : 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });

    animation.start();

    return () => {
      animation.stop();
      scale.stopAnimation();
    };
  }, [isActiveTarget, scale]);

  return (
    <Animated.View
      ref={ref as never}
      collapsable={false}
      {...viewProps}
      style={[viewProps.style, { transform: [{ scale }] }]}
    >
      {children}
    </Animated.View>
  );
}
