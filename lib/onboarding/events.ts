export const ONBOARDING_TARGETS = {
  feedPrimaryEcho: 'feed_primary_echo',
  feedPrimaryEchoCard: 'feed_primary_echo_card',
  dockRecordButton: 'dock_record_button',
  dockProfileButton: 'dock_profile_button',
  profileMainIdentity: 'profile_main_identity',
  profileStatsCard: 'profile_stats_card',
  whispersPrimaryArea: 'whispers_primary_area',
  profileEchoImpact: 'profile_echo_impact',
  profileLiveEcho: 'profile_live_echo',
  searchNearYouCard: 'search_near_you_card',
} as const;

export const ONBOARDING_ROUTES = {
  feed: '/(tabs)',
  whispers: '/(tabs)/whispers',
  frequency: '/(tabs)/frequency',
  search: '/(tabs)/search',
} as const;

export const ONBOARDING_EVENTS = {
  tap: 'tap',
  longPress: 'longPress',
  navigation: 'navigation',
  recordingStarted: 'recordingStarted',
  recordingCompleted: 'recordingCompleted',
  dockRecordButtonPressed: 'dock_record_button_pressed',
  whispersOpened: 'whispers_opened',
  profileOpened: 'profile_opened',
} as const;

export const PROFILE_ONBOARDING_TARGET_ORDER = [
  ONBOARDING_TARGETS.profileMainIdentity,
  ONBOARDING_TARGETS.profileStatsCard,
  ONBOARDING_TARGETS.profileLiveEcho,
] as const;
