import type { Session } from '@supabase/supabase-js';
import { usePathname } from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { PropsWithChildren, RefObject } from 'react';
import type { View } from 'react-native';

import { OnboardingBootstrap } from '@/components/onboarding/OnboardingBootstrap';
import { useOnboardingDirector } from '@/components/onboarding/OnboardingDirector';
import { OnboardingOverlay } from '@/components/onboarding/OnboardingOverlay';
import type {
  OnboardingEvent,
  OnboardingGuidanceContent,
  OnboardingPresentationPhase,
  OnboardingStep,
  OnboardingTargetFrame,
  OnboardingTargetRegistration,
} from '@/components/onboarding/types';
import {
  clearEchoImpactOnboardingPending,
  clearNewAccountOnboardingEligibility,
  consumeNewAccountOnboardingEligibility,
  persistOnboardingModuleCompleted,
  readOnboardingState,
  type OnboardingModule,
  type OnboardingState,
} from '@/lib/onboarding/persistence';
import {
  ECHO_IMPACT_ONBOARDING_STEPS,
  FEED_ONBOARDING_STEPS,
  PROFILE_ONBOARDING_STEPS,
  SEARCH_ONBOARDING_STEPS,
  WHISPERS_ONBOARDING_STEPS,
} from '@/lib/onboarding/steps';
import { PROFILE_ONBOARDING_TARGET_ORDER } from '@/lib/onboarding/events';

type ContextualModule = 'whispers' | 'profile' | 'search';

