-- Stops Echo history from queueing up as reveals.
--
-- The reveal is meant to say "here is what just happened". When it
-- shipped, every Echo a user had ever finished was eligible at once, so
-- the first launch dumped a backlog of full-screen moments for Echoes
-- from weeks earlier. Observed in production: one archive action produced
-- five reveals.
--
-- This is NOT a recency window. A sliding cut-off was tried and reverted
-- on product instruction -- an Echo that finished while its creator was
-- away for a month is still owed its reveal whenever they come back. This
-- is a fixed line in the past that never moves: runs that ended before
-- the feature existed had no reveal to miss.
--
-- The line is tested against when the run actually ENDED, not when the
-- Echo was recorded. So an old Echo archived today does end after the
-- line and does get its moment -- which is what someone archiving an
-- Echo to see its Impact is asking for -- while the same Echo left
-- untouched stays quiet.
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
    -- when this Echo's run ended, vs. when the reveal shipped
    and coalesce(vn.archived_at, vn.created_at + interval '24 hours')
        >= timestamptz '2026-08-19 00:00:00+00'
  order by vn.created_at asc
  limit batch_limit;
$$;

revoke execute on function public.my_unsealed_finished_echoes(int) from anon;
revoke execute on function public.my_unsealed_finished_echoes(int) from public;
grant execute on function public.my_unsealed_finished_echoes(int) to authenticated;

-- One-time reconciliation for the backlog that was already sealed before
-- the line existed. These Impacts stay exactly as they are and remain
-- readable in Archives -- they are only marked as already seen, so they
-- stop arriving as reveals. Nothing that seals from here on is touched.
update public.echo_impacts
   set revealed_at = now()
 where is_final
   and revealed_at is null;
