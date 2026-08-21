import { supabase } from './supabase';
import { echoExpiresAtIso } from './echoLifecycle';
import {
  nightPlayUsers,
  rawEventCount,
  uniqueEventUsers,
  type EchoEventRow,
  type EchoImpactMetrics,
} from './echoMetrics';

// The querying half of the canonical metric rule. The rule itself, and
// the reasoning behind each metric, lives in echoMetrics.ts -- kept
// separate so that math stays free of any Supabase or React Native
// import and can be reasoned about (and tested) on its own.

async function safeCount(table: string, filters: (query: any) => any) {
  try {
    const { count } = await filters(supabase.from(table).select('*', { count: 'exact', head: true }));
    return count ?? 0;
  } catch {
    return 0;
  }
}

// Live-Echo metrics only. Anything with a frozen snapshot must use
// metricsFromSnapshot instead -- a sealed Impact is never recomputed.
export async function loadLiveEchoMetrics(echo: {
  id: string;
  created_at: string;
}): Promise<EchoImpactMetrics> {
  const lifetimeEnd = echoExpiresAtIso(echo.created_at);

  const { data } = await supabase
    .from('echo_events')
    .select('user_id, event_type, created_at')
    .eq('voice_note_id', echo.id)
    .gte('created_at', echo.created_at)
    .lte('created_at', lifetimeEnd);

  const events = (data ?? []) as EchoEventRow[];

  const [hearts, comments, shares] = await Promise.all([
    safeCount('reactions', (query) => query.eq('voice_note_id', echo.id)),
    safeCount('notifications', (query) =>
      query
        .eq('voice_note_id', echo.id)
        .eq('type', 'comment')
        .gte('created_at', echo.created_at)
        .lte('created_at', lifetimeEnd)
    ),
    safeCount('whisper_messages', (query) =>
      query
        .eq('shared_voice_note_id', echo.id)
        .gte('created_at', echo.created_at)
        .lte('created_at', lifetimeEnd)
    ),
  ]);

  return {
    plays: uniqueEventUsers(events, 'play_started'),
    completions: uniqueEventUsers(events, 'completed'),
    replays: rawEventCount(events, 'replayed'),
    hearts,
    comments,
    shares,
    nightPlays: nightPlayUsers(events),
  };
}
