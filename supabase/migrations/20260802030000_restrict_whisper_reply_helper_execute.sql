-- Supabase's default privileges auto-grant EXECUTE on newly created public
-- schema functions to anon, authenticated, and service_role. The reply
-- validation helper is only ever called from an authenticated INSERT policy,
-- so anonymous callers do not need direct access to it.

revoke execute on function public.can_reply_to_whisper_message(uuid, uuid, uuid) from anon;
revoke execute on function public.can_reply_to_whisper_message(uuid, uuid, uuid) from public;
