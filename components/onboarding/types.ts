import type { ReactNode } from 'react';
import type { LayoutRectangle } from 'react-native';

export type OnboardingStepType =
  | 'informational'
  | 'waitForTap'
  | 'waitForLongPress'
  | 'waitForNavigation'
  | 'waitForRecording'
  | 'automatic'
  | 'manual'
  | 'final';

export type OnboardingHaptic = 'light' | 'medium' | 'selection' | 'success';

export type OnboardingTransition = {
  cardExitMs?: number;
  spotlightPauseMs?: number;
  cardEnterDelayMs?: number;
};

export type OnboardingNavigationAction = {
  type: 'push' | 'replace' | 'back';
  href?: string;
};

export type OnboardingCompletionCondition =
  | { type: 'primaryAction' }
  | { type: 'tap'; targetId?: string }
  | { type: 'longPress'; targetId?: string }
  | { type: 'navigation'; route?: string }
  | { type: 'recordingStarted' }
  | { type: 'recordingCompleted' }
  | { type: 'dock_record_button_pressed' }
  | { type: 'whispers_opened' }
  | { type: 'profile_opened' }
  | { type: 'delay'; ms: number }
  | { type: 'manual' };

export type OnboardingSpotlightBehavior = {
  disabled?: boolean;
  allowTargetInteraction?: boolean;
  interactionRequired?: boolean;
  skipIfMissing?: boolean;
  dismissOnBackgroundTap?: boolean;
};

export type OnboardingPresentationPhase = 'hidden' | 'moving' | 'settled';

export type OnboardingEvent =
  | { type: 'tap'; targetId?: string }
  | { type: 'longPress'; targetId?: string }
  | { type: 'navigation'; route?: string }
  | { type: 'recordingStarted' }
  | { type: 'recordingCompleted' }
  | { type: 'dock_record_button_pressed'; targetId?: string }
  | { type: 'whispers_opened'; targetId?: string }
  | { type: 'profile_opened'; targetId?: string };

export type OnboardingGuidanceContent = {
  title: string;
  description: string;
  primaryActionLabel: string;
  onPrimaryAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  progress?: {
    current: number;
    total: number;
  };
};

export type OnboardingStep = {
  id: string;
  type: OnboardingStepType;
  targetId?: string;
  title?: string;
  description?: string;
  primaryButtonLabel?: string;
  primaryActionRoute?: string;
  secondaryButtonLabel?: string;
  spotlight?: OnboardingSpotlightBehavior;
  allowTargetInteraction?: boolean;
  interactionRequired?: boolean;
  completionCondition?: OnboardingCompletionCondition;
  transition?: OnboardingTransition;
  delayBeforeShowMs?: number;
  haptic?: OnboardingHaptic;
  persistOnPrimaryAction?: boolean;
  navigationAction?: OnboardingNavigationAction;
  guidance?: OnboardingGuidanceContent;
  content?: ReactNode;
};

export type OnboardingTargetFrame = LayoutRectangle & {
  pageX: number;
  pageY: number;
};

export type OnboardingTargetRegistration = {
  id: string;
  measure: () => Promise<OnboardingTargetFrame | null>;
};
