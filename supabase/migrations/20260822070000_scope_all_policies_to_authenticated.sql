-- Every policy in the public schema now names `authenticated` instead of
-- `public`. Signed-out callers get nothing at all, metadata included.
--
-- WHAT WAS WRONG
--
-- 38 policies were granted to role `public`, which includes `anon`. Most
-- were harmless in practice because their expression compares against
-- auth.uid(), which is null for anon, so no row matched. Two were not:
--
--   voice_notes  "Voice notes are readable while live or by owner"
--   reactions    "Reactions are readable for live Echoes and owners"
--
-- Both have a branch that never consults auth.uid() -- the live-Echo
-- window -- so both returned rows to unauthenticated callers. Confirmed
-- against production: anon could read 2 voice_notes rows and 1 reactions
-- row. 20260822030000 closed the audio behind signed URLs, but the row
-- itself -- caption, username, waveform, timestamps -- was still public.
--
-- WHY CHANGE ALL 38 RATHER THAN THE TWO THAT LEAKED
--
-- Because "no row matched" is an accident of the expression, not a rule.
-- A policy granted to `public` whose expression happens to require
-- auth.uid() is one edit away from leaking, and nothing in the schema
-- records that it was never meant to serve anon. Naming the role states
-- the intent where it is enforced, so a future branch cannot quietly
-- widen access the way the live-Echo branch did here.
--
-- ALTER rather than DROP/CREATE, so the expressions are carried across
-- verbatim and cannot drift while being retyped.
--
-- Verified safe first: the app redirects to /login whenever there is no
-- session, and app/login.tsx touches only auth.signUp and
-- auth.signInWithPassword -- no table reads happen before a session
-- exists. Edge Functions use service_role, which bypasses RLS entirely.
alter policy "Users can dismiss suggestions for themselves" on public.dismissed_suggestions to authenticated;
alter policy "Users can update their own dismissals" on public.dismissed_suggestions to authenticated;
alter policy "Users can view their own dismissed suggestions" on public.dismissed_suggestions to authenticated;

alter policy "Echo owners can read events for their Echoes" on public.echo_events to authenticated;
alter policy "Users can insert their own echo events" on public.echo_events to authenticated;
alter policy "Users can read their own echo events" on public.echo_events to authenticated;

alter policy "Echo owners can create their echo impacts" on public.echo_impacts to authenticated;
alter policy "Echo owners can read their echo impacts" on public.echo_impacts to authenticated;
alter policy "Echo owners can update their echo impacts" on public.echo_impacts to authenticated;

alter policy "Reactions are readable for live Echoes and owners" on public.reactions to authenticated;
alter policy "Users can create their own live Echo reactions" on public.reactions to authenticated;
alter policy "Users can delete their own reactions" on public.reactions to authenticated;
alter policy "Users can update their own live Echo reactions" on public.reactions to authenticated;

alter policy "Users can insert their own resonances" on public.resonances to authenticated;
alter policy "Users can view their own resonances" on public.resonances to authenticated;

alter policy "Users can create their own voice notes" on public.voice_notes to authenticated;
alter policy "Users can update their own voice notes" on public.voice_notes to authenticated;
alter policy "Voice notes are readable while live or by owner" on public.voice_notes to authenticated;

alter policy "Group participants can view read receipts" on public.whisper_group_message_reads to authenticated;
alter policy "Users can mark their own group message reads" on public.whisper_group_message_reads to authenticated;

alter policy "Group participants can send group messages" on public.whisper_group_messages to authenticated;
alter policy "Group participants can view group messages" on public.whisper_group_messages to authenticated;

alter policy "Group participants can add members" on public.whisper_group_participants to authenticated;
alter policy "Group participants can remove members" on public.whisper_group_participants to authenticated;
alter policy "Group participants can view participant lists" on public.whisper_group_participants to authenticated;
alter policy "Users can update their own read cursor" on public.whisper_group_participants to authenticated;

alter policy "Group participants can update group identity" on public.whisper_group_threads to authenticated;
alter policy "Group participants can view group threads" on public.whisper_group_threads to authenticated;
alter policy "Users can create group threads they belong to" on public.whisper_group_threads to authenticated;

alter policy "Receivers can mark whisper messages read" on public.whisper_messages to authenticated;
alter policy "Senders can insert whisper messages in their threads" on public.whisper_messages to authenticated;
alter policy "Thread participants can view whisper messages" on public.whisper_messages to authenticated;

alter policy "Thread participants can view whisper threads" on public.whisper_threads to authenticated;
alter policy "Users can create their own whisper threads" on public.whisper_threads to authenticated;

-- --- the four that ALTER cannot reach ------------------------------------
--
-- These are the last policies in the database that appear in no migration
-- file. ALTER would work against production but fail on a database built
-- fresh from this chain, where they were never created. Recreating them
-- states them in tracked SQL for the first time; the expressions are
-- copied from the live definitions unchanged, so this is a no-op in
-- behaviour beyond the role.

drop policy if exists "Users can see their own notifications" on public.notifications;
create policy "Users can see their own notifications"
  on public.notifications for select to authenticated
  using (auth.uid() = recipient_id);

drop policy if exists "Users can tune in" on public.tune_ins;
create policy "Users can tune in"
  on public.tune_ins for insert to authenticated
  with check (auth.uid() = listener_id);

drop policy if exists "Users can untune" on public.tune_ins;
create policy "Users can untune"
  on public.tune_ins for delete to authenticated
  using (auth.uid() = listener_id);

drop policy if exists "Frequency owners can respond to tune in requests" on public.tune_ins;
create policy "Frequency owners can respond to tune in requests"
  on public.tune_ins for update to authenticated
  using (auth.uid() = frequency_owner_id)
  with check (auth.uid() = frequency_owner_id);
