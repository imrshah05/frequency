-- Removes the legacy contextual-onboarding state from profiles, for good.
--
-- The tutorial system these columns backed (components/onboarding/* and
-- lib/onboarding/*) has been deleted in full. Nothing reads or writes any of
-- them any more, so they are dropped rather than left as permanently false
-- columns a future reader would have to work out the meaning of.
--
-- WHY THIS LOOKS LIKE A REPEAT OF 20260819040000
--
-- It is, deliberately. Production is already in the post-20260819040000 state:
-- the eight columns do not exist there. 20260821000000 added them back in the
-- repo but was never applied, so the live database and the migration chain
-- disagree. Rather than rewrite either applied or unapplied history, this is a
-- fresh forward migration written to be correct from *both* states -- every
-- statement is `if exists` / idempotent, so it is a no-op against production
-- and a real drop against a database built from the full chain.
--
-- Dropping a column also drops its column-level grants, so the `grant update`
-- statements in 20260731000000, 20260802000000 and 20260821000000 need no
-- separate revoke. The one grant that has to be rewritten by hand is the
-- signup contract's, because it names onboarding_completed alongside columns
-- that survive.

-- The signup trigger seeded onboarding_completed on every new profile. Replaced
-- first, so the function never references a column that is about to disappear.
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
    created_at
  )
  values (
    new.id,
    requested_username,
    '',
    now()
  )
  on conflict (id) do update
  set username = coalesce(public.profiles.username, excluded.username),
      bio = coalesce(public.profiles.bio, '');

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon;
revoke all on function public.handle_new_user() from authenticated;

alter table public.profiles
  drop column if exists onboarding_completed,
  drop column if exists feed_onboarding_completed,
  drop column if exists whispers_onboarding_completed,
  drop column if exists profile_onboarding_completed,
  drop column if exists echo_impact_onboarding_completed,
  drop column if exists echo_impact_onboarding_pending,
  drop column if exists has_posted_first_echo,
  drop column if exists search_onboarding_completed;

-- Re-asserts the signup contract's column grant without onboarding_completed.
-- The blanket update privilege stays revoked; only these three columns are
-- writable by their owner, exactly as before minus the dropped one.
grant update (username, bio, avatar_url)
  on table public.profiles
  to authenticated;
