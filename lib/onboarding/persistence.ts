import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '@/lib/supabase';

export type OnboardingModule = 'feed' | 'whispers' | 'profile' | 'echoImpact' | 'search';

export type OnboardingState = {
  feedCompleted: boolean;
  whispersCompleted: boolean;
  profileCompleted: boolean;
  echoImpactCompleted: boolean;
  echoImpactPending: boolean;
  searchCompleted: boolean;
};

const CREATED_ACCOUNT_KEY_PREFIX = 'frequency:onboarding:created-account:';
const STATE_KEY_PREFIX = 'frequency:onboarding:state:';

function keyFor(prefix: string, userId: string) {
  return `${prefix}${userId}`;
}

export async function markOnboardingEligibleForNewAccount(userId?: string | null) {
  if (!userId) return;
  await AsyncStorage.setItem(keyFor(CREATED_ACCOUNT_KEY_PREFIX, userId), 'true');
}

export async function consumeNewAccountOnboardingEligibility(userId: string) {
  const value = await AsyncStorage.getItem(keyFor(CREATED_ACCOUNT_KEY_PREFIX, userId));
  return value === 'true';
}

export async function clearNewAccountOnboardingEligibility(userId: string) {
  await AsyncStorage.removeItem(keyFor(CREATED_ACCOUNT_KEY_PREFIX, userId));
}

function stateFromRow(row: Record<string, unknown> | null, legacyCompleted: boolean): OnboardingState {
  // Existing accounts that completed the old linear tutorial must not be shown
  // the new contextual tutorials again.
  if (legacyCompleted) {
    return {
      feedCompleted: true,
      whispersCompleted: true,
      profileCompleted: true,
      echoImpactCompleted: true,
      echoImpactPending: false,
      searchCompleted: true,
    };
  }

  return {
    feedCompleted: row?.feed_onboarding_completed === true,
    whispersCompleted: row?.whispers_onboarding_completed === true,
    profileCompleted: row?.profile_onboarding_completed === true,
    echoImpactCompleted: row?.echo_impact_onboarding_completed === true,
    echoImpactPending: row?.echo_impact_onboarding_pending === true,
    searchCompleted: row?.search_onboarding_completed === true,
  };
}

export async function readOnboardingState(userId: string): Promise<OnboardingState> {
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'onboarding_completed, feed_onboarding_completed, whispers_onboarding_completed, profile_onboarding_completed, echo_impact_onboarding_completed, echo_impact_onboarding_pending, search_onboarding_completed'
    )
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.warn('[onboarding] Failed to read remote state.', error.message);
  }

  return stateFromRow(data as Record<string, unknown> | null, data?.onboarding_completed === true);
}

export async function persistOnboardingModuleCompleted(
  userId: string,
  module: OnboardingModule
) {
  const column = {
    feed: 'feed_onboarding_completed',
    whispers: 'whispers_onboarding_completed',
    profile: 'profile_onboarding_completed',
    echoImpact: 'echo_impact_onboarding_completed',
    search: 'search_onboarding_completed',
  }[module];

  await supabase.from('profiles').update({ [column]: true }).eq('id', userId);
  await AsyncStorage.setItem(keyFor(STATE_KEY_PREFIX, userId), module);
}

export async function queueEchoImpactOnboarding(userId: string) {
  await AsyncStorage.setItem(keyFor(STATE_KEY_PREFIX, userId), 'echo_impact_pending');
  const { error } = await supabase
    .from('profiles')
    .update({ echo_impact_onboarding_pending: true })
    .eq('id', userId);

  if (error) console.warn('[onboarding] Failed to queue Echo Impact.', error.message);
}

export async function clearEchoImpactOnboardingPending(userId: string) {
  await supabase
    .from('profiles')
    .update({ echo_impact_onboarding_pending: false })
    .eq('id', userId);
}

export async function claimFirstEchoOnboarding(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .update({ has_posted_first_echo: true })
    .eq('id', userId)
    .eq('has_posted_first_echo', false)
    .select('id')
    .maybeSingle();

  if (error) {
    console.warn('[onboarding] Failed to claim first Echo.', error.message);
    return false;
  }

  return !!data;
}

export async function resetOnboardingForDevelopment(userId: string) {
  await AsyncStorage.multiRemove([
    keyFor(STATE_KEY_PREFIX, userId),
    keyFor(CREATED_ACCOUNT_KEY_PREFIX, userId),
  ]);

  await supabase
    .from('profiles')
    .update({
      onboarding_completed: false,
      feed_onboarding_completed: false,
      whispers_onboarding_completed: false,
      profile_onboarding_completed: false,
      echo_impact_onboarding_completed: false,
      echo_impact_onboarding_pending: false,
      has_posted_first_echo: false,
      search_onboarding_completed: false,
    })
    .eq('id', userId);
}
