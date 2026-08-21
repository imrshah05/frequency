-- Fixes group Whisper inbox rows staying "unread" after being opened.
--
-- Root cause: the inbox unread dot and tab-bar badge were both computed
-- from whisper_group_message_reads -- the same table Phase 3/4 uses for
-- "seen by" and personal listened-state, which is deliberately only
-- written when someone actually taps play on a specific Echo (so "seen
-- by" stays honest -- see FREQUENCY_DESIGN.md). That means simply opening
-- a group thread without playing every unheard Echo left it "unread"
-- forever, unlike 1:1 Whispers, which marks the whole thread read the
-- moment it's opened.
--
-- Fix: give each participant a per-thread "last opened" cursor, separate
-- from per-Echo listened state. The thread screen stamps this on every
-- open (mirroring 1:1's behavior exactly); the inbox/tab-bar unread
-- computation switches to comparing message timestamps against this
-- cursor instead of per-Echo read rows. whisper_group_message_reads keeps
-- its existing meaning untouched -- this is additive, not a replacement.

alter table public.whisper_group_participants
  add column if not exists last_read_at timestamptz;

drop policy if exists "Users can update their own read cursor" on public.whisper_group_participants;
create policy "Users can update their own read cursor"
  on public.whisper_group_participants
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