type OnboardingContextValue = {
  active: boolean;
  currentStep: OnboardingStep | null;
  currentStepIndex: number;
  steps: OnboardingStep[];
  startFeedOnboarding: () => void;
  completeFeedOnboarding: () => Promise<void>;
  requestWhispersOnboarding: () => void;
  requestProfileOnboarding: () => void;
  requestSearchOnboarding: () => void;
  screenReady: (module: ContextualModule) => void;
  startPendingEchoImpactOnboarding: () => void;
  start: (steps: OnboardingStep[], options?: { restart?: boolean }) => void;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  skip: () => Promise<void>;
  finish: () => Promise<void>;
  dismiss: () => Promise<void>;
  navigate: (href: string) => void;
  notify: (event: OnboardingEvent) => void;
  registerTarget: (registration: OnboardingTargetRegistration) => () => void;
  measureTarget: (targetId: string) => Promise<OnboardingTargetFrame | null>;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({
  children,
  session,
}: PropsWithChildren<{ session: Session | null }>) {
  const userId = session?.user.id ?? null;
  const pathname = usePathname();
  const targetsRef = useRef(new Map<string, OnboardingTargetRegistration>());
  const requestedContextRef = useRef<ContextualModule | null>(null);
  const profileImpactRequestedRef = useRef(false);
  const [steps, setSteps] = useState<OnboardingStep[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [active, setActive] = useState(false);
  const [activeModule, setActiveModule] = useState<OnboardingModule | null>(null);
  const [state, setState] = useState<OnboardingState | null>(null);
  const [eligibleForFeed, setEligibleForFeed] = useState(false);
  const [presentationPhase, setPresentationPhase] =
    useState<OnboardingPresentationPhase>('hidden');

  const rawCurrentStep = active ? steps[currentStepIndex] ?? null : null;

  const resetActiveFlow = useCallback(() => {
    setActive(false);
    setActiveModule(null);
    setPresentationPhase('hidden');
    setCurrentStepIndex(0);
    setSteps([]);
  }, []);

  const finishOnboarding = useCallback(
    async (persist = true) => {
      const module = activeModule;
      resetActiveFlow();

      if (!userId || !module || !persist) return;

      await persistOnboardingModuleCompleted(userId, module);
      if (module === 'echoImpact') await clearEchoImpactOnboardingPending(userId);
      setState((previous) =>
        previous
          ? {
              ...previous,
              feedCompleted: module === 'feed' ? true : previous.feedCompleted,
              whispersCompleted: module === 'whispers' ? true : previous.whispersCompleted,
              profileCompleted: module === 'profile' ? true : previous.profileCompleted,
              echoImpactCompleted:
                module === 'echoImpact' ? true : previous.echoImpactCompleted,
              echoImpactPending:
                module === 'echoImpact' ? false : previous.echoImpactPending,
              searchCompleted: module === 'search' ? true : previous.searchCompleted,
            }
          : previous
      );

      if (module === 'feed') {
        setEligibleForFeed(false);
        await clearNewAccountOnboardingEligibility(userId);
      }
    }, [activeModule, resetActiveFlow, userId]
  );

  const startFlow = useCallback(
    (module: OnboardingModule, nextSteps: OnboardingStep[], options?: { restart?: boolean }) => {
      if (!userId || !nextSteps.length || active) return;
      if (!options?.restart && state && moduleCompleted(state, module)) return;

      setActiveModule(module);
      setSteps(nextSteps);
      setCurrentStepIndex(0);
      setPresentationPhase('moving');
      setActive(true);
    },
    [active, state, userId]
  );

  const refreshState = useCallback(async () => {
    if (!userId) {
      setState(null);
      setEligibleForFeed(false);
      resetActiveFlow();
      return;
    }

    const [nextState, eligible] = await Promise.all([
      readOnboardingState(userId),
      consumeNewAccountOnboardingEligibility(userId),
    ]);
    setState(nextState);
    setEligibleForFeed(eligible && !nextState.feedCompleted);
  }, [resetActiveFlow, userId]);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  const startFeedOnboarding = useCallback(() => {
    if (eligibleForFeed && state && !state.feedCompleted) {
      startFlow('feed', FEED_ONBOARDING_STEPS);
    }
  }, [eligibleForFeed, startFlow, state]);

  const completeFeedOnboarding = useCallback(async () => {
    if (activeModule === 'feed') await finishOnboarding(true);
  }, [activeModule, finishOnboarding]);

  const requestContextualOnboarding = useCallback(
    (module: ContextualModule) => {
      if (__DEV__ && module === 'profile') {
        console.debug('[onboarding] Profile module start requested');
      }
      requestedContextRef.current = module;
      if (pathname === routeForModule(module)) {
        setTimeout(() => screenReady(module), 220);
      }
    },
    // screenReady is intentionally resolved from the current provider instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pathname]
  );

  const requestWhispersOnboarding = useCallback(
    () => requestContextualOnboarding('whispers'),
    [requestContextualOnboarding]
  );
  const requestProfileOnboarding = useCallback(
    () => requestContextualOnboarding('profile'),
    [requestContextualOnboarding]
  );
  const requestSearchOnboarding = useCallback(
    () => requestContextualOnboarding('search'),
    [requestContextualOnboarding]
  );

  const registerTarget = useCallback((registration: OnboardingTargetRegistration) => {
    targetsRef.current.set(registration.id, registration);
    return () => {
      if (targetsRef.current.get(registration.id) === registration) {
        targetsRef.current.delete(registration.id);
      }
    };
  }, []);

  const measureTarget = useCallback(async (targetId: string) => {
    return targetsRef.current.get(targetId)?.measure() ?? null;
  }, []);

  const screenReady = useCallback(
    async (module: ContextualModule) => {
      if (requestedContextRef.current !== module || active || !userId) return;
      requestedContextRef.current = null;
      if (__DEV__ && module === 'profile') {
        console.debug('[onboarding] Profile screen focused');
      }
      const nextState = await readOnboardingState(userId);
      setState(nextState);

      if (module === 'whispers') {
        startFlow('whispers', WHISPERS_ONBOARDING_STEPS);
        return;
      }

      if (module === 'search') {
        startFlow('search', SEARCH_ONBOARDING_STEPS);
        return;
      }

      if (__DEV__) {
        console.debug('[onboarding] Profile own-profile eligibility result', {
          eligible: !nextState.profileCompleted,
        });
      }
      if (!nextState.profileCompleted) {
        profileImpactRequestedRef.current = false;
        const targetReady = await waitForOnboardingTarget(
          measureTarget,
          PROFILE_ONBOARDING_TARGET_ORDER
        );
        if (__DEV__) {
          console.debug('[onboarding] Profile target ready before module start', targetReady);
        }
        startFlow('profile', PROFILE_ONBOARDING_STEPS);
      } else if (nextState.echoImpactPending && !nextState.echoImpactCompleted) {
        profileImpactRequestedRef.current = true;
      }
    },
    [active, measureTarget, startFlow, userId]
  );

  const startPendingEchoImpactOnboarding = useCallback(() => {
    if (!profileImpactRequestedRef.current || !state || active || state.profileCompleted === false) return;
    if (state.echoImpactPending && !state.echoImpactCompleted) {
      profileImpactRequestedRef.current = false;
      startFlow('echoImpact', ECHO_IMPACT_ONBOARDING_STEPS);
    }
  }, [active, startFlow, state]);

  const director = useOnboardingDirector({
    active,
    currentStep: rawCurrentStep,
    currentStepIndex,
    steps,
    presentationPhase,
    setCurrentStepIndex,
    setPresentationPhase,
    measureTarget,
    finish: finishOnboarding,
  });

  const currentStep = useMemo(
    () => buildPresentedStep(rawCurrentStep, currentStepIndex, steps.length, director),
    [currentStepIndex, director, rawCurrentStep, steps.length]
  );

  const value = useMemo(
    () => ({
      active,
      currentStep,
      currentStepIndex,
      steps,
      startFeedOnboarding,
      completeFeedOnboarding,
      requestWhispersOnboarding,
      requestProfileOnboarding,
      requestSearchOnboarding,
      screenReady,
      startPendingEchoImpactOnboarding,
      start: (nextSteps: OnboardingStep[], options?: { restart?: boolean }) =>
        startFlow('feed', nextSteps, options),
      next: director.next,
      previous: director.previous,
      skip: director.skip,
      finish: director.finish,
      dismiss: director.dismiss,
      navigate: director.navigate,
      notify: director.notify,
      registerTarget,
      measureTarget,
    }),
    [
      active,
      completeFeedOnboarding,
      currentStep,
      currentStepIndex,
      director,
      measureTarget,
      registerTarget,
      requestProfileOnboarding,
      requestSearchOnboarding,
      requestWhispersOnboarding,
      screenReady,
      startFeedOnboarding,
      startFlow,
      startPendingEchoImpactOnboarding,
      steps,
    ]
  );

  return (
    <OnboardingContext.Provider value={value}>
      {children}
      <OnboardingBootstrap start={startFeedOnboarding} />
      <OnboardingOverlay
        active={active}
        currentStep={currentStep}
        guidanceVisible={presentationPhase === 'settled'}
        userId={userId}
        measureTarget={measureTarget}
        onAbort={director.dismiss}
        onSkip={director.skip}
        onNext={director.next}
      />
    </OnboardingContext.Provider>
  );
}

function moduleCompleted(state: OnboardingState, module: OnboardingModule) {
  return {
    feed: state.feedCompleted,
    whispers: state.whispersCompleted,
    profile: state.profileCompleted,
    echoImpact: state.echoImpactCompleted,
    search: state.searchCompleted,
  }[module];
}

function routeForModule(module: ContextualModule) {
  if (module === 'whispers') return '/(tabs)/whispers';
  if (module === 'search') return '/(tabs)/search';
  return '/(tabs)/frequency';
}

async function waitForOnboardingTarget(
  measureTarget: (targetId: string) => Promise<OnboardingTargetFrame | null>,
  targetIds: readonly string[]
) {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    for (const targetId of targetIds) {
      const frame = await measureTarget(targetId);
      if (
        frame &&
        Number.isFinite(frame.pageX) &&
        Number.isFinite(frame.pageY) &&
        Number.isFinite(frame.width) &&
        Number.isFinite(frame.height) &&
        frame.width > 0 &&
        frame.height > 0
      ) {
        return true;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return false;
}

function buildPresentedStep(
  step: OnboardingStep | null,
  currentStepIndex: number,
  totalSteps: number,
  director: Pick<OnboardingContextValue, 'next' | 'skip' | 'dismiss' | 'navigate'>
) {
  if (!step) return null;
  return { ...step, guidance: resolveGuidance(step, currentStepIndex, totalSteps, director) };
}

function resolveGuidance(
  step: OnboardingStep,
  currentStepIndex: number,
  totalSteps: number,
  director: Pick<OnboardingContextValue, 'next' | 'skip' | 'dismiss' | 'navigate'>
): OnboardingGuidanceContent | undefined {
  const title = step.title ?? step.guidance?.title;
  const description = step.description ?? step.guidance?.description;
  if (!title || !description) return step.guidance;

  return {
    ...step.guidance,
    title,
    description,
    primaryActionLabel: step.primaryButtonLabel ?? step.guidance?.primaryActionLabel ?? '',
    secondaryActionLabel:
      step.secondaryButtonLabel ?? step.guidance?.secondaryActionLabel ?? 'Skip',
    onPrimaryAction:
      step.guidance?.onPrimaryAction ??
      (step.primaryActionRoute
        ? () => director.navigate(step.primaryActionRoute as string)
        : step.completionCondition?.type === 'primaryAction' || step.type === 'informational'
          ? () => void director.next()
          : undefined),
    onSecondaryAction: step.guidance?.onSecondaryAction ?? (() => void director.skip()),
    progress:
      step.guidance?.progress ??
      (totalSteps > 1 ? { current: currentStepIndex + 1, total: totalSteps } : undefined),
  };
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) throw new Error('useOnboarding must be used within OnboardingProvider');
  return context;
}

export function useOnboardingTarget(id: string, ref: RefObject<View | null>) {
  const { registerTarget } = useOnboarding();
  useEffect(() => {
    const target = ref.current;
    if (!target) return;
    if (__DEV__) console.debug('[onboarding] target registered', id);
    return registerTarget({
      id,
      measure: () =>
        new Promise((resolve) => {
          target.measureInWindow((pageX, pageY, width, height) => {
            resolve(width && height ? { x: 0, y: 0, pageX, pageY, width, height } : null);
          });
        }),
    });
  }, [id, ref, registerTarget]);
}
