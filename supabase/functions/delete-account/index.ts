import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Permanently deletes the authenticated caller's account: their Storage
// files, the rows in tables that predate migration tracking and have no
// `on delete cascade` back to auth.users (voice_notes, tune_ins,
// notifications, reactions), then the auth.users row itself.
//
// Deleting the auth.users row cascades everything else (profiles,
// echo_impacts, resonances, dismissed_suggestions, whisper_threads,
// whisper_messages, whisper_group_* ) via their existing FKs -- see
// supabase/migrations for each. echo_events.user_id is `on delete set
// null`, so those rows survive anonymized, which is fine.
//
// This lives in an Edge Function -- not a SQL function -- for the same
// reason as cleanup-deleted-echo: Postgres cannot call the Storage REST
// API directly, and supabase.auth.admin.deleteUser() is a GoTrue Admin
// API call, not something reachable from SQL at all.
//
// POST only. Authorization: Bearer <user JWT>. No body -- always acts on
// the caller's own account, never a passed-in user id.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function errorResponse(stage: string, detail: unknown, status = 500) {
  console.error('[delete-account] returning non-2xx response', { status, stage, detail });
  return jsonResponse({ error: 'Could not delete account', stage, detail }, status);
}

// storage.list() returns at most this many entries per call and has no
// cursor, so a prefix has to be walked page by page. The previous version
// called it once and inherited the default cap of 100: any account with
// more than 100 recordings under a prefix kept the remainder forever, with
// nothing logged to say so.
const STORAGE_PAGE_SIZE = 100;

type PrefixResult = { bucket: string; prefix: string; removed: number; failed: boolean };

// Best-effort: removes every object under a Storage prefix for this user.
// Failure is reported but never thrown -- an orphaned file must not block
// account deletion itself. What changed is that "reported" now means the
// caller finds out, rather than a warning nobody reads.
//
// The paths are collected across every page BEFORE anything is removed.
// Deleting while paging would shift the offsets underneath the walk and
// silently skip entries.
async function clearStoragePrefix(
  supabaseService: ReturnType<typeof createClient>,
  bucket: string,
  prefix: string
): Promise<PrefixResult> {
  const names: string[] = [];

  for (let offset = 0; ; offset += STORAGE_PAGE_SIZE) {
    const { data: entries, error: listError } = await supabaseService.storage
      .from(bucket)
      .list(prefix, { limit: STORAGE_PAGE_SIZE, offset });

    if (listError) {
      console.warn('[delete-account] storage list failed', { bucket, prefix, offset, listError });
      return { bucket, prefix, removed: 0, failed: true };
    }

    if (!entries || entries.length === 0) break;

    names.push(...entries.map((entry) => entry.name));

    if (entries.length < STORAGE_PAGE_SIZE) break;
  }

  if (names.length === 0) return { bucket, prefix, removed: 0, failed: false };

  let removed = 0;
  let failed = false;

  for (let i = 0; i < names.length; i += STORAGE_PAGE_SIZE) {
    const paths = names.slice(i, i + STORAGE_PAGE_SIZE).map((name) => `${prefix}/${name}`);
    const { error: removeError } = await supabaseService.storage.from(bucket).remove(paths);

    if (removeError) {
      console.warn('[delete-account] storage remove failed', { bucket, prefix, removeError });
      failed = true;
    } else {
      removed += paths.length;
    }
  }

  return { bucket, prefix, removed, failed };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return errorResponse('method_check', `Method ${req.method} is not allowed`, 405);
  }

  let stage = 'init';

  try {
    stage = 'check_environment';
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return errorResponse(stage, 'Supabase environment is not configured', 500);
    }

    stage = 'authenticate_user';
    const authorization = req.headers.get('Authorization') ?? '';
    const supabaseForUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authorization } },
    });

    const { data: authData, error: authError } = await supabaseForUser.auth.getUser();
    if (authError || !authData.user) {
      return errorResponse(stage, authError ?? 'No authenticated user', 401);
    }

    const userId = authData.user.id;
    const supabaseService = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    stage = 'clear_storage';
    const storageResults = await Promise.all([
      clearStoragePrefix(supabaseService, 'voice-notes', userId),
      clearStoragePrefix(supabaseService, 'voice-notes', `whispers/${userId}`),
      clearStoragePrefix(supabaseService, 'voice-notes', `whispers/group/${userId}`),
      clearStoragePrefix(supabaseService, 'avatars', userId),
      clearStoragePrefix(supabaseService, 'resonance-audio', userId),
    ]);

    const storageRemoved = storageResults.reduce((sum, r) => sum + r.removed, 0);
    const storageFailures = storageResults.filter((r) => r.failed).map((r) => `${r.bucket}/${r.prefix}`);

    if (storageFailures.length > 0) {
      // Still non-fatal, by the same rule as before. But an account whose
      // files outlived it is now something the caller can see and act on
      // rather than something only a log line knew about.
      console.error('[delete-account] some storage prefixes were not cleared', { storageFailures });
    }

    stage = 'delete_reactions';
    const { error: reactionsError } = await supabaseService
      .from('reactions')
      .delete()
      .eq('user_id', userId);
    if (reactionsError) return errorResponse(stage, reactionsError, 500);

    stage = 'delete_notifications';
    const { error: notificationsError } = await supabaseService
      .from('notifications')
      .delete()
      .or(`recipient_id.eq.${userId},actor_id.eq.${userId}`);
    if (notificationsError) return errorResponse(stage, notificationsError, 500);

    stage = 'delete_tune_ins';
    const { error: tuneInsError } = await supabaseService
      .from('tune_ins')
      .delete()
      .or(`listener_id.eq.${userId},frequency_owner_id.eq.${userId}`);
    if (tuneInsError) return errorResponse(stage, tuneInsError, 500);

    stage = 'delete_voice_notes';
    const { error: voiceNotesError } = await supabaseService
      .from('voice_notes')
      .delete()
      .eq('user_id', userId);
    if (voiceNotesError) return errorResponse(stage, voiceNotesError, 500);

    stage = 'delete_auth_user';
    const { error: deleteUserError } = await supabaseService.auth.admin.deleteUser(userId);
    if (deleteUserError) return errorResponse(stage, deleteUserError, 500);

    return jsonResponse({
      deleted: true,
      storageRemoved,
      storageFailures,
    });
  } catch (error) {
    console.error('[delete-account] function failed', { stage, error });
    return errorResponse(stage, String(error), 500);
  }
});
