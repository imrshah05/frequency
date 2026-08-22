-- M4: indexes for every unindexed foreign key.
-- M6: removes three duplicate avatar storage policies.
--
-- Both are mechanical. Neither changes who can read or write anything.
--
-- M4 -- WHY IT MATTERS EVEN THOUGH THE TABLES ARE SMALL
--
-- Postgres does not index a foreign key automatically. An unindexed FK
-- costs twice: joins on it scan, and every delete on the PARENT table has
-- to scan the child to enforce the constraint. Account deletion touches
-- most of these in one request, so they compound there first.
--
-- Nothing here is urgent at 40 Echoes and 130 notifications. They are
-- cheap now and awkward to add later under load, which is the whole
-- argument for doing it while the tables are small.
--
-- The one that would bite first is notifications.recipient_id: it backs
-- the Activity feed's main query and its RLS policy, and the table had
-- only its primary key.
--
-- Indexes are created non-concurrently on purpose. CONCURRENTLY cannot run
-- inside a transaction, which is what a migration is, and on tables this
-- size the exclusive lock lasts milliseconds.

create index if not exists comments_user_id_idx
  on public.comments (user_id);
create index if not exists comments_voice_note_id_idx
  on public.comments (voice_note_id);

create index if not exists dismissed_suggestions_suggested_user_id_idx
  on public.dismissed_suggestions (suggested_user_id);

create index if not exists heard_notes_voice_note_id_idx
  on public.heard_notes (voice_note_id);

-- Activity feed: the read path and the RLS policy both filter recipient_id.
create index if not exists notifications_recipient_id_created_idx
  on public.notifications (recipient_id, created_at desc);
create index if not exists notifications_actor_id_idx
  on public.notifications (actor_id);
create index if not exists notifications_voice_note_id_idx
  on public.notifications (voice_note_id);

-- reactions already has a unique (user_id, voice_note_id), but user_id
-- leads it, so lookups and cascades by voice_note_id alone cannot use it.
create index if not exists reactions_voice_note_id_idx
  on public.reactions (voice_note_id);

create index if not exists whisper_group_messages_sender_id_idx
  on public.whisper_group_messages (sender_id);
create index if not exists whisper_group_threads_created_by_idx
  on public.whisper_group_threads (created_by);

create index if not exists whisper_messages_sender_id_idx
  on public.whisper_messages (sender_id);
create index if not exists whisper_messages_receiver_id_idx
  on public.whisper_messages (receiver_id);

-- whisper_threads_pair_idx is on (LEAST(a,b), GREATEST(a,b)), which serves
-- the pair-uniqueness constraint but not a lookup on either column, and
-- the Whispers inbox filters exactly that: user_a_id = me OR user_b_id = me.
create index if not exists whisper_threads_user_a_id_idx
  on public.whisper_threads (user_a_id);
create index if not exists whisper_threads_user_b_id_idx
  on public.whisper_threads (user_b_id);

-- --- M6: duplicate avatar storage policies ------------------------------
--
-- Six policies on storage.objects for the avatars bucket, in three pairs
-- with identical effect. Confirmed equivalent before dropping:
--
--   INSERT  "...own avatar" / "...own avatars"   identical WITH CHECK
--   SELECT  "Anyone can view avatars" / "Avatar images are publicly
--           readable"                            identical USING
--   UPDATE  "...own avatar" / "...own avatars"   the second omits
--           WITH CHECK, which for UPDATE means Postgres reuses its USING
--           expression -- so the two are equivalent, not weaker
--
-- Which half to drop was not a coin flip: in each pair exactly one name
-- appears in 20260701010000_add_profile_avatars.sql and the other appears
-- in no migration at all. The undocumented copies go, so what remains is
-- the set the repo already describes.
drop policy if exists "Users can upload their own avatars" on storage.objects;
drop policy if exists "Anyone can view avatars" on storage.objects;
drop policy if exists "Users can update their own avatars" on storage.objects;
