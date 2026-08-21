create table if not exists public.echo_events (
  id uuid primary key default gen_random_uuid(),
  voice_note_id uuid not null references public.voice_notes(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  created_at timestamptz not null default now()
);

do $$
declare
  fk_name text;
begin
  select conname
    into fk_name
  from pg_constraint
  where conrelid = 'public.echo_events'::regclass
    and contype = 'f'
    and pg_get_constraintdef(oid) like '%user_id%'
    and pg_get_constraintdef(oid) like '%auth.users%';

  if fk_name is not null then
    execute format('alter table public.echo_events drop constraint %I', fk_name);
  end if;
end $$;

alter table public.echo_events
  alter column user_id drop not null,
  add constraint echo_events_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete set null;

alter table public.echo_events
  drop constraint if exists echo_events_type_check,
  add constraint echo_events_type_check
  check (
    event_type in (
      'play_started',
      'completed',
      'replayed',
      'liked',
      'commented',
      'shared_to_whisper'
    )
  );

create index if not exists echo_events_voice_note_created_idx
  on public.echo_events(voice_note_id, created_at);

create index if not exists echo_events_user_voice_note_type_idx
  on public.echo_events(user_id, voice_note_id, event_type, created_at);

alter table public.echo_events enable row level security;

drop policy if exists "Users can insert their own echo events" on public.echo_events;
create policy "Users can insert their own echo events"
  on public.echo_events
  for insert
  with check (auth.role() = 'authenticated' and auth.uid() = user_id);

drop policy if exists "Echo owners can read events for their Echoes" on public.echo_events;
create policy "Echo owners can read events for their Echoes"
  on public.echo_events
  for select
  using (
    exists (
      select 1
      from public.voice_notes vn
      where vn.id = voice_note_id
        and vn.user_id = auth.uid()
    )
  );

drop policy if exists "Users can read their own echo events" on public.echo_events;
create policy "Users can read their own echo events"
  on public.echo_events
  for select
  using (auth.uid() = user_id);
