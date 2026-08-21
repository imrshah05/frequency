-- Adds manual Archive/Delete for Echoes (voice_notes), additive and
-- entirely separate from the existing automatic 24h-live/archive logic in
-- lib/echoLifecycle.ts, which is untouched by this migration.
--
-- archived_at: reversible, owner-only visibility, surfaces in the existing
-- Archives screen (app/archives.tsx) alongside the pre-existing "just old"
-- rows -- see the updated query there.
--
-- deleted_at: soft-delete with a client-side Undo window. The row becomes
-- invisible to everyone (including the owner) via RLS the moment this is
-- set. Permanent cleanup (Storage file + DB rows) happens outside SQL --
-- see supabase/functions/cleanup-deleted-echo, since Postgres cannot call
-- the Storage REST API directly. This migration only adds the reversible
-- soft-delete/restore RPCs; finalize/permanent-delete is intentionally not
-- a SQL function here.

alter table public.voice_notes
  add column if not exists archived_at timestamptz,
  add column if not exists deleted_at timestamptz;

-- Hot path: Feed/Profile/other-profile screens list rows that are neither
-- archived nor deleted, ordered by recency.
create index if not exists voice_notes_active_created_idx
  on public.voice_notes (created_at desc)
  where archived_at is null and deleted_at is null;

-- Hot path: the owner's Archives screen lists all of their non-deleted
-- rows (manually archived or just old) ordered by recency.
create index if not exists voice_notes_user_active_idx
  on public.voice_notes (user_id, created_at desc)
  where deleted_at is null;

-- Hot path: the cleanup sweep looks for rows past the undo window.
create index if not exists voice_notes_deleted_at_idx
  on public.voice_notes (deleted_at)
  where deleted_at is not null;

-- RLS: replaces the existing SELECT policy. Deleted rows are invisible to
-- everyone via normal client queries, full stop -- including the owner --
-- since delete/restore only ever happens through the RPCs below, which are
-- SECURITY DEFINER and bypass RLS. Archived rows stay visible to the owner
-- (Archives screen) but never to anyone else, regardless of Tune In status
-- or the 24h live window -- archiving something already shared in a
-- Whisper hides it from the other participant too, same as delete.
drop policy if exists "Voice notes are readable while live or by owner" on public.voice_notes;
create policy "Voice notes are readable while live or by owner"
  on public.voice_notes
  for select
  using (
    deleted_at is null
    and (
      user_id = auth.uid()
      or (archived_at is null and created_at >= now() - interval '24 hours')
    )
  );

-- Direct client deletes are no longer allowed. Delete must go through
-- soft_delete_echo (reversible) and the cleanup sweep/Edge Function
-- (permanent). No replacement policy is created, so RLS denies all client
-- DELETEs on this table; the RPCs below are SECURITY DEFINER and bypass
-- RLS entirely, same pattern already used by touch_whisper_thread /
-- touch_echo_impact in this codebase.
drop policy if exists "Users can delete their own voice notes" on public.voice_notes;

create or replace function public.archive_echo(echo_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.voice_notes
  set archived_at = now()
  where id = echo_id
    and user_id = auth.uid()
    and deleted_at is null;

  if not found then
    raise exception 'Echo not found, already deleted, or not owned by the current user';
  end if;
end;
$$;

create or replace function public.unarchive_echo(echo_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.voice_notes
  set archived_at = null
  where id = echo_id
    and user_id = auth.uid()
    and deleted_at is null;

  if not found then
    raise exception 'Echo not found, already deleted, or not owned by the current user';
  end if;
end;
$$;

create or replace function public.soft_delete_echo(echo_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.voice_notes
  set deleted_at = now()
  where id = echo_id
    and user_id = auth.uid()
    and deleted_at is null;

  if not found then
    raise exception 'Echo not found, already deleted, or not owned by the current user';
  end if;
end;
$$;

create or replace function public.restore_echo(echo_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.voice_notes
  set deleted_at = null
  where id = echo_id
    and user_id = auth.uid()
    and deleted_at is not null;

  if not found then
    raise exception 'Echo not found, not pending deletion, or not owned by the current user';
  end if;
end;
$$;

-- Supabase auto-grants EXECUTE on new public-schema functions to anon,
-- authenticated, and service_role. These all check auth.uid() ownership
-- internally, but anonymous callers can never pass that check, so restrict
-- to authenticated the same way 20260802030000 did for the whisper reply
-- helper.
revoke execute on function public.archive_echo(uuid) from anon;
revoke execute on function public.archive_echo(uuid) from public;
revoke execute on function public.unarchive_echo(uuid) from anon;
revoke execute on function public.unarchive_echo(uuid) from public;
revoke execute on function public.soft_delete_echo(uuid) from anon;
revoke execute on function public.soft_delete_echo(uuid) from public;
revoke execute on function public.restore_echo(uuid) from anon;
revoke execute on function public.restore_echo(uuid) from public;
