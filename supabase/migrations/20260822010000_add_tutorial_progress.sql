-- Tutorial progress: which tutorial moments a person has been shown.
--
-- A row per (user, moment) rather than a column per moment. The system this
-- replaces used eight booleans on profiles, which meant every new tutorial
-- step needed a migration and a column grant -- and one of them shipped
-- half-wired because that step was missed. Here a new moment is a string in
-- the client and nothing else.
--
-- Composite primary key mirrors dismissed_suggestions' (entity, user) shape:
-- it IS the uniqueness constraint on (user_id, moment_key), and it doubles as
-- the lookup index since user_id is its leading column. No separate unique
-- index is needed.
create table if not exists public.tutorial_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  moment_key text not null,
  -- Nullable on purpose: a row can exist for a moment that was started but
  -- not finished. Only a non-null completed_at means "seen it, don't show it
  -- again", so an interrupted tutorial returns rather than being lost.
  completed_at timestamptz,
  primary key (user_id, moment_key)
);

alter table public.tutorial_progress enable row level security;

-- Four policies rather than one blanket rule. Delete is its own policy
-- because "Show tutorials again" in Settings is the only thing that uses it,
-- and it should stay visible in the schema that clients can remove these rows.
drop policy if exists "Users can view their own tutorial progress" on public.tutorial_progress;
create policy "Users can view their own tutorial progress"
  on public.tutorial_progress
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can record their own tutorial progress" on public.tutorial_progress;
create policy "Users can record their own tutorial progress"
  on public.tutorial_progress
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Update as well as insert, so marking a moment complete can be a single
-- upsert rather than a read followed by a branch.
drop policy if exists "Users can update their own tutorial progress" on public.tutorial_progress;
create policy "Users can update their own tutorial progress"
  on public.tutorial_progress
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can clear their own tutorial progress" on public.tutorial_progress;
create policy "Users can clear their own tutorial progress"
  on public.tutorial_progress
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- NO SEED, DELIBERATELY.
--
-- The previous version of this table backfilled a completed 'welcome' row for
-- every existing profile, so that dropping the old onboarding flags would not
-- make established users look new. That is not wanted here: there are no real
-- users yet, and every current account should meet the new tutorial from the
-- start, welcome included. An empty table is the correct initial state, not an
-- oversight.
