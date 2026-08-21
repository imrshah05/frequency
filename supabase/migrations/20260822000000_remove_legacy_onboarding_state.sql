-- Removes the legacy onboarding/tutorial state, for good.
--
-- Both generations of it. The contextual tutorial (components/onboarding/*
-- and lib/onboarding/*) and the tutorial_progress rebuild that was meant to
-- replace it have each been deleted in full; nothing in the app reads or
-- writes either any more. A new onboarding system will be built separately
-- and will bring its own schema.
--
-- THE ONLY STATEMENT HERE THAT PRODUCTION STRICTLY NEEDS is the
-- `drop table public.tutorial_progress` at the bottom. Everything above it
-- is an idempotent safety net, and is deliberate -- see below.
--
-- WHY THE COLUMN AND TRIGGER WORK IS REPEATED FROM 20260819040000
--
-- Because this repo has already been caught disagreeing with its own
-- database once. 20260821000000 restored these eight columns in the chain
-- and was never applied; production had been sitting in the
-- post-20260819040000 state the whole time, with client code reading
-- columns that were not there. That migration has now been deleted (it was
-- never applied anywhere, so it was a pending instruction rather than
-- history), but the lesson stands: the chain is not proof of what the live
-- schema holds.
--
-- So this migration asserts the end state rather than assuming it. Every
-- statement is `if exists` / `create or replace`, which makes the whole
-- thing a no-op against any database that is already correct -- including
-- production and including a fresh build from the full chain -- and a real
-- repair against one that is not.
--
-- Dropping a column also drops its column-level grants, so the `grant
-- update` statements in 20260731000000 and 20260802000000 need no separate
-- revoke. The one grant that has to be rewritten by hand is the signup
-- contract's, because it names onboarding_completed alongside columns that
-- survive.

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

-- The tutorial_progress rebuild from 20260819050000. This is the statement
-- production actually needs: that migration IS applied there, so the table
-- is live, holds a seeded 'welcome' row per profile, and is now referenced
-- by nothing.
--
-- Its four RLS policies and its composite primary key are owned by the
-- table and go with it, so no separate drops are needed.
drop table if exists public.tutorial_progress;
