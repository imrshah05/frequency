// Canonical definition of what an Echo's interaction metrics mean.
//
// Before this module there were two divergent implementations: the Edge
// Function counted raw echo_events rows, while the Profile and Archives
// screens each kept their own copy that deduped by listener and reconciled
// against the authoritative tables. The same Echo could therefore report
// different numbers depending on which path rendered it.
//
// One rule now, applied identically on both sides:
//
//   plays / completions  unique listeners, not raw events. The cards say
//                        "people pressed play", so one person replaying
//                        five times is one person.
//   replays              raw count. Repeat listens are the entire point
//                        of this metric, so they are not deduped.
//   hearts               reactions table. echo_events 'liked' is an
//                        append-only mirror that is never removed when
//                        someone unlikes, so counting it overstates.
//   comments / shares    notifications and whisper_messages, the tables
//                        that actually hold them.
//   window               the Echo's 24h live run, created_at .. +24h.
//
// The Edge Function (supabase/functions/generate-echo-impact) implements
// this same rule server-side and is authoritative: anything with a frozen
// metrics_snapshot must read that snapshot rather than recompute here.
// This client copy exists only for Echoes that are still live and so have
// no snapshot yet. Changing a rule here means changing it there too.

export type EchoMetricEventType =
  | 'play_started'
  | 'completed'
  | 'replayed'
  | 'liked'
  | 'commented'
  | 'shared_to_whisper';

export type EchoEventRow = {
  user_id: string | null;
  event_type: string;
  created_at: string;
};

export type EchoImpactMetrics = {
  plays: number;
  completions: number;
  replays: number;
  hearts: number;
  comments: number;
  shares: number;
  nightPlays: number;
};

export const EMPTY_ECHO_METRICS: EchoImpactMetrics = {
  plays: 0,
  completions: 0,
  replays: 0,
  hearts: 0,
  comments: 0,
  shares: 0,
  nightPlays: 0,
};

// Night is measured in UTC to match the Edge Function's runtime clock, so
// the two sides bucket the same listen the same way. Listener-local time
// is Phase 3; until then the snapshot records this basis explicitly.
export function isNightHour(createdAt: string) {
  const hour = new Date(createdAt).getUTCHours();
  return hour >= 22 || hour < 5;
}

export function uniqueEventUsers(events: EchoEventRow[], eventType: EchoMetricEventType) {
  return new Set(
    events
      .filter((event) => event.event_type === eventType && event.user_id)
      .map((event) => event.user_id)
  ).size;
}

export function rawEventCount(events: EchoEventRow[], eventType: EchoMetricEventType) {
  return events.filter((event) => event.event_type === eventType).length;
}

export function nightPlayUsers(events: EchoEventRow[]) {
  return new Set(
    events
      .filter(
        (event) =>
          event.event_type === 'play_started' && event.user_id && isNightHour(event.created_at)
      )
      .map((event) => event.user_id)
  ).size;
}

export function completionRate(metrics: Pick<EchoImpactMetrics, 'plays' | 'completions'>) {
  if (metrics.plays === 0) return 0;
  return Math.round((metrics.completions / metrics.plays) * 100);
}

// Reads the metrics frozen into echo_impacts.metrics_snapshot by the Edge
// Function. Archived Echoes must come through here, never through a live
// recount, so an Echo's Impact never quietly changes after it is sealed.
export function metricsFromSnapshot(snapshot: unknown): EchoImpactMetrics | null {
  if (!snapshot || typeof snapshot !== 'object') return null;

  const raw = snapshot as Record<string, unknown>;
  const read = (key: string) => (typeof raw[key] === 'number' ? (raw[key] as number) : 0);

  if (
    typeof raw.plays !== 'number' &&
    typeof raw.completions !== 'number' &&
    typeof raw.replays !== 'number'
  ) {
    return null;
  }

  return {
    plays: read('plays'),
    completions: read('completions'),
    replays: read('replays'),
    hearts: read('likes'),
    comments: read('comments'),
    shares: read('whisper_shares'),
    nightPlays: read('night_plays'),
  };
}
