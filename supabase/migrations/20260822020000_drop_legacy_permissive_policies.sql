-- Drops the legacy blanket-read policies that silently defeat every
-- restrictive rule written after them.
--
-- WHAT WAS WRONG
--
-- Production carries four policies that appear in NO migration file in
-- this repo. They predate the tracked chain and were created through the
-- dashboard, so reading the migrations gives the exact opposite
-- impression -- that the restrictive rules are in force:
--
--   voice_notes  [SELECT] "Anyone can see voice notes"      using (true)
--   reactions    [SELECT] "Anyone can see reactions"        using (true)
--   reactions    [INSERT] "Users can react"                 no live check
--   reactions    [UPDATE] "Users can update own reaction"   no live check
--
-- PostgreSQL combines PERMISSIVE policies with OR. All four are
-- permissive and granted to role `public`, and both `anon` and
-- `authenticated` hold full table privileges. So the effective SELECT
-- rule on voice_notes has been `true` this whole time, and these two --
--
--   "Voice notes are readable while live or by owner"
--   "Reactions are readable for live Echoes and owners"
--
-- -- have never done anything. Every Echo ever recorded, archived and
-- soft-deleted ones included, has been readable by anyone holding the
-- publishable key, without logging in. That directly contradicts
-- "Never expose Archives publicly."
--
-- WHY THIS IS A DROP AND NOT A REWRITE
--
-- The restrictive policies are already correct and already live. Nothing
-- needs to be created -- removing what was shadowing them is the entire
-- fix. After this migration the effective SELECT rule on voice_notes is
-- the one that was always meant to apply:
--
--   deleted_at is null
--   and (user_id = auth.uid()
--        or (archived_at is null and created_at >= now() - interval '24 hours'))
--
-- WHAT CHANGES IN THE APP, DELIBERATELY
--
-- Traced against every client read before writing this. Three behaviours
-- depend on the blanket policy today; all three were reviewed and are
-- intended:
--
-- 1. Echoes shared into a 1:1 Whisper stop playing once their 24h run
--    ends. app/whispers/[threadId].tsx fetches them by id with no filter,
--    and already renders "This Echo is no longer available" for a missing
--    row, so this degrades rather than breaks. A carve-out permitting
--    thread participants to keep reading shared Echoes was considered and
--    declined: an Echo's run ending should end it everywhere.
--
-- 2. The "Echoes" stat on ANOTHER person's profile becomes a live count
--    (0 or 1) instead of a lifetime one -- app/frequency/[userId].tsx
--    counts with no archived filter. Your own profile is unaffected;
--    owners can still read all their own rows.
--
-- 3. Tune In suggestion ranking loses its recency dimension for anyone
--    not currently live -- lib/suggestedTuneIns.ts reads candidates' Echo
--    history to find their most recent one. Recency is weight 1 against
--    mutuals 3 and shared groups 2, and never disqualifies a candidate,
--    so suggestions keep working with one signal flattened.
--
-- Everything else already filters on deleted_at / archived_at / 24h
-- explicitly: the feed, Archives, echoes-near-you, live-echoes, the
-- own-profile live Echo, and the Echo Impact reveal queue (which filters
-- voice_notes.deleted_at with an !inner join by design).
--
-- ONE SECOND-ORDER EFFECT WORTH KNOWING
--
-- The reactions policies subquery voice_notes, and RLS applies inside a
-- policy's own subqueries. So tightening voice_notes tightens reactions
-- transitively. That is consistent with the intent here, but it means
-- these two tables can no longer be reasoned about separately.

-- --- voice_notes ---------------------------------------------------------

drop policy if exists "Anyone can see voice notes" on public.voice_notes;

-- Exact duplicate of "Users can create their own voice notes"
-- (with check (user_id = auth.uid()); this one spells it auth.uid() =
-- user_id). Identical semantics, so dropping it changes no behaviour --
-- pure removal of duplicate logic, not part of the security fix.
drop policy if exists "Users can upload own voice notes" on public.voice_notes;

-- --- reactions -----------------------------------------------------------

drop policy if exists "Anyone can see reactions" on public.reactions;

-- Both of these let someone react to an Echo of any age. The surviving
-- "Users can create their own live Echo reactions" / "Users can update
-- their own live Echo reactions" carry the same ownership test plus the
-- 24h window the product actually wants.
--
-- The feed only ever renders live Echoes, so the app cannot notice the
-- difference. The one visible edge: an Echo that crosses its 24h boundary
-- while the feed is open on screen will now reject a like instead of
-- accepting it.
drop policy if exists "Users can react" on public.reactions;
drop policy if exists "Users can update own reaction" on public.reactions;

-- Unliking is untouched -- "Users can delete their own reactions" is the
-- only DELETE policy and carries no age test, so a reaction left on an
-- Echo that has since finished can still be withdrawn.
