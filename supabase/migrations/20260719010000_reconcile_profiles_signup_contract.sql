alter table public.profiles
  add column if not exists username text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists bio text default '',
  add column if not exists avatar_url text,
  add column if not exists onboarding_completed boolean default false;

update public.profiles
set created_at = coalesce(created_at, now()),
    bio = coalesce(bio, ''),
    onboarding_completed = coalesce(onboarding_completed, false);

update public.profiles
set username = lower(trim(username))
where username is not null
  and username <> lower(trim(username));

update public.profiles
set username = null
where username is not null
  and (
    char_length(username) not between 3 and 20
    or username !~ '^[a-z0-9_]+$'
  );

with ranked_usernames as (
  select
    id,
    row_number() over (
      partition by username
      order by created_at nulls last, id
    ) as username_rank
  from public.profiles
  where username is not null
)
update public.profiles profiles
set username = null
from ranked_usernames
where profiles.id = ranked_usernames.id
  and profiles.username is not null
  and ranked_usernames.username_rank > 1;

alter table public.profiles
  alter column username drop not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column bio set default '',
  alter column bio set not null,
  alter column onboarding_completed set default false,
  alter column onboarding_completed set not null;

alter table public.profiles
  drop constraint if exists profiles_username_key,
  drop constraint if exists profiles_username_format_check,
  add constraint profiles_username_format_check
  check (
    username is null
    or (
      char_length(username) between 3 and 20
      and username ~ '^[a-z0-9_]+$'
    )
  );

create unique index if not exists profiles_username_unique_idx
  on public.profiles (username)
  where username is not null;

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

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requested_username text;
begin
  requested_username := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));

  if requested_username = ''
    or char_length(requested_username) not between 3 and 20
    or requested_username !~ '^[a-z0-9_]+$'
    or exists (
      select 1
      from public.profiles
      where username = requested_username
    )
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
  set username = coalesce(public.profiles.username, excluded.username),
      bio = coalesce(public.profiles.bio, ''),
      onboarding_completed = coalesce(public.profiles.onboarding_completed, false);

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

alter table public.profiles enable row level security;

drop policy if exists "Anyone can see profiles" on public.profiles;
drop policy if exists "Users can create own profile" on public.profiles;
drop policy if exists "Users can insert their own profile" on public.profiles;
drop policy if exists "Authenticated users can read profiles" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;

create policy "Authenticated users can read profiles"
  on public.profiles
  for select
  to authenticated
  using (auth.role() = 'authenticated');

create policy "Users can update their own profile"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

revoke insert on table public.profiles from anon, authenticated;
revoke update on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (username, bio, avatar_url, onboarding_completed)
  on table public.profiles
  to authenticated;
