import { supabase } from './supabase';

// Shared by Feed and Profile so both surfaces call the exact same RPCs /
// Edge Function the same way. See
// supabase/migrations/20260809010000_add_echo_archive_delete.sql and
// supabase/functions/cleanup-deleted-echo for the backend side.

export const DELETE_UNDO_WINDOW_MS = 7000;

export async function archiveEcho(echoId: string) {
  const { error } = await supabase.rpc('archive_echo', { echo_id: echoId });
  if (error) throw error;
}

export async function unarchiveEcho(echoId: string) {
  const { error } = await supabase.rpc('unarchive_echo', { echo_id: echoId });
  if (error) throw error;
}

export async function softDeleteEcho(echoId: string) {
  const { error } = await supabase.rpc('soft_delete_echo', { echo_id: echoId });
  if (error) throw error;
}

export async function restoreEcho(echoId: string) {
  const { error } = await supabase.rpc('restore_echo', { echo_id: echoId });
  if (error) throw error;
}

// Best-effort optimization to purge a deleted Echo sooner than the
// scheduled sweep. Intentionally swallows errors -- the sweep is the
// source of truth for eventual permanent deletion, this is not load
// bearing for correctness.
export async function finalizeDeletedEchoBestEffort(echoId: string) {
  try {
    await supabase.functions.invoke('cleanup-deleted-echo', {
      body: { voice_note_id: echoId },
    });
  } catch {
    // Scheduled sweep will catch this.
  }
}
