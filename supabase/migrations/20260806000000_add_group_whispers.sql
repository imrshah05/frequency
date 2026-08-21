-- Group Whispers: additive support for 3+ participant Whisper threads.
-- This is intentionally a separate set of tables from whisper_threads /
-- whisper_messages. Those tables model exactly two participants via
-- user_a_id/user_b_id and sender_id/receiver_id and are not touched here.
-- In a group thread, Echoes drop in chronologically and are visible to every
-- participant, so there is no single receiver_id or single read_at per
-- message -- read state is tracked per participant instead.

create table if not exists public.whisper_group_threads (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  title text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz,
  constraint whisper_group_threads_title_length check (title is null or char_length(title) <= 60)
);

-- title/avatar_url are nullable by design: when unset, the app derives a
-- display name/avatar from participants (e.g. "You, Alex & 2 others"),
-- mirroring how group chats in most messaging apps behave before anyone
-- names the thread.

create table if not exists public.whisper_group_participants (
  id uuid primary key default gen_random_uuid(),
  group_thread_id uuid not null references public.whisper_group_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  constraint whisper_group_participants_unique unique (group_thread_id, user_id)
);

create index if not exists whisper_group_participants_user_idx
  on public.whisper_group_participants(user_id);

create index if not exists whisper_group_participants_thread_idx
  on public.whisper_group_participants(group_thread_id);

create table if not exists public.whisper_group_messages (
  id uuid primary key default gen_random_uuid(),
  group_thread_id uuid not null references public.whisper_group_threads(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  audio_url text not null,
  duration integer not null,
  caption text,
  waveform jsonb,
  created_at timestamptz not null default now(),
  constraint whisper_group_caption_length check (caption is null or char_length(caption) <= 60)
);

create index if not exists whisper_group_messages_thread_created_idx
  on public.whisper_group_messages(group_thread_id, created_at);

-- Per-participant, per-Echo listened state. Unlike whisper_messages.read_at
-- (a single flag, valid because there is exactly one other participant),
-- a group Echo needs one row per listener so the app can know who has
-- (and hasn't) heard a given drop.
create table if not exists public.whisper_group_message_reads (
  group_message_id uuid not null references public.whisper_group_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (group_message_id, user_id)
);

create index if not exists whisper_group_message_reads_user_idx
  on public.whisper_group_message_reads(user_id);

alter table public.whisper_group_threads enable row level security;
alter table public.whisper_group_participants enable row level security;
alter table public.whisper_group_messages enable row level security;
alter table public.whisper_group_message_reads enable row level security;

-- Membership check used by every policy below. Defined SECURITY DEFINER so
-- that a policy on whisper_group_messages/whisper_group_message_reads can
-- check whisper_group_participants without re-entering that table's own RLS
-- (the same recursion trap fixed for Whispers replies in
-- 20260802020000_fix_whisper_reply_policy_recursion.sql).
create or replace function public.is_whisper_group_participant(
  p_group_thread_id uuid,
  p_user_id uuid
)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.whisper_group_participants
    where group_thread_id = p_group_thread_id
      and user_id = p_user_id
  );
$$;

revoke all on function public.is_whisper_group_participant(uuid, uuid) from public;
revoke execute on function public.is_whisper_group_participant(uuid, uuid) from anon;
grant execute on function public.is_whisper_group_participant(uuid, uuid) to authenticated;

drop policy if exists "Group participants can view group threads" on public.whisper_group_threads;
create policy "Group participants can view group threads"
  on public.whisper_group_threads
  for select
  using (public.is_whisper_group_participant(id, auth.uid()));

drop policy if exists "Users can create group threads they belong to" on public.whisper_group_threads;
create policy "Users can create group threads they belong to"
  on public.whisper_group_threads
  for insert
  with check (auth.uid() = created_by);

drop policy if exists "Group participants can view participant lists" on public.whisper_group_participants;
create policy "Group participants can view participant lists"
  on public.whisper_group_participants
  for select
  using (public.is_whisper_group_participant(group_thread_id, auth.uid()));

-- Phase 1 only supports the creator seeding the initial member list at
-- creation time. Invite/add-member flows for existing groups are a Phase 2
-- (membership UI) concern and will need their own policy.
drop policy if exists "Thread creators can add initial participants" on public.whisper_group_participants;
create policy "Thread creators can add initial participants"
  on public.whisper_group_participants
  for insert
  with check (
    exists (
      select 1
      from public.whisper_group_threads gt
      where gt.id = group_thread_id
        and gt.created_by = auth.uid()
    )
  );

drop policy if exists "Group participants can view group messages" on public.whisper_group_messages;
create policy "Group participants can view group messages"
  on public.whisper_group_messages
  for select
  using (public.is_whisper_group_participant(group_thread_id, auth.uid()));

drop policy if exists "Group participants can send group messages" on public.whisper_group_messages;
create policy "Group participants can send group messages"
  on public.whisper_group_messages
  for insert
  with check (
    auth.uid() = sender_id
    and public.is_whisper_group_participant(group_thread_id, auth.uid())
  );

drop policy if exists "Group participants can view read receipts" on public.whisper_group_message_reads;
create policy "Group participants can view read receipts"
  on public.whisper_group_message_reads
  for select
  using (
    exists (
      select 1
      from public.whisper_group_messages gm
      where gm.id = group_message_id
        and public.is_whisper_group_participant(gm.group_thread_id, auth.uid())
    )
  );

drop policy if exists "Users can mark their own group message reads" on public.whisper_group_message_reads;
create policy "Users can mark their own group message reads"
  on public.whisper_group_message_reads
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.whisper_group_messages gm
      where gm.id = group_message_id
        and public.is_whisper_group_participant(gm.group_thread_id, auth.uid())
    )
  );

create or replace function public.touch_whisper_group_thread()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.whisper_group_threads
  set updated_at = now(),
      last_message_at = new.created_at
  where id = new.group_thread_id;

  return new;
end;
$$;

drop trigger if exists whisper_group_messages_touch_thread on public.whisper_group_messages;
create trigger whisper_group_messages_touch_thread
after insert on public.whisper_group_messages
for each row execute function public.touch_whisper_group_thread();

-- Keeps Group Whispers feeling intimate rather than becoming an open group
-- chat. 12 was chosen as a generous-but-still-close-knit ceiling; revisit if
-- product needs change.
create or replace function public.enforce_whisper_group_participant_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    select count(*)
    from public.whisper_group_participants
    where group_thread_id = new.group_thread_id
  ) >= 12 then
    raise exception 'Group Whispers are limited to 12 participants.';
  end if;

  return new;
end;
$$;

drop trigger if exists whisper_group_participants_limit on public.whisper_group_participants;
create trigger whisper_group_participants_limit
before insert on public.whisper_group_participants
for each row execute function public.enforce_whisper_group_participant_limit();
