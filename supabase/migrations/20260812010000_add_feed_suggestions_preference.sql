-- Opt-out preference for the Feed's Suggested Tune-Ins card (Phase 6).
-- Follows the same pattern as the *_onboarding_completed columns: a plain
-- boolean flag on profiles, no separate preferences table exists in this
-- codebase. Defaults true, unlike the onboarding flags, since suggestions
-- are on by default and this is an opt-out, not an opt-in.
alter table public.profiles
  add column if not exists feed_suggestions_enabled boolean not null default true;
