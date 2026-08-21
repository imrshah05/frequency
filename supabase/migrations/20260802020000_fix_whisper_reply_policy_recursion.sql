-- Fixes "infinite recursion detected in policy for relation whisper_messages".
-- The INSERT policy added in 20260802010000 validated reply_to_message_id by
-- querying public.whisper_messages from inside its own WITH CHECK expression.
-- Postgres cannot evaluate that self-reference without re-entering the same
-- policy, so it fails outright. A SECURITY DEFINER helper runs the same
-- validation outside the policy's RLS context, breaking the cycle.

create or replace function public.can_reply_to_whisper_message(
  p_reply_to_message_id uuid,
  p_thread_id uuid,
  p_user_id uuid
)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select
    p_reply_to_message_id is null
    or exists (
      select 1
      from public.whisper_messages original_message
      join public.whisper_threads wt on wt.id = original_message.thread_id
      where original_message.id = p_reply_to_message_id
        and original_message.thread_id = p_thread_id
        and original_message.message_type = 'voice'
        and original_message.audio_url is not null
        and original_message.duration is not null
        and p_user_id in (wt.user_a_id, wt.user_b_id)
    );
$$;

revoke all on function public.can_reply_to_whisper_message(uuid, uuid, uuid) from public;
grant execute on function public.can_reply_to_whisper_message(uuid, uuid, uuid) to authenticated;

drop policy if exists "Senders can insert whisper messages in their threads" on public.whisper_messages;
create policy "Senders can insert whisper messages in their threads"
  on public.whisper_messages
  for insert
  with check (
    auth.uid() = sender_id
    and exists (
      select 1
      from public.whisper_threads wt
      where wt.id = thread_id
        and sender_id in (wt.user_a_id, wt.user_b_id)
        and receiver_id in (wt.user_a_id, wt.user_b_id)
        and sender_id <> receiver_id
    )
    and public.can_reply_to_whisper_message(reply_to_message_id, thread_id, auth.uid())
  );
