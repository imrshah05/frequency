-- Fixes group Whisper creation, which has been broken since Phase 2.
--
-- Root cause: whisper_group_threads' SELECT policy requires the viewer to
-- already be a participant (is_whisper_group_participant). The client
-- created a thread with `.insert({...}).select().single()`, which asks
-- Postgres to both INSERT and return the row via RETURNING in one
-- statement. Postgres enforces the table's SELECT policy against that
-- RETURNING output, not just the INSERT policy's WITH CHECK -- and at the
-- moment the thread row is created, its creator has not been added as a
-- participant yet (that's the next, separate insert). So the SELECT
-- policy always failed, and every group creation errored with "new row
-- violates row-level security policy for table whisper_group_threads".
--
-- Fix: do the whole creation -- thread row + creator's own participant row
-- + every other initial participant -- inside one SECURITY DEFINER
-- function, so nothing needs to be read back mid-way through. Membership
-- eligibility (accepted Tune In, in either direction) is still explicitly
-- checked for every non-creator participant via the existing
-- can_add_whisper_group_member helper, since running as SECURITY DEFINER
-- means RLS itself is bypassed inside this function -- the business rule
-- has to be enforced by hand here, the same rule the regular add-member
-- path already enforces via RLS.

create or replace function public.create_group_whisper_thread(
  p_other_participant_ids uuid[]
)
returns public.whisper_group_threads
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator uuid := auth.uid();
  v_thread public.whisper_group_threads;
  v_other_id uuid;
begin
  if v_creator is null then
    raise exception 'Not authenticated.';
  end if;

  insert into public.whisper_group_threads (created_by)
  values (v_creator)
  returning * into v_thread;

  insert into public.whisper_group_participants (group_thread_id, user_id)
  values (v_thread.id, v_creator);

  foreach v_other_id in array p_other_participant_ids loop
    if v_other_id = v_creator then
      continue;
    end if;

    if not public.can_add_whisper_group_member(v_thread.id, v_creator, v_other_id) then
      raise exception 'Cannot add % to this group -- no accepted Tune In.', v_other_id;
    end if;

    insert into public.whisper_group_participants (group_thread_id, user_id)
    values (v_thread.id, v_other_id)
    on conflict do nothing;
  end loop;

  return v_thread;
end;
$$;

revoke all on function public.create_group_whisper_thread(uuid[]) from public;
revoke execute on function public.create_group_whisper_thread(uuid[]) from anon;
grant execute on function public.create_group_whisper_thread(uuid[]) to authenticated;
