-- Adds the missing index on tune_ins.frequency_owner_id.
--
-- tune_ins predates this migration history (see 20260814020000), so its
-- current indexes aren't visible from tracked SQL either. A live schema
-- check (referenced in lib/suggestedTuneIns.ts) found an index covering
-- listener_id, but nothing with frequency_owner_id leading -- every
-- follower-count, Suggested Tune-Ins, and notification-fan-out query that
-- filters by frequency_owner_id (see hooks/useTuneIn.ts,
-- lib/mutuals.ts, app/frequency-connections.tsx,
-- app/(tabs)/index.tsx) was doing a partial seq scan. status is included
-- as the second column because almost every one of those call sites
-- filters frequency_owner_id + status = 'accepted' together.
--
-- CONCURRENTLY cannot run inside a transaction block, and Supabase's
-- migration runner wraps each file in one -- so this statement cannot be
-- applied via `supabase db push`. This file exists for tracking/history
-- only. Run the statement below by hand, once, in the Supabase SQL
-- editor against production.

create index concurrently if not exists idx_tune_ins_frequency_owner_id_status
  on public.tune_ins (frequency_owner_id, status);
