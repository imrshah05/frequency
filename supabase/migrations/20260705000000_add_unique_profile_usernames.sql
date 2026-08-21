alter table public.profiles
  add column if not exists username text,
  add column if not exists created_at timestamptz not null default now();

update public.profiles
set username = lower(regexp_replace(coalesce(username, ''), '[^a-z0-9_]', '', 'g'))
where username is not null
  and username <> lower(regexp_replace(username, '[^a-z0-9_]', '', 'g'));

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
  and ranked_usernames.username_rank > 1;

alter table public.profiles
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
