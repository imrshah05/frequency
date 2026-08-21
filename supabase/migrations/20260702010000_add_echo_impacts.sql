create table if not exists public.echo_impacts (
  id uuid primary key default gen_random_uuid(),
  voice_note_id uuid not null references public.voice_notes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  theme text not null,
  subtitle text not null,
  cards jsonb not null default '[]'::jsonb,
  final_reflection text not null,
  metrics_snapshot jsonb not null default '{}'::jsonb,
  model text,
  prompt_version text not null default 'echo-impact-v1',
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.echo_impacts'::regclass
      and conname = 'echo_impacts_voice_note_id_key'
  ) then
    alter table public.echo_impacts
      add constraint echo_impacts_voice_note_id_key unique (voice_note_id);
  end if;
end $$;

create index if not exists echo_impacts_user_generated_idx
  on public.echo_impacts(user_id, generated_at desc);

alter table public.echo_impacts enable row level security;

drop policy if exists "Echo owners can read their echo impacts" on public.echo_impacts;
create policy "Echo owners can read their echo impacts"
  on public.echo_impacts
  for select
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.voice_notes vn
      where vn.id = voice_note_id
        and vn.user_id = auth.uid()
    )
  );

drop policy if exists "Echo owners can create their echo impacts" on public.echo_impacts;
create policy "Echo owners can create their echo impacts"
  on public.echo_impacts
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.voice_notes vn
      where vn.id = voice_note_id
        and vn.user_id = auth.uid()
    )
  );

drop policy if exists "Echo owners can update their echo impacts" on public.echo_impacts;
create policy "Echo owners can update their echo impacts"
  on public.echo_impacts
  for update
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.voice_notes vn
      where vn.id = voice_note_id
        and vn.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.voice_notes vn
      where vn.id = voice_note_id
        and vn.user_id = auth.uid()
    )
  );

create or replace function public.touch_echo_impact()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists echo_impacts_touch_updated_at on public.echo_impacts;
create trigger echo_impacts_touch_updated_at
before update on public.echo_impacts
for each row execute function public.touch_echo_impact();
