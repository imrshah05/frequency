-- Echo Impact becomes a reveal rather than a live dashboard.
--
-- Sealing (is_final) and seeing are two different facts about an Impact,
-- so they are two columns. is_final keeps its exact meaning: the story is
-- permanently locked and will never be regenerated. revealed_at records
-- the one moment that has nothing to do with the content -- the first
-- time its creator was actually shown it.
--
-- A sealed Impact with revealed_at still null is "pending reveal", and is
-- what the app looks for when it comes to the foreground.
--
-- Nullable timestamptz rather than a boolean: "when" answers "whether"
-- as well, and knowing how long an Impact waited to be opened is worth
-- keeping. Existing sealed rows land as NULL, which is correct -- nobody
-- has seen those through the reveal, and they will each get their moment
-- the next time their owner opens the app.

alter table public.echo_impacts
  add column if not exists revealed_at timestamptz;

-- The launch check asks exactly one question, per user: "anything sealed
-- and still unseen?". A partial index means that lookup touches only the
-- rows that are actually waiting, so the common answer -- none -- costs
-- almost nothing on every app open.
create index if not exists echo_impacts_pending_reveal_idx
  on public.echo_impacts (user_id, generated_at)
  where is_final and revealed_at is null;

-- Marking an Impact seen is the one edit a sealed row must still accept.
--
-- The freeze policy (20260816000000) blocks every client update once
-- is_final is true, and that blanket rule is worth keeping exactly as it
-- is -- softening it to "unless you are only touching revealed_at" would
-- put the definition of immutability inside a WITH CHECK expression that
-- has to be re-read carefully every time anyone adds a column. Instead
-- the rule stays absolute in the policy and this function is the single
-- audited exception.
--
-- It can only ever stamp the caller's own row, only when that row is
-- sealed, and only when it has not been stamped before -- so a reveal
-- time can never be moved once written, and no client can reach another
-- person's Impact through it.
create or replace function public.mark_echo_impact_revealed(p_voice_note_id uuid)
returns timestamptz
language sql
volatile
security definer
set search_path = public
as $$
  update public.echo_impacts
     set revealed_at = now()
   where voice_note_id = p_voice_note_id
     and user_id = auth.uid()
     and is_final
     and revealed_at is null
  returning revealed_at;
$$;

revoke execute on function public.mark_echo_impact_revealed(uuid) from anon;
revoke execute on function public.mark_echo_impact_revealed(uuid) from public;
grant execute on function public.mark_echo_impact_revealed(uuid) to authenticated;
