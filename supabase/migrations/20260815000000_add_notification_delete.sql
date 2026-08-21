-- Lets a user permanently remove a single card from their own Activity
-- feed (swipe-to-delete). notifications predates this migration history,
-- so its current RLS isn't visible from tracked SQL -- following the same
-- security-definer pattern as withdraw_tune_in (20260814020000) rather
-- than guessing at (or widening) existing delete permissions: one
-- narrowly-scoped function, callable only for the caller's own
-- recipient_id row.
create or replace function public.delete_notification(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.notifications
  where id = p_notification_id
    and recipient_id = auth.uid();
end;
$$;

revoke all on function public.delete_notification(uuid) from public;
revoke execute on function public.delete_notification(uuid) from anon;
grant execute on function public.delete_notification(uuid) to authenticated;
