import { usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

import type {
  OnboardingEvent,
  OnboardingHaptic,
  OnboardingPresentationPhase,
  OnboardingStep,
  OnboardingTransition,
} from '@/components/onboarding/types';
import { light, medium, selection, success } from '@/lib/haptics';

const DEFAULT_TRANSITION: Required<OnboardingTransition> = {
  cardExitMs: 180,
  spotlightPauseMs: 220,
  cardEnterDelayMs: 80,
};

type OnboardingDirectorConfig = {
  active: boolean;
  currentStep: OnboardingStep | null;
  currentStepIndex: number;
  steps: OnboardingStep[];
  presentationPhase: OnboardingPresentationPhase;
  setCurrentStepIndex: (nextIndex: number | ((index: number) => number)) => void;
  setPresentationPhase: (phase: OnboardingPresentationPhase) => void;
  measureTarget: (targetId: string) => Promise<unknown>;
  finish: (persist?: boolean) => Promise<void>;
};

export function useOnboardingDirector({
  active,
  currentStep,
  currentStepIndex,
  steps,
  presentationPhase,
  setCurrentStepIndex,
  setPresentationPhase,
  measureTarget,
  finish,
}: OnboardingDirectorConfig) {
  const router = useRouter();
  const pathname = usePathname();
  const transitionTokenRef = useRef(0);
  const navigatedStepIdRef = useRef<string | null>(null);
  const waitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearWaitTimer = useCallback(() => {
    if (waitTimerRef.current) {
      clearTimeout(waitTimerRef.current);
      waitTimerRef.current = null;
    }
  }, []);

  const finishFlow = useCallback(async (persist = true) => {
    transitionTokenRef.current += 1;
    clearWaitTimer();
    setPresentationPhase('hidden');
    await finish(persist);
  }, [clearWaitTimer, finish, setPresentationPhase]);

  const navigate = useCallback(
    (href: string) => {
      router.push(href as never);
    },
    [router]
  );

  const moveToIndex = useCallback(
    async (nextIndex: number) => {
      if (!currentStep) return;

      if (nextIndex < 0) {
        setCurrentStepIndex(0);
        return;
      }

      if (nextIndex >= steps.length) {
        await finishFlow();
        return;
      }

      const token = transitionTokenRef.current + 1;
      transitionTokenRef.current = token;
      clearWaitTimer();

      const transition = resolveTransition(currentStep.transition);
      setPresentationPhase('moving');
      await sleep(transition.cardExitMs);

      if (transitionTokenRef.current !== token) return;

      setCurrentStepIndex(nextIndex);
    },
    [
      clearWaitTimer,
      currentStep,
      finishFlow,
      setCurrentStepIndex,
      setPresentationPhase,
      steps.length,
    ]
  );

  const next = useCallback(async () => {
    if (!currentStep) return;

    if (__DEV__) {
      console.debug('[onboarding] next requested', {
        from: currentStep.id,
        currentStepIndex,
        nextStepId: steps[currentStepIndex + 1]?.id ?? null,
      });
    }

    if (currentStep.type === 'final') {
      await finishFlow(currentStep.persistOnPrimaryAction !== false);
      return;
    }

    if (currentStepIndex + 1 >= steps.length) {
      await finishFlow(currentStep.persistOnPrimaryAction !== false);
      return;
    }

    await moveToIndex(currentStepIndex + 1);
  }, [currentStep, currentStepIndex, finishFlow, moveToIndex, steps]);

  const previous = useCallback(async () => {
    await moveToIndex(currentStepIndex - 1);
  }, [currentStepIndex, moveToIndex]);

  const skip = useCallback(async () => {
    await finishFlow();
  }, [finishFlow]);

  const dismiss = useCallback(async () => {
    await finishFlow(false);
  }, [finishFlow]);

  const notify = useCallback(
    (event: OnboardingEvent) => {
      if (!active || !currentStep) return;

      const condition = currentStep.completionCondition;

      if (__DEV__) {
        console.debug('[onboarding] completion condition evaluation', {
          stepId: currentStep.id,
          eventType: event.type,
          conditionType: condition?.type ?? null,
        });
      }

      if (!condition || condition.type === 'primaryAction' || condition.type === 'delay') {
        return;
      }

      if (eventMatchesCondition(event, condition, currentStep.targetId)) {
        void next();
      }
    },
    [active, currentStep, next]
  );

  useEffect(() => {
    if (!active) {
      navigatedStepIdRef.current = null;
      return;
    }

    if (!currentStep || currentStep.id === navigatedStepIdRef.current) return;

    navigatedStepIdRef.current = currentStep.id;
    runNavigationAction(currentStep, router);
  }, [active, currentStep, router]);

  useEffect(() => {
    if (!active || !currentStep) return;

    const transition = resolveTransition(currentStep.transition);
    const delayBeforeShow = currentStep.delayBeforeShowMs ?? 0;
    const settleDelay = transition.spotlightPauseMs + transition.cardEnterDelayMs + delayBeforeShow;
    const token = transitionTokenRef.current;

    clearWaitTimer();
    void playStepHaptic(currentStep.haptic);

    waitTimerRef.current = setTimeout(() => {
      if (transitionTokenRef.current === token) {
        setPresentationPhase('settled');
      }
    }, settleDelay);

    return clearWaitTimer;
  }, [active, clearWaitTimer, currentStep, setPresentationPhase]);

  useEffect(() => {
    if (!active || !currentStep?.targetId || currentStep.spotlight?.skipIfMissing !== true) {
      return;
    }

    let cancelled = false;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;

      void measureTarget(currentStep.targetId!).then((frame) => {
        if (cancelled || frame || attempts < 16) return;

        clearInterval(timer);
        void next();
      });
    }, 110);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active, currentStep, measureTarget, next]);

  useEffect(() => {
    if (
      !active ||
      !currentStep ||
      currentStep.completionCondition?.type !== 'navigation'
    ) {
      return;
    }

    if (
      !currentStep.completionCondition.route ||
      pathname === currentStep.completionCondition.route
    ) {
      void next();
    }
  }, [active, currentStep, next, pathname]);

  useEffect(() => {
    if (!active || !currentStep || presentationPhase !== 'settled') return;

    const condition = currentStep.completionCondition;

    if (currentStep.type === 'automatic' || condition?.type === 'delay') {
      const delayMs = condition?.type === 'delay' ? condition.ms : 1200;

      clearWaitTimer();
      waitTimerRef.current = setTimeout(() => {
        void next();
      }, delayMs);

      return clearWaitTimer;
    }

  }, [
    active,
    clearWaitTimer,
    currentStep,
    next,
    presentationPhase,
  ]);

  return {
    next,
    previous,
    skip,
    finish: finishFlow,
    dismiss,
    navigate,
    notify,
  };
}

