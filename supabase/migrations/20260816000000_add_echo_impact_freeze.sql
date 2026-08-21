-- Freezes an Echo's Impact once its 24h live run is over.
--
-- Until now an Impact was only ever produced by the owner tapping
-- Generate, and any Echo that reached Archives without that tap had no
-- stored Impact at all -- the Archives screen silently recomputed one
-- from live data on every open, so an Echo's "final" story kept drifting
-- as late events landed. is_final marks the sealed, permanent record.
--
-- Sealing is done by the scheduled sweep in
-- supabase/functions/generate-echo-impact (see the MANUAL STEP note at
-- the top of that file). It is not a trigger, because the common way an
-- Echo finishes -- its created_at simply ageing past 24 hours -- changes
-- no row and so fires no trigger.
--
-- While an Echo is still live its Impact stays is_final = false and may
-- be regenerated freely; that row is a preview, not the record.

alter table public.echo_impacts
  add column if not exists is_final boolean not null default false;

-- The sweep asks "which finished Echoes are not sealed yet" on every run.
create index if not exists echo_impacts_is_final_idx
  on public.echo_impacts (voice_note_id)
  where is_final;

-- Feeds the sweep. Doing the "finished but not yet sealed" test in SQL
-- keeps each run bounded: the alternative is loading every sealed row
-- into the function to diff client-side, which grows without limit, and
-- paging voice_notes blindly would let an older backlog sit behind a
-- window of already-sealed rows forever.
create or replace function public.unsealed_finished_echoes(batch_limit int default 50)
returns setof public.voice_notes
language sql
stable
security definer
set search_path = public
as $$
  select vn.*
  from public.voice_notes vn
  left join public.echo_impacts ei
    on ei.voice_note_id = vn.id
   and ei.is_final
  where vn.deleted_at is null
    and ei.voice_note_id is null
    and (
      vn.archived_at is not null
      or vn.created_at < now() - interval '24 hours'
    )
  order by vn.created_at desc
  limit batch_limit;
$$;

-- Only the sweep (service_role) may call this; it deliberately reads
-- across every user's Echoes, so no end-user role should reach it.
revoke execute on function public.unsealed_finished_echoes(int) from anon;
revoke execute on function public.unsealed_finished_echoes(int) from public;
revoke execute on function public.unsealed_finished_echoes(int) from authenticated;

-- A sealed Impact is permanent. The owner keeps full read access, and the
-- existing insert/update policies are otherwise unchanged, but no client
-- may edit or un-seal a row once it is final -- only the service role
-- (the sweep) writes these, and it bypasses RLS.
drop policy if exists "Echo owners can update their echo impacts" on public.echo_impacts;
create policy "Echo owners can update their echo impacts"
  on public.echo_impacts
  for update
  using (
    auth.uid() = user_id
    and is_final = false
    and exists (
      select 1
      from public.voice_notes vn
      where vn.id = voice_note_id
        and vn.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id
    and is_final = false
    and exists (
      select 1
      from public.voice_notes vn
      where vn.id = voice_note_id
        and vn.user_id = auth.uid()
    )
  );
