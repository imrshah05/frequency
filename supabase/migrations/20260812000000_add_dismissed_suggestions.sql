-- Suggested Tune-Ins (Phase 1, data layer only): tracks which suggested
-- candidates a user has dismissed, so getSuggestedTuneIns can exclude them.
-- Composite primary key mirrors whisper_group_message_reads' (entity, user)
-- shape -- one row per (user, suggested candidate), no surrogate id needed.
create table if not exists public.dismissed_suggestions (
  user_id uuid not null references auth.users(id) on delete cascade,
  suggested_user_id uuid not null references auth.users(id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (user_id, suggested_user_id)
);

-- Hot path: getSuggestedTuneIns looks up everything a user has dismissed.
create index if not exists dismissed_suggestions_user_idx
  on public.dismissed_suggestions(user_id);

alter table public.dismissed_suggestions enable row level security;

drop policy if exists "Users can view their own dismissed suggestions" on public.dismissed_suggestions;
create policy "Users can view their own dismissed suggestions"
  on public.dismissed_suggestions
  for select
  using (auth.uid() = user_id);

-- Insert and update (not just insert) so re-dismissing a suggestion that
-- resurfaced can bump dismissed_at forward via upsert, rather than being
-- silently ignored.
drop policy if exists "Users can dismiss suggestions for themselves" on public.dismissed_suggestions;
create policy "Users can dismiss suggestions for themselves"
  on public.dismissed_suggestions
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own dismissals" on public.dismissed_suggestions;
create policy "Users can update their own dismissals"
  on public.dismissed_suggestions
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
