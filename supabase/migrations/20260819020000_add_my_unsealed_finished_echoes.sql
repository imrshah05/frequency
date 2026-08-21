-- The caller's own Echoes whose run has ended but whose Impact was never
-- sealed, oldest first.
--
-- The app seals lazily on launch (see lib/echoImpactReveal.ts and the
-- Phase 4 notes in CLAUDE.md), which means it needs to ask this question
-- on behalf of one user rather than across everyone. unsealed_finished_echoes
-- already answers it for the scheduled sweep, but that one is service-role
-- only and deliberately unscoped, so it cannot be reused here.
--
-- This exists as an RPC rather than a client-side query because the
-- honest form of the question is a LEFT JOIN ... IS NULL, and PostgREST
-- cannot express it. Doing it client-side means fetching every Echo the
-- user has ever recorded and diffing in JavaScript, which grows without
-- limit and eventually will not fit in a URL.
--
-- No time window on purpose. An Echo that finished while its creator was
-- away for a month is still owed its reveal the next time they open the
-- app; batch_limit, not recency, is what keeps a backlog manageable.
create or replace function public.my_unsealed_finished_echoes(batch_limit int default 3)
returns table (voice_note_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select vn.id
  from public.voice_notes vn
  left join public.echo_impacts ei
    on ei.voice_note_id = vn.id
   and ei.is_final
  where vn.user_id = auth.uid()
    and vn.deleted_at is null
    and ei.voice_note_id is null
    and (
      vn.archived_at is not null
      or vn.created_at < now() - interval '24 hours'
    )
  order by vn.created_at asc
  limit batch_limit;
$$;

-- Scoped to auth.uid() internally, so it is safe for end users -- unlike
-- unsealed_finished_echoes, which reads across every account.
revoke execute on function public.my_unsealed_finished_echoes(int) from anon;
revoke execute on function public.my_unsealed_finished_echoes(int) from public;
grant execute on function public.my_unsealed_finished_echoes(int) to authenticated;
