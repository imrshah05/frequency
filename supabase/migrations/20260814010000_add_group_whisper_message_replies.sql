alter table public.whisper_group_messages
  add column if not exists reply_to_message_id uuid
    references public.whisper_group_messages(id) on delete set null;

create index if not exists whisper_group_messages_reply_to_message_idx
  on public.whisper_group_messages(reply_to_message_id)
  where reply_to_message_id is not null;

create or replace function public.can_reply_to_whisper_group_message(
  p_reply_to_message_id uuid,
  p_group_thread_id uuid,
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
      from public.whisper_group_messages original_message
      where original_message.id = p_reply_to_message_id
        and original_message.group_thread_id = p_group_thread_id
        and public.is_whisper_group_participant(p_group_thread_id, p_user_id)
    );
$$;

revoke all on function public.can_reply_to_whisper_group_message(uuid, uuid, uuid) from public;
revoke execute on function public.can_reply_to_whisper_group_message(uuid, uuid, uuid) from anon;
grant execute on function public.can_reply_to_whisper_group_message(uuid, uuid, uuid) to authenticated;

drop policy if exists "Group participants can send group messages" on public.whisper_group_messages;
create policy "Group participants can send group messages"
  on public.whisper_group_messages
  for insert
  with check (
    auth.uid() = sender_id
    and public.is_whisper_group_participant(group_thread_id, auth.uid())
    and public.can_reply_to_whisper_group_message(
      reply_to_message_id,
      group_thread_id,
      auth.uid()
    )
  );
