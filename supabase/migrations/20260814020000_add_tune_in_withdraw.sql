-- Lets a user withdraw a Tune In request they sent while it's still
-- pending. Tapping "Pending" again on a profile or connections list now
-- cancels the request instead of doing nothing.
--
-- tune_ins and notifications predate this migration history, so their
-- current RLS isn't visible from tracked SQL. Rather than guess at (or
-- widen) existing delete permissions on either table, this follows the
-- same security-definer pattern used for Group Whisper membership
-- (20260806010000): one narrowly-scoped function, callable only as the
-- requester themself, that removes both the pending tune_ins row and the
-- notification it generated -- so withdrawing actually clears the card
-- from the recipient's Activity feed instead of leaving an orphaned one
-- with no live tune_ins row behind it.
create or replace function public.withdraw_tune_in(p_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listener_id uuid := auth.uid();
begin
  if v_listener_id is null or v_listener_id = p_owner_id then
    return;
  end if;

  delete from public.tune_ins
  where listener_id = v_listener_id
    and frequency_owner_id = p_owner_id
    and status = 'pending';

  if found then
    delete from public.notifications
    where actor_id = v_listener_id
      and recipient_id = p_owner_id
      and type = 'tune_in';
  end if;
end;
$$;

revoke all on function public.withdraw_tune_in(uuid) from public;
revoke execute on function public.withdraw_tune_in(uuid) from anon;
grant execute on function public.withdraw_tune_in(uuid) to authenticated;
