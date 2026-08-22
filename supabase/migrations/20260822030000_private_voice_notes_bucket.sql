-- Makes the voice-notes bucket private and moves playback to signed URLs.
--
-- WHAT WAS WRONG
--
-- The bucket was `public = true` with a storage policy of
-- `USING (bucket_id = 'voice-notes')` granted to role `public`, so every
-- audio file in it was downloadable with no API key and no session.
-- Verified before this migration: an ARCHIVED Echo's audio -- metadata
-- already hidden from anon by 20260822020000 -- returned HTTP 200 and
-- 95,320 bytes of audio/mp4 to an unauthenticated request.
--
-- That policy fix hid the row. The audio itself was never protected, so
-- "Never expose Archives publicly" was still false one layer down. It
-- also exposed 67 orphaned objects: recordings uploaded but never linked
-- to any row, i.e. Echoes nobody ever chose to post.
--
-- WHY A PATH COLUMN
--
-- audio_url holds a permanent public URL. A signed URL cannot be stored,
-- because it expires -- so the row has to hold the path and the URL has
-- to be minted at read time. audio_path mirrors resonances.audio_path,
-- which is the same shape for the already-private resonance-audio bucket.
--
-- audio_url is left populated and simply stops being read. Nothing is
-- destroyed, so rolling this back is a code revert rather than a data
-- restore. It gets dropped in a later migration once signed playback has
-- proven itself.
--
-- THE BUCKET HOLDS THREE FEATURES, NOT ONE
--
--   {uid}/{ts}.m4a                  Echoes          voice_notes
--   whispers/{uid}/{ts}.m4a         1:1 Whispers    whisper_messages
--   whispers/group/{uid}/{ts}.m4a   Group Whispers  whisper_group_messages
--
-- so all three tables need the column, the backfill and the read rule.

-- --- 1. path column + backfill ------------------------------------------

alter table public.voice_notes            add column if not exists audio_path text;
alter table public.whisper_messages       add column if not exists audio_path text;
alter table public.whisper_group_messages add column if not exists audio_path text;

-- Every stored URL is `.../object/public/voice-notes/<path>`; verified
-- against live data before writing this -- 67/67 rows extract cleanly,
-- none contain percent-encoding or a query string.
update public.voice_notes
   set audio_path = substring(audio_url from '/object/public/voice-notes/(.*)$')
 where audio_url is not null and audio_path is null;

update public.whisper_messages
   set audio_path = substring(audio_url from '/object/public/voice-notes/(.*)$')
 where audio_url is not null and audio_path is null;

update public.whisper_group_messages
   set audio_path = substring(audio_url from '/object/public/voice-notes/(.*)$')
 where audio_url is not null and audio_path is null;

-- The read rule below looks objects up BY PATH on every signing request,
-- so these three indexes are load-bearing, not housekeeping.
create index if not exists voice_notes_audio_path_idx
  on public.voice_notes (audio_path) where audio_path is not null;
create index if not exists whisper_messages_audio_path_idx
  on public.whisper_messages (audio_path) where audio_path is not null;
create index if not exists whisper_group_messages_audio_path_idx
  on public.whisper_group_messages (audio_path) where audio_path is not null;

-- --- 2. who may sign an object ------------------------------------------

-- SECURITY DEFINER for the same reason is_whisper_group_participant is:
-- RLS applies inside a policy's own subqueries, so an INVOKER function
-- here would be unable to see the very rows it needs to authorise
-- against, and would deny everything.
--
-- Each branch restates the owning table's own visibility rule, so a file
-- is readable exactly when its row is. Echoes reuse the live-or-owner
-- rule from 20260822020000 -- which is what makes an Echo shared into a
-- Whisper stop playing when its run ends, consistent with the decision
-- recorded there.
create or replace function public.can_read_voice_note_object(object_name text)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select
    -- Echo: live to anyone, always to its owner, never once deleted.
    exists (
      select 1
      from public.voice_notes vn
      where vn.audio_path = object_name
        and vn.deleted_at is null
        and (
          vn.user_id = auth.uid()
          or (vn.archived_at is null and vn.created_at >= now() - interval '24 hours')
        )
    )
    -- 1:1 Whisper: either side of the thread.
    or exists (
      select 1
      from public.whisper_messages wm
      join public.whisper_threads wt on wt.id = wm.thread_id
      where wm.audio_path = object_name
        and (auth.uid() = wt.user_a_id or auth.uid() = wt.user_b_id)
    )
    -- Group Whisper: any current participant.
    or exists (
      select 1
      from public.whisper_group_messages gm
      where gm.audio_path = object_name
        and public.is_whisper_group_participant(gm.group_thread_id, auth.uid())
    );
$$;

revoke all on function public.can_read_voice_note_object(text) from public;
revoke all on function public.can_read_voice_note_object(text) from anon;
grant execute on function public.can_read_voice_note_object(text) to authenticated;

-- --- 3. the storage read rule -------------------------------------------

-- The blanket policy. Granted to `public`, which includes anon, and
-- testing nothing but the bucket name.
drop policy if exists "Anyone can read voice notes" on storage.objects;

create policy "Voice note objects follow their row's visibility"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'voice-notes'
    and public.can_read_voice_note_object(name)
  );

-- An object with no row pointing at it now matches no branch and is
-- readable by nobody. That closes the 67 orphans without deleting a
-- single file -- worth keeping in mind before any orphan cleanup, since
-- they are already inert.

-- --- 4. flip the bucket -------------------------------------------------

-- Public buckets bypass RLS entirely on the /object/public/ route, so the
-- policy above does nothing until this runs. This is the statement that
-- actually closes the exposure.
update storage.buckets set public = false where id = 'voice-notes';
