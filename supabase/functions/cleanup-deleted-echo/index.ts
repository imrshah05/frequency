import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Permanently finalizes soft-deleted Echoes: deletes the audio file from
// Storage, then the dependent rows, then the voice_notes row itself.
//
// This lives in an Edge Function -- not a SQL function -- because Postgres
// cannot call the Storage REST API directly. Deleting straight from
// storage.objects in SQL only removes Supabase's metadata reference, not
// the actual bytes in the storage backend, which would leave orphaned
// files behind. See the accompanying migration
// (20260809010000_add_echo_archive_delete.sql) for why soft_delete_echo /
// restore_echo are SQL RPCs but finalization is not.
//
// Two modes, both POST:
//   1. Single-echo (called by the client right after the undo timer
//      expires, as a best-effort optimization to purge sooner):
//      Authorization: Bearer <user JWT>, body { "voice_note_id": "..." }
//   2. Sweep (the source of truth -- covers the case where the app is
//      backgrounded/killed/loses network during the undo window; must be
//      wired up as a scheduled trigger, see MANUAL STEP note below):
//      header "x-cron-secret: <CLEANUP_CRON_SECRET>", no body needed.
//      Finalizes every row with deleted_at older than ~2 minutes.
//
// MANUAL STEP REQUIRED: this function does not schedule itself. In the
// Supabase dashboard, go to Database -> Cron Jobs, create a job that runs
// every 1-2 minutes and sends an HTTP POST to this function's URL with
// header "x-cron-secret" set to the same value as the CLEANUP_CRON_SECRET
// function secret (set that secret first: Edge Functions ->
// cleanup-deleted-echo -> Secrets). Enabling a dashboard Cron Job also
// enables the pg_cron/pg_net extensions on your project if they aren't
// already -- that's expected and handled by the dashboard, not something
// this migration/function does itself.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CLEANUP_CRON_SECRET = Deno.env.get('CLEANUP_CRON_SECRET') ?? '';