function resolveTransition(transition?: OnboardingTransition): Required<OnboardingTransition> {
  return {
    ...DEFAULT_TRANSITION,
    ...transition,
  };
}

function eventMatchesCondition(
  event: OnboardingEvent,
  condition: Exclude<OnboardingStep['completionCondition'], undefined>,
  fallbackTargetId?: string
) {
  if (condition.type === 'tap' && event.type === 'tap') {
    return !condition.targetId || condition.targetId === (event.targetId ?? fallbackTargetId);
  }

  if (condition.type === 'longPress' && event.type === 'longPress') {
    return !condition.targetId || condition.targetId === (event.targetId ?? fallbackTargetId);
  }

  if (condition.type === 'navigation' && event.type === 'navigation') {
    return !condition.route || condition.route === event.route;
  }

  return condition.type === event.type;
}

function runNavigationAction(step: OnboardingStep, router: ReturnType<typeof useRouter>) {
  const action = step.navigationAction;

  if (!action) return;

  if (action.type === 'back') {
    router.back();
    return;
  }

  if (!action.href) return;

  if (action.type === 'replace') {
    router.replace(action.href as never);
    return;
  }

  router.push(action.href as never);
}

async function playStepHaptic(haptic?: OnboardingHaptic) {
  if (!haptic) return;

  if (haptic === 'light') {
    await light();
    return;
  }

  if (haptic === 'medium') {
    await medium();
    return;
  }

  if (haptic === 'selection') {
    await selection();
    return;
  }

  await success();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
