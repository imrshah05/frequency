-- Tutorial progress: which contextual tutorial moments a person has seen.
--
-- Replaces the eight boolean columns dropped in 20260819040000. A row per
-- (user, moment) rather than a column per moment, so adding a tutorial is
-- a string in the client and not a migration -- the old design needed a
-- schema change and a grant for every new step, which is how the search
-- one ended up half-wired.
--
-- Composite primary key mirrors dismissed_suggestions' (entity, user)
-- shape: it is the uniqueness constraint on (user_id, moment_key), and it
-- doubles as the lookup index since user_id is its leading column.
create table if not exists public.tutorial_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  moment_key text not null,
  -- Nullable on purpose: a row can exist for a moment that was started but
  -- not finished. Only a non-null completed_at means "seen it, don't show
  -- it again", so an interrupted tutorial returns rather than being lost.
  completed_at timestamptz,
  primary key (user_id, moment_key)
);

alter table public.tutorial_progress enable row level security;

-- Four policies, not one blanket rule. Delete is its own policy because
-- "Show tutorials again" in Settings is the only thing that uses it, and
-- it should stay visible in the schema that clients can remove these rows.
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

-- Update as well as insert so marking a moment complete can be a single
-- upsert, rather than a read followed by a branch.
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

-- Everyone who already has an account counts as having been welcomed.
--
-- The welcome screen is a first-launch greeting. Without this, dropping
-- onboarding_completed in 20260819040000 would make every existing user
-- look new, and the next time any of them opened the app they would be
-- greeted as if they had just signed up.
--
-- Only 'welcome' is seeded. The contextual moments are genuinely new and
-- describe screens nobody has been shown before, so those should run for
-- existing users -- that is the point of building them.
--
-- Reversible in one statement if these should have been shown after all:
--   delete from public.tutorial_progress where moment_key = 'welcome';
insert into public.tutorial_progress (user_id, moment_key, completed_at)
select id, 'welcome', now()
from public.profiles
on conflict (user_id, moment_key) do nothing;