const UNDO_WINDOW_MS = 2 * 60 * 1000;
const VOICE_NOTES_BUCKET = 'voice-notes';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type VoiceNoteRow = {
  id: string;
  user_id: string;
  audio_url: string | null;
  deleted_at: string | null;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function errorResponse(stage: string, detail: unknown, status = 500) {
  console.error('[cleanup-deleted-echo] returning non-2xx response', { status, stage, detail });
  return jsonResponse({ error: 'Could not clean up Echo', stage, detail }, status);
}

function storagePathFromPublicUrl(url: string, bucket: string): string | null {
  const marker = `/object/public/${bucket}/`;
  const index = url.indexOf(marker);
  if (index === -1) return null;

  const path = url.slice(index + marker.length).split('?')[0];
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

// Deletes the Storage object (if any) and the dependent + voice_notes rows
// for one Echo. Returns false (and leaves the row untouched) if the
// Storage delete fails, so the next sweep can retry rather than orphaning
// the file.
async function finalizeEcho(
  supabaseService: ReturnType<typeof createClient>,
  echo: VoiceNoteRow
): Promise<{ ok: boolean; reason?: string }> {
  if (echo.audio_url) {
    const path = storagePathFromPublicUrl(echo.audio_url, VOICE_NOTES_BUCKET);

    if (path) {
      const { error: storageError } = await supabaseService.storage
        .from(VOICE_NOTES_BUCKET)
        .remove([path]);

      if (storageError) {
        console.error('[cleanup-deleted-echo] storage delete failed, will retry later', {
          echoId: echo.id,
          path,
          storageError,
        });
        return { ok: false, reason: 'storage_delete_failed' };
      }
    } else {
      console.warn('[cleanup-deleted-echo] could not parse storage path from audio_url, skipping file delete', {
        echoId: echo.id,
        audioUrl: echo.audio_url,
      });
    }
  }

  const { error: reactionsError } = await supabaseService
    .from('reactions')
    .delete()
    .eq('voice_note_id', echo.id);

  if (reactionsError) {
    console.error('[cleanup-deleted-echo] reactions delete failed', { echoId: echo.id, reactionsError });
    return { ok: false, reason: 'reactions_delete_failed' };
  }

  const { error: notificationsError } = await supabaseService
    .from('notifications')
    .delete()
    .eq('voice_note_id', echo.id);

  if (notificationsError) {
    console.error('[cleanup-deleted-echo] notifications delete failed', { echoId: echo.id, notificationsError });
    return { ok: false, reason: 'notifications_delete_failed' };
  }

  // echo_impacts / echo_events cascade via FK on delete of voice_notes.
  const { error: voiceNoteError } = await supabaseService
    .from('voice_notes')
    .delete()
    .eq('id', echo.id);

  if (voiceNoteError) {
    console.error('[cleanup-deleted-echo] voice_notes delete failed', { echoId: echo.id, voiceNoteError });
    return { ok: false, reason: 'voice_note_delete_failed' };
  }

  return { ok: true };
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

    const supabaseService = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const cronSecretHeader = req.headers.get('x-cron-secret') ?? '';

    stage = 'sweep_mode_check';
    if (CLEANUP_CRON_SECRET && cronSecretHeader === CLEANUP_CRON_SECRET) {
      console.log('[cleanup-deleted-echo] running scheduled sweep');

      stage = 'sweep_fetch_expired';
      const cutoffIso = new Date(Date.now() - UNDO_WINDOW_MS).toISOString();
      const { data: expiredRows, error: expiredError } = await supabaseService
        .from('voice_notes')
        .select('id, user_id, audio_url, deleted_at')
        .not('deleted_at', 'is', null)
        .lt('deleted_at', cutoffIso);

      if (expiredError) {
        return errorResponse(stage, expiredError, 500);
      }

      const rows = (expiredRows ?? []) as VoiceNoteRow[];
      console.log('[cleanup-deleted-echo] sweep found expired rows', { count: rows.length });

      stage = 'sweep_finalize';
      let finalized = 0;
      let deferred = 0;

      for (const echo of rows) {
        const result = await finalizeEcho(supabaseService, echo);
        if (result.ok) finalized += 1;
        else deferred += 1;
      }

      return jsonResponse({ swept: rows.length, finalized, deferred });
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

    stage = 'parse_request_body';
    const body = await req.json().catch(() => ({}));
    const voiceNoteId = typeof body.voice_note_id === 'string' ? body.voice_note_id : '';

    if (!voiceNoteId) {
      return errorResponse(stage, 'voice_note_id is required', 400);
    }

    stage = 'fetch_echo';
    const { data: echo, error: echoError } = await supabaseService
      .from('voice_notes')
      .select('id, user_id, audio_url, deleted_at')
      .eq('id', voiceNoteId)
      .maybeSingle();

    if (echoError) {
      return errorResponse(stage, echoError, 500);
    }

    // Already finalized (by the sweep, or an earlier call) -- idempotent no-op.
    if (!echo) {
      return jsonResponse({ finalized: false, reason: 'already_gone' });
    }

    const voiceNote = echo as VoiceNoteRow;

    stage = 'ownership_check';
    if (voiceNote.user_id !== authData.user.id) {
      return errorResponse(stage, 'Echo is not owned by the current user', 403);
    }

    if (!voiceNote.deleted_at) {
      return errorResponse(stage, 'Echo is not pending deletion', 409);
    }

    stage = 'finalize';
    const result = await finalizeEcho(supabaseService, voiceNote);

    if (!result.ok) {
      // Best-effort per the client's undo-timer call -- the scheduled
      // sweep will retry this row, so this is not a fatal error.
      return jsonResponse({ finalized: false, reason: result.reason });
    }

    return jsonResponse({ finalized: true });
  } catch (error) {
    console.error('[cleanup-deleted-echo] function failed', { stage, error });
    return errorResponse(stage, String(error), 500);
  }
});
