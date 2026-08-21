-- Restores the original onboarding state and removes the tutorial rebuild.
--
-- Undoes 20260819040000 (which dropped the eight onboarding columns and
-- rewrote the signup trigger) and 20260819050000 (which added
-- tutorial_progress). A fresh forward migration rather than an edit to
-- either of those: both are applied in production and applied migrations
-- are never rewritten.
--
-- DATA NOTE: the original column values are gone. They were dropped
-- without a backup -- `supabase db dump` requires Docker, which was not
-- available -- so every existing profile comes back with the defaults.
-- Practically that means all existing users are treated as never having
-- completed onboarding and will see it again from the start. There is no
-- way to recover the previous values.

-- 1. The eight columns, exactly as 20260731000000 and 20260802000000
--    created them.
alter table public.profiles
  add column if not exists onboarding_completed boolean not null default false,
  add column if not exists feed_onboarding_completed boolean not null default false,
  add column if not exists whispers_onboarding_completed boolean not null default false,
  add column if not exists profile_onboarding_completed boolean not null default false,
  add column if not exists echo_impact_onboarding_completed boolean not null default false,
  add column if not exists echo_impact_onboarding_pending boolean not null default false,
  add column if not exists has_posted_first_echo boolean not null default false,
  add column if not exists search_onboarding_completed boolean not null default false;

-- 2. Column-level grants. Dropping a column drops its grants with it, so
--    every one of these has to be reissued. The blanket update privilege
--    stays revoked; only these columns are writable by their owner.
grant update (
  feed_onboarding_completed,
  whispers_onboarding_completed,
  profile_onboarding_completed,
  echo_impact_onboarding_completed,
  echo_impact_onboarding_pending,
  has_posted_first_echo
)
on table public.profiles to authenticated;

grant update (search_onboarding_completed)
  on table public.profiles to authenticated;

-- Restores the signup contract's grant from 20260719010000, which named
-- onboarding_completed alongside columns that survived the drop.
grant update (username, bio, avatar_url, onboarding_completed)
  on table public.profiles
  to authenticated;

-- 3. The signup trigger, back to seeding onboarding_completed on every new
--    profile. Identical to 20260719010000's version.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requested_username text;
begin
  requested_username := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));

  if requested_username = ''
    or char_length(requested_username) not between 3 and 20
    or requested_username !~ '^[a-z0-9_]+$'
    or exists (
      select 1
      from public.profiles
      where username = requested_username
    )
  then
    requested_username := null;
  end if;

  insert into public.profiles (
    id,
    username,
    bio,
    created_at,
    onboarding_completed
  )
  values (
    new.id,
    requested_username,
    '',
    now(),
    false
  )
  on conflict (id) do update
  set username = coalesce(public.profiles.username, excluded.username),
      bio = coalesce(public.profiles.bio, ''),
      onboarding_completed = coalesce(public.profiles.onboarding_completed, false);

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon;
revoke all on function public.handle_new_user() from authenticated;

-- 4. The tutorial table. Its policies go with it.
drop table if exists public.tutorial_progress;
