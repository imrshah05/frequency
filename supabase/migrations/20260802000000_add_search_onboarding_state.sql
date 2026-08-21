alter table public.profiles
  add column if not exists search_onboarding_completed boolean not null default false;

grant update (
  search_onboarding_completed
)
on table public.profiles to authenticated;
