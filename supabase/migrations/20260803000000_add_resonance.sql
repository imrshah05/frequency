do $$
begin
  if not exists (select 1 from pg_type where typname = 'resonance_mood') then
    create type public.resonance_mood as enum ('joyful', 'calm', 'sad', 'anxious', 'angry', 'tired');
  end if;
end $$;

-- Resonance is a private daily mood + voice journal. It is intentionally its
-- own table, isolated from voice_notes/Echo so it never touches Echo's feed,
-- Tune In visibility, or Echo Impact systems.
create table if not exists public.resonances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null,
  mood public.resonance_mood not null,
  audio_path text not null,
  waveform jsonb,
  sticky_note text,
  created_at timestamptz not null default now(),
  constraint resonances_one_per_day unique (user_id, entry_date),
  constraint resonances_sticky_note_length check (sticky_note is null or char_length(sticky_note) <= 240)
);

create index if not exists resonances_user_date_idx
  on public.resonances(user_id, entry_date);

alter table public.resonances enable row level security;

drop policy if exists "Users can view their own resonances" on public.resonances;
create policy "Users can view their own resonances"
  on public.resonances
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own resonances" on public.resonances;
create policy "Users can insert their own resonances"
  on public.resonances
  for insert
  with check (auth.uid() = user_id);

-- Unlike voice-notes (public bucket, Echo audio is meant to be heard by
-- others), resonance-audio must stay private: Resonance entries are only
-- ever visible to the user who created them.
insert into storage.buckets (id, name, public)
values ('resonance-audio', 'resonance-audio', false)
on conflict (id) do nothing;

drop policy if exists "Users can upload their own resonance audio" on storage.objects;
create policy "Users can upload their own resonance audio"
  on storage.objects
  for insert
  with check (
    bucket_id = 'resonance-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can read their own resonance audio" on storage.objects;
create policy "Users can read their own resonance audio"
  on storage.objects
  for select
  using (
    bucket_id = 'resonance-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
