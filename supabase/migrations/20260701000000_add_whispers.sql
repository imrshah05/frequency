create table if not exists public.whisper_threads (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid not null references auth.users(id) on delete cascade,
  user_b_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz,
  constraint whisper_threads_no_self check (user_a_id <> user_b_id)
);

create unique index if not exists whisper_threads_pair_idx
  on public.whisper_threads (
    least(user_a_id, user_b_id),
    greatest(user_a_id, user_b_id)
  );

create table if not exists public.whisper_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.whisper_threads(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  receiver_id uuid not null references auth.users(id) on delete cascade,
  audio_url text,
  duration integer,
  caption text,
  waveform jsonb,
  shared_voice_note_id uuid references public.voice_notes(id) on delete set null,
  message_type text not null default 'voice',
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint whisper_messages_no_self check (sender_id <> receiver_id),
  constraint whisper_caption_length check (caption is null or char_length(caption) <= 60),
  constraint whisper_messages_type_check check (message_type in ('voice', 'shared_echo')),
  constraint whisper_messages_payload_check check (
    (
      message_type = 'voice'
      and audio_url is not null
      and duration is not null
      and shared_voice_note_id is null
    )
    or
    (
      message_type = 'shared_echo'
      and shared_voice_note_id is not null
    )
  )
);

alter table public.whisper_messages
  add column if not exists shared_voice_note_id uuid references public.voice_notes(id) on delete set null,
  add column if not exists message_type text not null default 'voice';

alter table public.whisper_messages
  alter column audio_url drop not null,
  alter column duration drop not null;

alter table public.whisper_messages
  drop constraint if exists whisper_messages_type_check,
  add constraint whisper_messages_type_check
  check (message_type in ('voice', 'shared_echo'));

alter table public.whisper_messages
  drop constraint if exists whisper_messages_payload_check,
  add constraint whisper_messages_payload_check
  check (
    (
      message_type = 'voice'
      and audio_url is not null
      and duration is not null
      and shared_voice_note_id is null
    )
    or
    (
      message_type = 'shared_echo'
      and shared_voice_note_id is not null
    )
  );

create index if not exists whisper_messages_thread_created_idx
  on public.whisper_messages(thread_id, created_at);

create index if not exists whisper_messages_shared_voice_note_idx
  on public.whisper_messages(shared_voice_note_id)
  where shared_voice_note_id is not null;

alter table public.whisper_threads enable row level security;
alter table public.whisper_messages enable row level security;

drop policy if exists "Thread participants can view whisper threads" on public.whisper_threads;
create policy "Thread participants can view whisper threads"
  on public.whisper_threads
  for select
  using (auth.uid() in (user_a_id, user_b_id));

drop policy if exists "Users can create their own whisper threads" on public.whisper_threads;
create policy "Users can create their own whisper threads"
  on public.whisper_threads
  for insert
  with check (auth.uid() in (user_a_id, user_b_id) and user_a_id <> user_b_id);

drop policy if exists "Thread participants can view whisper messages" on public.whisper_messages;
create policy "Thread participants can view whisper messages"
  on public.whisper_messages
  for select
  using (
    exists (
      select 1
      from public.whisper_threads wt
      where wt.id = thread_id
        and auth.uid() in (wt.user_a_id, wt.user_b_id)
    )
  );

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
  );

drop policy if exists "Receivers can mark whisper messages read" on public.whisper_messages;
create policy "Receivers can mark whisper messages read"
  on public.whisper_messages
  for update
  using (auth.uid() = receiver_id)
  with check (auth.uid() = receiver_id);

create table if not exists public.echo_events (
  id uuid primary key default gen_random_uuid(),
  voice_note_id uuid not null references public.voice_notes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  created_at timestamptz not null default now()
);

create index if not exists echo_events_voice_note_created_idx
  on public.echo_events(voice_note_id, created_at);

alter table public.echo_events enable row level security;

drop policy if exists "Users can insert their own echo events" on public.echo_events;
create policy "Users can insert their own echo events"
  on public.echo_events
  for insert
  with check (auth.uid() = user_id);

create or replace function public.touch_whisper_thread()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.whisper_threads
  set updated_at = now(),
      last_message_at = new.created_at
  where id = new.thread_id;

  return new;
end;
$$;

drop trigger if exists whisper_messages_touch_thread on public.whisper_messages;
create trigger whisper_messages_touch_thread
after insert on public.whisper_messages
for each row execute function public.touch_whisper_thread();

do $$
declare
  constraint_name text;
begin
  select conname
    into constraint_name
  from pg_constraint
  where conrelid = 'public.notifications'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%type%';

  if constraint_name is not null then
    execute format('alter table public.notifications drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.notifications
  add constraint notifications_type_check
  check (type in ('tune_in', 'comment', 'reaction', 'whisper'));
