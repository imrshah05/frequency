-- Removes the echo-impact-sweep cron job, and with it a service_role key
-- stored in plaintext.
--
-- WHAT WAS WRONG
--
-- cron.job.command held the whole HTTP call as a literal string, including
-- an `x-cron-secret` header and an `Authorization: Bearer` token whose
-- decoded claims were {"role":"service_role","exp":2096255320} -- a
-- credential that bypasses every RLS policy in this database, valid until
-- 2036, sitting in a table.
--
-- Practical exposure was low: cron.job grants SELECT to PUBLIC, but the
-- cron schema grants USAGE to no one but supabase_admin and postgres, and
-- PostgREST does not expose that schema. So it was not reachable the way
-- the voice_notes and tune_ins holes were. It is removed because a
-- long-lived superuser-equivalent key in queryable storage is worth
-- nothing to keep, not because it was being read.
--
-- WHY DELETE RATHER THAN MOVE THE SECRET TO VAULT
--
-- Because the job should not exist. CLAUDE.md records the decision
-- plainly: "There is no cron, by product decision." The app seals its own
-- Impacts on launch via sealRecentlyFinishedEchoes, and since a creator is
-- the only person who ever sees their own Impact, "generated the moment
-- they open the app" is indistinguishable from "generated an hour ago" --
-- except that one cannot break while nobody is watching.
--
-- And it had broken exactly that way. The job was already `active = false`
-- and last ran 2026-08-18. Its 3 runs all recorded `succeeded`, which is
-- misleading: that is net.http_post reporting it queued the request, not
-- the Edge Function doing work. generate-echo-impact carries
-- verify_jwt = true, so the documented x-cron-secret-only call was rejected
-- at the gateway before any function code ran. Nothing was ever swept;
-- production held 14 Impact rows and zero sealed.
--
-- Nothing is lost by removing it. The sweep's code, its cron mode and the
-- unsealed_finished_echoes RPC all remain and still work -- this deletes
-- the schedule that never successfully invoked them.
--
-- SEPARATELY: the key itself should be rotated.
--
-- Deleting the row removes the copy, not the credential. Anyone who read
-- cron.job while it existed still holds a valid service_role key. Rotating
-- it is a dashboard action (Settings -> API -> JWT secret) and is left to
-- a human, because it invalidates every issued key at once.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'echo-impact-sweep') then
    perform cron.unschedule('echo-impact-sweep');
  end if;
exception
  -- A database built fresh from this chain has no pg_cron and no job to
  -- remove, which is the desired end state rather than an error.
  when undefined_table or undefined_function or insufficient_privilege then
    null;
end $$;
