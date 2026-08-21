alter table public.profiles
  add column if not exists onboarding_completed boolean not null default false;

alter table public.profiles
  alter column onboarding_completed set default false;

do $$
begin
  if not exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.contype = 'f'
      and constraint_record.conrelid = 'public.profiles'::regclass
      and constraint_record.confrelid = 'auth.users'::regclass
      and constraint_record.conkey = array[
        (
          select attribute_record.attnum
          from pg_attribute attribute_record
          where attribute_record.attrelid = 'public.profiles'::regclass
            and attribute_record.attname = 'id'
        )
      ]
  ) then
    alter table public.profiles
      add constraint profiles_id_fkey
      foreign key (id)
      references auth.users(id)
      on delete cascade
      not valid;
  end if;
end $$;

alter table public.profiles enable row level security;

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requested_username text;
begin
  requested_username := lower(
    regexp_replace(
      coalesce(new.raw_user_meta_data ->> 'username', ''),
      '[^a-z0-9_]',
      '',
      'g'
    )
  );

  if requested_username = ''
    or char_length(requested_username) not between 3 and 20
    or requested_username !~ '^[a-z0-9_]+$'
  then
    requested_username := null;
  end if;

  insert into public.profiles (
    id,
    username,
    bio,
    created_at,
    onboarding_completed
  )
  values (
    new.id,
    requested_username,
    '',
    now(),
    false
  )
  on conflict (id) do update
  set username = coalesce(public.profiles.username, excluded.username);

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon;
revoke all on function public.handle_new_user() from authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
