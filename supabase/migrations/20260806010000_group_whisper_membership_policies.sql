-- Phase 2: group Whisper creation & membership.
--
-- Phase 1 (20260806000000) only let a group thread's creator seed its
-- initial participants. This phase makes membership flat -- any current
-- member can add or remove any other member, no owner/admin role -- and
-- enforces the "you can only add someone you Tune In with (either
-- direction)" rule in the database, not just the UI, so it holds even if a
-- client calls the API directly. It also lets any participant rename the
-- thread, and deletes a group thread once its last participant leaves.

-- Encapsulates the add-member rule so the INSERT policy stays readable:
--   - the thread creator may seed themself at creation time, or
--   - anyone who is already a member (or is the creator, at creation time)
--     may add someone else, but only if they have an accepted Tune In with
--     that person, in either direction.
create or replace function public.can_add_whisper_group_member(
  p_group_thread_id uuid,
  p_adder_id uuid,
  p_target_user_id uuid
)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select
    (
      p_adder_id = p_target_user_id
      and exists (
        select 1
        from public.whisper_group_threads gt
        where gt.id = p_group_thread_id
          and gt.created_by = p_adder_id
      )
    )
    or
    (
      (
        exists (
          select 1
          from public.whisper_group_threads gt
          where gt.id = p_group_thread_id
            and gt.created_by = p_adder_id
        )
        or exists (
          select 1
          from public.whisper_group_participants gp
          where gp.group_thread_id = p_group_thread_id
            and gp.user_id = p_adder_id
        )
      )
      and exists (
        select 1
        from public.tune_ins ti
        where ti.status = 'accepted'
          and (
            (ti.listener_id = p_adder_id and ti.frequency_owner_id = p_target_user_id)
            or (ti.listener_id = p_target_user_id and ti.frequency_owner_id = p_adder_id)
          )
      )
    );
$$;

revoke all on function public.can_add_whisper_group_member(uuid, uuid, uuid) from public;
revoke execute on function public.can_add_whisper_group_member(uuid, uuid, uuid) from anon;
grant execute on function public.can_add_whisper_group_member(uuid, uuid, uuid) to authenticated;

drop policy if exists "Thread creators can add initial participants" on public.whisper_group_participants;
drop policy if exists "Group participants can add members" on public.whisper_group_participants;
create policy "Group participants can add members"
  on public.whisper_group_participants
  for insert
  with check (public.can_add_whisper_group_member(group_thread_id, auth.uid(), user_id));

-- Flat permissions: any current participant can remove any other
-- participant's row, including their own (leaving is just removing
-- yourself).
drop policy if exists "Group participants can remove members" on public.whisper_group_participants;
create policy "Group participants can remove members"
  on public.whisper_group_participants
  for delete
  using (public.is_whisper_group_participant(group_thread_id, auth.uid()));

-- Any member can rename the group or change its avatar -- no owner role,
-- so no narrower check than "is a participant."
drop policy if exists "Group participants can update group identity" on public.whisper_group_threads;
create policy "Group participants can update group identity"
  on public.whisper_group_threads
  for update
  using (public.is_whisper_group_participant(id, auth.uid()))
  with check (public.is_whisper_group_participant(id, auth.uid()));

-- Once a group's last participant leaves/is removed, delete the thread
-- rather than leaving an orphaned row nobody can ever see again (RLS
-- requires a participant row to view a thread at all). Messages and reads
-- cascade-delete via their existing foreign keys.
create or replace function public.delete_empty_whisper_group_thread()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.whisper_group_participants
    where group_thread_id = old.group_thread_id
  ) then
    delete from public.whisper_group_threads where id = old.group_thread_id;
  end if;

  return old;
end;
$$;

drop trigger if exists whisper_group_participants_cleanup_empty_thread on public.whisper_group_participants;
create trigger whisper_group_participants_cleanup_empty_thread
after delete on public.whisper_group_participants
for each row execute function public.delete_empty_whisper_group_thread();
