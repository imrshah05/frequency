import { supabase } from './supabase';
import { echoImpactStoryFromAIImpact, type AIEchoImpact, type EchoImpactStory } from './echoImpact';

// The reveal queue: sealed Impacts their creator has never been shown.
//
// Echo Impact used to be something you could go and check while the Echo
// was still running, which turned a private reflection into a live
// scoreboard. It is now a moment that arrives once, after the Echo's 24
// hours are over and its story has been sealed. This module is the whole
// data side of that: find what is waiting, and record that it was seen.
//
// Deliberately not a subscription. The Impact is sealed by an hourly
// sweep, so there is nothing to watch in real time -- the app simply asks
// "is anything waiting for me" whenever it comes to the foreground.

export type PendingEchoReveal = {
  voiceNoteId: string;
  caption: string | null;
  echoCreatedAt: string;
  story: EchoImpactStory;
};

// One app open should never turn into a dozen full-screen moments. The
// sweep seals ten Echoes an hour and a person rarely has more than one or
// two waiting, so this is a safety rail rather than a real limit -- but if
// somebody comes back after a long absence, they get the oldest few and
// the rest stay pending for next time rather than becoming a queue nobody
// can get out of.
const REVEAL_QUEUE_LIMIT = 5;

// Sealing costs one AI call per Echo, so a backlog drains over a few
// launches rather than in one long stall. Deliberately the only bound:
// there is no recency cut-off, because an Echo that finished while its
// creator was away for a month is still owed its reveal the next time
// they open the app.
const SEAL_BATCH_LIMIT = 3;

type PendingRow = AIEchoImpact & {
  revealed_at: string | null;
  voice_notes: {
    id: string;
    caption: string | null;
    created_at: string;
    deleted_at: string | null;
  } | null;
};

/**
 * Every sealed Impact of this user's that has not been revealed yet,
 * oldest Echo first.
 *
 * Ordered so the reveals arrive in the order the Echoes were spoken --
 * walking forward through the days rather than backward. The database
 * order is by generated_at (oldest sealing first) because that is what
 * decides which rows the limit keeps; the batch is then re-sorted by the
 * Echo's own created_at, which is the order the person actually lived.
 *
 * The join is `!inner` so a soft-deleted Echo can never surface a reveal:
 * deleting an Echo does not cascade to its Impact (only a hard delete
 * does), and filtering those out here rather than in the caller keeps
 * them from silently eating the queue limit.
 */
export async function loadPendingEchoReveals(userId: string): Promise<PendingEchoReveal[]> {
  const { data, error } = await supabase
    .from('echo_impacts')
    .select('*, voice_notes!inner(id, caption, created_at, deleted_at)')
    .eq('user_id', userId)
    .eq('is_final', true)
    .is('revealed_at', null)
    .is('voice_notes.deleted_at', null)
    .order('generated_at', { ascending: true })
    .limit(REVEAL_QUEUE_LIMIT);

  if (error) {
    console.warn('[Echo Impact] Could not check for pending reveals.', error.message);
    return [];
  }

  return ((data ?? []) as PendingRow[])
    .filter((row) => !!row.voice_notes)
    .sort(
      (a, b) =>
        new Date(a.voice_notes!.created_at).getTime()
        - new Date(b.voice_notes!.created_at).getTime()
    )
    .map((row) => ({
      voiceNoteId: row.voice_note_id,
      caption: row.voice_notes!.caption,
      echoCreatedAt: row.voice_notes!.created_at,
      story: echoImpactStoryFromAIImpact(row),
    }));
}

/**
 * Records that this Echo's Impact has now been seen, so its reveal never
 * comes back.
 *
 * Goes through an RPC because a sealed Impact is immutable to clients by
 * policy -- see the migration for why that rule stays absolute and this
 * is the one exception to it. The function stamps only the caller's own
 * row and only if it is still unstamped, so calling it twice is harmless.
 */
export async function markEchoRevealSeen(voiceNoteId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_echo_impact_revealed', {
    p_voice_note_id: voiceNoteId,
  });

  // A reveal that was watched but could not be recorded will simply come
  // back next launch. That is the right way to fail: the alternative is
  // dropping an Impact its owner never saw.
  if (error) console.warn('[Echo Impact] Could not mark reveal as seen.', error.message);
}

/**
 * Seals any of this user's Echoes whose run has ended but whose Impact was
 * never finalised, so the reveal has something to find.
 *
 * Sealing was originally the scheduled sweep's job alone. The sweep still
 * exists and is unchanged -- but it has to be configured, and when it is
 * not, nothing in the product notices: Echoes finish, no Impact is ever
 * written, and the reveal has nothing to show for ever. Since the creator
 * is the only person who will ever see their own Impact, nothing has to
 * exist before they open the app, so the app can do the noticing itself.
 *
 * It calls the same `generate-echo-impact` function the sweep calls, in
 * its single-Echo mode, authenticated as the user. That path runs the
 * identical `generateAndSaveImpact` -- same eligibility thresholds, same
 * AI selection, same dedup guard, same freeze rule -- and returns early if
 * the Impact is already sealed. Two triggers, one implementation, so the
 * two can never produce different stories.
 *
 * Sealing late costs nothing in accuracy: every metric is windowed to the
 * Echo's own `created_at .. +24h`, so the numbers are identical whether
 * they are computed one hour or one month after the run ended. That is
 * what makes "whenever they next open the app" a complete answer rather
 * than a compromise.
 *
 * Takes no user: the RPC scopes itself to auth.uid(), so the signed-in
 * session is the only account it can ever touch.
 */
export async function sealFinishedEchoes(): Promise<void> {
  const { data, error } = await supabase.rpc('my_unsealed_finished_echoes', {
    batch_limit: SEAL_BATCH_LIMIT,
  });

  if (error) {
    console.warn('[Echo Impact] Could not look for unsealed Echoes.', error.message);
    return;
  }

  const ids = ((data ?? []) as { voice_note_id: string }[]).map((row) => row.voice_note_id);
  if (ids.length === 0) return;

  // Serially, not in parallel: each one is an AI call, and there is no
  // deadline here -- whatever does not get sealed on this launch is picked
  // up on the next one.
  for (const voiceNoteId of ids) {
    const { error: invokeError } = await supabase.functions.invoke('generate-echo-impact', {
      body: { voice_note_id: voiceNoteId },
    });

    if (invokeError) {
      console.warn('[Echo Impact] Could not seal an Echo.', voiceNoteId, invokeError.message);
    }
  }
}
