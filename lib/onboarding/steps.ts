import type { OnboardingStep } from '@/components/onboarding/types';

const DEFAULT_TRANSITION = {
  cardExitMs: 220,
  spotlightPauseMs: 0,
  cardEnterDelayMs: 0,
};

const CONTEXTUAL_TRANSITION = {
  cardExitMs: 200,
  spotlightPauseMs: 140,
  cardEnterDelayMs: 80,
};

export const FEED_ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'intro',
    type: 'informational',
    title: 'Welcome to Frequency.',
    description: 'Some thoughts are better spoken.',
    primaryButtonLabel: 'Begin',
    secondaryButtonLabel: "I'll explore myself",
    completionCondition: { type: 'primaryAction' },
    persistOnPrimaryAction: false,
    spotlight: { disabled: true },
    navigationAction: { type: 'replace', href: '/(tabs)' },
    transition: DEFAULT_TRANSITION,
  },
  {
    id: 'record_intro',
    type: 'waitForTap',
    targetId: 'dock_record_button',
    title: 'This is an Echo.',
    description:
      'A short voice note you share with the world. Tap here to explore your recording studio.',
    completionCondition: { type: 'dock_record_button_pressed' },
    guidance: {
      title: 'This is an Echo.',
      description:
        'A short voice note you share with the world. Tap here to explore your recording studio.',
      primaryActionLabel: '',
      secondaryActionLabel: '',
    },
    spotlight: { allowTargetInteraction: true, dismissOnBackgroundTap: true },
    transition: CONTEXTUAL_TRANSITION,
  },
];

export const WHISPERS_ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'whispers_intro',
    type: 'informational',
    targetId: 'whispers_primary_area',
    title: 'Whispers.',
    description: 'Private voice conversations with the people you’re tuned into.',
    primaryButtonLabel: 'Got it',
    secondaryButtonLabel: "I'll explore myself",
    completionCondition: { type: 'primaryAction' },
    spotlight: { allowTargetInteraction: false },
    transition: CONTEXTUAL_TRANSITION,
  },
];

export const PROFILE_ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'profile_intro',
    type: 'informational',
    targetId: 'profile_main_identity',
    title: 'Your Frequency.',
    description: 'See your live Echo, manage your identity, and revisit your impact here.',
    primaryButtonLabel: 'Got it',
    secondaryButtonLabel: "I'll explore myself",
    completionCondition: { type: 'primaryAction' },
    spotlight: { allowTargetInteraction: false },
    transition: CONTEXTUAL_TRANSITION,
  },
];

export const SEARCH_ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'search_intro',
    type: 'informational',
    targetId: 'search_near_you_card',
    title: 'Echoes Near You.',
    description: 'Discover voices close to you, based on where you are.',
    primaryButtonLabel: 'Got it',
    secondaryButtonLabel: "I'll explore myself",
    completionCondition: { type: 'primaryAction' },
    spotlight: { allowTargetInteraction: false },
    transition: CONTEXTUAL_TRANSITION,
  },
  {
    // Rendered by PeopleSuggestionsLayer, not FloatingGuidanceCard -- see
    // OnboardingOverlay.tsx. Advancement is entirely manual (Skip/Continue
    // buttons calling the director directly, or an automatic skip when
    // there are zero candidates), so there's no completionCondition for the
    // director to auto-match against.
    id: 'search_people_suggestions',
    type: 'manual',
    title: 'Voices close to yours.',
    description: "People connected to who you're already tuned into.",
    primaryButtonLabel: 'Continue',
    secondaryButtonLabel: 'Skip',
    spotlight: { disabled: true },
    transition: CONTEXTUAL_TRANSITION,
  },
];

export const ECHO_IMPACT_ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'echo_impact',
    type: 'informational',
    targetId: 'profile_echo_impact',
    title: 'Every Echo leaves an impact.',
    // The Impact is no longer something to go and check while the Echo is
    // running -- it arrives on its own once the 24 hours are over. This
    // step now says when to expect it rather than inviting a tap that no
    // longer exists on the card.
    description: "You'll find out what happened once its 24 hours are over.",
    primaryButtonLabel: 'Got it',
    secondaryButtonLabel: "I'll explore myself",
    completionCondition: { type: 'primaryAction' },
    spotlight: { allowTargetInteraction: false },
    transition: CONTEXTUAL_TRANSITION,
  },
];

// Kept as a development compatibility alias for existing reset controls.
export const FIRST_RUN_ONBOARDING_STEPS = FEED_ONBOARDING_STEPS;
