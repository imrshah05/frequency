-- Closes the three remaining blanket-access policies, and brings the four
-- undocumented tables into tracked SQL.
--
-- WHY THESE THREE TOGETHER
--
-- comments, heard_notes, notifications and tune_ins carry 11 policies
-- between them and not one of them appears in any migration file. They
-- predate the tracked chain and were created through the dashboard, which
-- is exactly how the voice_notes/reactions exposure stayed invisible until
-- 20260822020000. Restating them here makes the repo the record.
--
-- H1 -- tune_ins was readable by anyone, including anon. Confirmed against
-- production: an unauthenticated request returned all 55 rows, 4 of them
-- status='pending'. The whole social graph plus every unanswered request.
--
-- H2 -- any authenticated user could forge a notification to anyone. The
-- insert rule was `auth.uid() IS NOT NULL` and nothing else, so nothing
-- tied the row's actor_id, recipient_id, type or message to the caller.
--
-- H5 -- comments was `USING (true)`. It returns nothing today only
-- because the table is empty; the first comment written would have been
-- world-readable.

-- --- H1: tune_ins -------------------------------------------------------

-- Accepted relationships stay visible to signed-in users, because Listening
-- To and Tuned In are public parts of a profile. What stops being visible
-- to third parties is a request that has not been answered -- pending and
-- declined rows are between the two people involved and nobody else.
--
-- Verified against every client read first: each one either filters
-- status='accepted' or is already scoped to the caller, so nothing loses
-- data it was using.
drop policy if exists "Users can see tune ins" on public.tune_ins;

create policy "Tune ins are visible when accepted or yours"
  on public.tune_ins
  for select
  to authenticated
  using (
    status = 'accepted'
    or auth.uid() = listener_id
    or auth.uid() = frequency_owner_id
  );

-- --- H2: notifications --------------------------------------------------

-- The caller must be the actor. Every client insert already passes the
-- current user as actorId (lib/notifications.ts and its four call sites),
-- so this is the rule the app was already following -- it just was not
-- enforced.
drop policy if exists "Authenticated users can create notifications" on public.notifications;

create policy "Users can only notify as themselves"
  on public.notifications
  for insert
  to authenticated
  with check (auth.uid() = actor_id);

-- M1, same table: the update rule had USING but no WITH CHECK, so a
-- recipient could rewrite their own notification -- including moving it to
-- another recipient_id with arbitrary text. Gating the new row as well as
-- the old one closes that, and marking notifications read (the only thing
-- the app updates) is unaffected.
drop policy if exists "Users can update their own notifications" on public.notifications;

create policy "Users can update their own notifications"
  on public.notifications
  for update
  to authenticated
  using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

-- --- H5: comments -------------------------------------------------------

-- A comment is exactly as visible as the Echo it sits on. Rather than
-- restating the live-or-owner rule, this defers to voice_notes: RLS
-- applies inside a policy's own subqueries, so the EXISTS below can only
-- see rows the caller is already allowed to see. One rule, one place --
-- change voice_notes' visibility and comments follows automatically.
drop policy if exists "Anyone can see comments" on public.comments;

create policy "Comments are as visible as their Echo"
  on public.comments
  for select
  to authenticated
  using (
    exists (select 1 from public.voice_notes vn where vn.id = comments.voice_note_id)
  );

-- Same reasoning applied to writing one. The old rule checked ownership of
-- the comment but never that the Echo was reachable, so an archived Echo
-- could still be commented on by anyone who knew its id.
drop policy if exists "Users can comment" on public.comments;

create policy "Users can comment on Echoes they can see"
  on public.comments
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.voice_notes vn where vn.id = comments.voice_note_id)
  );

-- --- heard_notes --------------------------------------------------------

-- Restated unchanged in behaviour, purely to bring the last undocumented
-- table into tracked SQL. Both rules were already correctly scoped to the
-- caller; the only change is that they now name `authenticated` instead of
-- `public`, so anon is refused at the role level rather than by failing an
-- auth.uid() comparison.
drop policy if exists "Users can see own heard notes" on public.heard_notes;
create policy "Users can see own heard notes"
  on public.heard_notes for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can mark notes as heard" on public.heard_notes;
create policy "Users can mark notes as heard"
  on public.heard_notes for insert to authenticated
  with check (auth.uid() = user_id);
