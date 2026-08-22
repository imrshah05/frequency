-- Makes the signup username check work for signed-out people, and stops a
-- duplicate username silently producing an account that has none.
--
-- WHAT WAS WRONG
--
-- app/login.tsx asked "is this username taken?" by selecting from
-- public.profiles -- while nobody was signed in. The profiles read policy is
-- `auth.role() = 'authenticated'`, so that query returned zero rows for every
-- candidate, taken or not. Verified against production: an anon lookup for
-- @bhanutejak14, a username that IS taken, returned [].
--
-- So the check always reported "available". Signup went ahead, handle_new_user
-- then found the duplicate, and its `requested_username := null` branch
-- created the account with no username at all -- no error, no warning, nothing
-- the person could see. Two profiles are in that state today.
--
-- Note the check never failed loudly, because it never errored: RLS hides rows
-- rather than refusing the query. A permission error would have been noticed
-- years earlier than a silent empty result.
--
-- WHY A FUNCTION AND NOT A READ POLICY
--
-- The obvious fix -- let anon read profiles -- answers the question by handing
-- over the table. This returns one boolean and nothing else: no id, no bio, no
-- avatar, and no way to enumerate the list. SECURITY DEFINER is what lets it
-- see past the RLS policy that (correctly) hides profiles from anon.
--
-- It is deliberately an availability oracle: anyone can learn whether a
-- specific username exists. That is inherent to every signup form that tells
-- you a name is taken, and it is the reason this returns a boolean rather than
-- a row. There is no rate limiting on it, which is worth knowing before it is
-- used for anything beyond the signup screen.

create or replace function public.is_username_available(candidate text)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  -- Normalised exactly as handle_new_user normalises it, and as
  -- normalizeUsername() does on the client, so all three agree on what
  -- "the same username" means.
  select not exists (
    select 1
    from public.profiles
    where username = lower(trim(candidate))
  );
$$;

-- Format rules stay where they already are -- lib/profiles.ts validates before
-- calling this, and handle_new_user enforces server-side. This answers only
-- the question the client cannot answer for itself.

revoke all on function public.is_username_available(text) from public;
grant execute on function public.is_username_available(text) to anon;
grant execute on function public.is_username_available(text) to authenticated;

-- --- handle_new_user: refuse a duplicate rather than blanking it ----------
--
-- Only the duplicate branch changes. Missing or malformed metadata still
-- nulls the username, on purpose: a user created outside the app -- from the
-- dashboard, or the admin API -- carries no username at all, and raising there
-- would make those accounts impossible to create.
--
-- A taken username is a different situation. It means the caller asked for
-- something real that cannot be granted, and blanking it silently is how the
-- two username-less accounts happened. Failing the insert rolls the whole
-- signup back (the trigger is AFTER INSERT on auth.users, in the same
-- transaction), so no half-made account survives.
--
-- The EXISTS test is racy on its own -- two simultaneous signups can both see
-- "not taken". profiles_username_unique_idx is the actual guarantee and will
-- raise unique_violation on the loser. This check exists so the common case
-- names the username in the error instead of surfacing an index name.
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
  then
    requested_username := null;
  elsif exists (
    select 1
    from public.profiles
    where username = requested_username
  ) then
    raise exception 'Username % is already taken', requested_username
      using errcode = 'unique_violation';
  end if;

  insert into public.profiles (
    id,
    username,
    bio,
    created_at
  )
  values (
    new.id,
    requested_username,
    '',
    now()
  )
  on conflict (id) do update
  set username = coalesce(public.profiles.username, excluded.username),
      bio = coalesce(public.profiles.bio, '');

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon;
revoke all on function public.handle_new_user() from authenticated;
