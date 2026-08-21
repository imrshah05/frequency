alter table public.whisper_messages
  add column if not exists reply_to_message_id uuid
    references public.whisper_messages(id) on delete set null;

create index if not exists whisper_messages_reply_to_message_idx
  on public.whisper_messages(reply_to_message_id)
  where reply_to_message_id is not null;

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
    and (
      reply_to_message_id is null
      or exists (
        select 1
        from public.whisper_messages original_message
        where original_message.id = public.whisper_messages.reply_to_message_id
          and original_message.thread_id = public.whisper_messages.thread_id
          and original_message.message_type = 'voice'
          and original_message.audio_url is not null
          and original_message.duration is not null
      )
    )
  );
