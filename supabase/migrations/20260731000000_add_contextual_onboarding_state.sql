alter table public.profiles
  add column if not exists feed_onboarding_completed boolean not null default false,
  add column if not exists whispers_onboarding_completed boolean not null default false,
  add column if not exists profile_onboarding_completed boolean not null default false,
  add column if not exists echo_impact_onboarding_completed boolean not null default false,
  add column if not exists echo_impact_onboarding_pending boolean not null default false,
  add column if not exists has_posted_first_echo boolean not null default false;

grant update (
  feed_onboarding_completed,
  whispers_onboarding_completed,
  profile_onboarding_completed,
  echo_impact_onboarding_completed,
  echo_impact_onboarding_pending,
  has_posted_first_echo
)
on table public.profiles to authenticated;
