import { supabase } from './supabase';

type NotificationInput = {
  recipientId: string;
  actorId: string;
  type: 'tune_in' | 'comment' | 'reaction';
  voiceNoteId?: string | null;
  message: string;
};

export function deriveUsernameFromEmail(email?: string | null) {
  return email?.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '') || 'someone';
}

export async function createNotification({
  recipientId,
  actorId,
  type,
  voiceNoteId = null,
  message,
}: NotificationInput) {
  if (!recipientId || !actorId || recipientId === actorId) return;

  await supabase.from('notifications').insert({
    recipient_id: recipientId,
    actor_id: actorId,
    type,
    voice_note_id: voiceNoteId,
    message,
    read: false,
  });
}

/**
 * Removes a single Activity card for good. Goes through the
 * delete_notification RPC rather than a direct table delete -- notifications
 * predates this migration history so its RLS isn't visible from tracked
 * SQL, and the RPC scopes the delete to the caller's own recipient_id
 * server-side (see supabase/migrations/20260815000000_add_notification_delete.sql).
 */
export async function deleteNotification(notificationId: string) {
  const { error } = await supabase.rpc('delete_notification', {
    p_notification_id: notificationId,
  });

  if (error) throw error;
}
