import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Produces an Echo's Impact story and persists it to echo_impacts.
//
// Two modes, both POST -- same shape as cleanup-deleted-echo:
//   1. Single-echo (the owner tapping Generate in the Impact modal):
//      Authorization: Bearer <user JWT>, body { "voice_note_id": "..." }
//      While the Echo is still live this produces a regenerable preview.
//   2. Sweep (the source of truth for the permanent record):
//      header "x-cron-secret: <ECHO_IMPACT_CRON_SECRET>", no body needed.
//      Seals the impact of every Echo whose 24h live run has ended.
//
// Why a sweep rather than a trigger: an Echo usually becomes "archived"
// by nothing happening at all -- its created_at simply ages past 24h.
// No column changes and no row is written, so there is no database event
// to hook. Sealing has to be discovered by time. See isEchoFinished.
//
// MANUAL STEP REQUIRED: this function does not schedule itself. In the
// Supabase dashboard, go to Database -> Cron Jobs and create a job that
// runs hourly, sending an HTTP POST to this function's URL with header
// "x-cron-secret" set to the same value as the ECHO_IMPACT_CRON_SECRET
// function secret (set that secret first: Edge Functions ->
// generate-echo-impact -> Secrets). Hourly is enough -- sealing is
// idempotent and an Echo has no deadline once its run is over.

const PROMPT_VERSION = 'echo-impact-v1';
const ECHO_LIVE_DURATION_MS = 24 * 60 * 60 * 1000;
// Caps how many Echoes one sweep run will seal. Each one costs an OpenAI
// call and runs serially, so this is really a time budget: at roughly
// 3-5s per Echo, 10 keeps a run well inside the platform's 150s wall
// clock even when several hit the duplicate-metric retry. A backlog is
// worked through across hourly runs rather than in one long invocation.
const SWEEP_BATCH_LIMIT = 10;
// Upper bound on a single OpenAI call. Comfortably above a normal
// response, low enough that ten sequential worst cases still fit inside
// the platform wall clock.
const OPENAI_TIMEOUT_MS = 25_000;
const MODEL = Deno.env.get('OPENAI_MODEL') ?? 'gpt-5.5';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const ECHO_IMPACT_CRON_SECRET = Deno.env.get('ECHO_IMPACT_CRON_SECRET') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type VoiceNote = {
  id: string;
  user_id: string;
  caption: string | null;
  duration?: number | null;
  created_at: string;
  archived_at?: string | null;
  deleted_at?: string | null;
};

// An Echo leaves the feed either because its owner archived it or because
// its 24h window simply elapsed. The second case writes nothing to the
// row -- "archived" is inferred at read time, and the RLS policy on
// voice_notes encodes the same rule -- so there is no state change to
// react to. The sweep therefore finds newly-finished Echoes by time, and
// this is the one place that decides an Echo's live run is over.
function isEchoFinished(voiceNote: VoiceNote, now = Date.now()) {
  if (voiceNote.archived_at) return true;
  return new Date(voiceNote.created_at).getTime() + ECHO_LIVE_DURATION_MS <= now;
}

type MetricsSnapshot = {
  plays: number;
  completions: number;
  replays: number;
  likes: number;
  comments: number;
  whisper_shares: number;
  night_plays: number;
  completion_rate: number;
  new_listeners: number;
  // How each signal was actually derived for this Echo. 'boolean' and
  // 'server_utc' are the pre-Phase-3 fallbacks; 'mixed' means some
  // listens carried the newer data and some did not.
  completion_basis: 'measured' | 'boolean' | 'mixed';
  night_plays_timezone_basis: 'listener_local' | 'server_utc' | 'mixed';
  echo: {
    caption: string | null;
    duration: number | null;
    created_at: string;
  };
  local_fallback_theme: string;
};

type ImpactCard = {
  emoji: string;
  title: string;
  number: string;
  metric_label: string;
  story: string;
};

type ImpactPayload = {
  theme: string;
  subtitle: string;
  cards: ImpactCard[];
  final_reflection: string;
};

// Supabase's background-task API. Without it, async work still pending
// when the response is sent may be cut short; with it, the instance
// stays alive until the promise settles (bounded by the platform's wall
// clock limit, 150s free / 400s paid).
//
// Declared rather than imported because it is a runtime global, and
// guarded because it does not exist outside the edge runtime -- there
// the work is simply left running, which is the old behaviour.
declare const EdgeRuntime:
  | { waitUntil?: (promise: Promise<unknown>) => void }
  | undefined;

function runInBackground(work: Promise<unknown>) {
  const guarded = work.catch((error) => {
    console.error('[generate-echo-impact] background task failed', {
      error: errorDetail(error),
    });
  });

  if (typeof EdgeRuntime !== 'undefined' && typeof EdgeRuntime?.waitUntil === 'function') {
    EdgeRuntime.waitUntil(guarded);
    return;
  }

  void guarded;
}

function errorDetail(error: unknown) {
  if (!error) return null;
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return error;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function errorResponse(stage: string, detail: unknown, status = 500) {
  const body = {
    error: 'Could not generate Echo Impact',
    stage,
    detail,
  };

  console.error('[generate-echo-impact] returning non-2xx response', {
    status,
    ...body,
  });

  return jsonResponse(body, status);
}

function completionRate(plays: number, completions: number) {
  if (plays === 0) return 0;
  return Math.round((completions / plays) * 100);
}

function fallbackTheme(metrics: MetricsSnapshot) {
  if (metrics.plays + metrics.completions + metrics.replays + metrics.likes + metrics.comments + metrics.whisper_shares <= 2) {
    return 'Still Finding Its People';
  }
  if (metrics.whisper_shares >= 2 || (metrics.whisper_shares > 0 && metrics.whisper_shares >= metrics.comments)) {
    return 'Ripple Maker';
  }
  if (metrics.night_plays > 0 && (metrics.night_plays >= 2 || metrics.night_plays / Math.max(metrics.plays, 1) >= 0.5)) {
    return 'Midnight Companion';
  }
  if (metrics.replays >= 2 || (metrics.replays > 0 && metrics.replays >= metrics.whisper_shares)) {
    return 'Worth Another Listen';
  }
  if (metrics.comments >= 2 || (metrics.comments > 0 && metrics.comments >= metrics.likes)) {
    return 'Spark Starter';
  }
  if (metrics.plays > 0 && metrics.plays <= 3 && metrics.completion_rate >= 60) {
    return 'Small Room, Strong Signal';
  }
  if (metrics.completion_rate >= 60 || metrics.completions >= 3) {
    return 'Final Word Energy';
  }
  if (metrics.likes > 0) return 'Quietly Loved';
  if (metrics.plays > 0) return 'Slow Bloom';
  return 'Quiet Comfort';
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm;
}

function counted(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${plural(count, singular, pluralForm)}`;
}

// An Echo nobody touched still gets a real, warm final impact rather than
// a wall of zeros. Per the product spec this must never read as failure,
// so it leans on what is actually true -- it was spoken, it had its run,
// it is kept -- instead of counting what did not happen. No OpenAI call is
// made for these; there is no interaction story to tell.
function silentEchoImpact(): ImpactPayload {
  return {
    theme: 'Kept For Yourself',
    subtitle: 'This one stayed quiet, and that is allowed.',
    cards: [
      {
        emoji: '🎙️',
        title: 'You Said It',
        number: '1',
        metric_label: 'Echo recorded',
        story: 'Some thoughts just need saying out loud. This one got said, and that part already counts.',
      },
      {
        emoji: '🌙',
        title: 'A Quiet Run',
        number: '24',
        metric_label: 'hours live',
        story: 'It sat in the feed for a full day without a sound coming back. Rooms are quiet sometimes.',
      },
      {
        emoji: '🌱',
        title: 'Yours To Keep',
        number: '1',
        metric_label: 'Echo in Your Echoes',
        story: 'It moves into Your Echoes now, exactly as you left it. Nothing about it expires.',
      },
    ],
    final_reflection:
      'This Echo lived its 24 hours quietly and is yours to keep.\n\nNot every Echo is for a room. Some are just for the record.',
  };
}

function fallbackImpact(metrics: MetricsSnapshot): ImpactPayload {
  const theme = fallbackTheme(metrics);
  const ripples = metrics.comments + metrics.whisper_shares;

  return {
    theme,
    subtitle: metrics.plays > 3
      ? 'Okay, this one found a little motion.'
      : 'Small room, but the signal still counts.',
    cards: [
      {
        emoji: '▶️',
        title: 'Found The Room',
        number: String(metrics.plays),
        metric_label: plural(metrics.plays, 'play', 'plays'),
        story: metrics.plays === 0
          ? 'This Echo is still waiting for its first listener.'
          : `${metrics.plays} ${metrics.plays === 1 ? 'person pressed' : 'people pressed'} play. Lowkey, that is the whole first step.`,
      },
      {
        emoji: '✅',
        title: 'Stayed With It',
        number: `${metrics.completion_rate}%`,
        metric_label: 'completion rate',
        story: metrics.completion_rate >= 60
          ? `${metrics.completion_rate}% stayed to the end. Not gonna lie, that is solid attention.`
          : `${metrics.completion_rate}% stayed to the end. A quiet start, still a real signal.`,
      },
      {
        emoji: '↩️',
        title: 'Second Pass',
        number: String(metrics.replays),
        metric_label: plural(metrics.replays, 'replay', 'replays'),
        story: metrics.replays > 0
          ? `One listen was apparently not enough ${metrics.replays} ${metrics.replays === 1 ? 'time' : 'times'}.`
          : 'No replays yet. Some Echoes land once and keep moving.',
      },
      {
        emoji: '💬',
        title: 'Ripple Check',
        number: String(ripples),
        metric_label: plural(ripples, 'comment or Whisper share', 'comments and Whisper shares'),
        story: ripples > 0
          ? `${ripples} ${ripples === 1 ? 'ripple came' : 'ripples came'} back from this Echo. Casual spark-starter behavior.`
          : 'No replies or Whisper shares yet. Quiet does not mean empty.',
      },
    ],
    final_reflection: `This Echo reached ${counted(metrics.plays, 'person', 'people')} and held a ${metrics.completion_rate}% completion rate. Not every Echo needs to be loud; this one has its own pace.`,
  };
}

// ---------------------------------------------------------------------
// Eligibility layer (code, never the model)
//
// Deciding *what is worth saying* is a product judgement, so it is made
// here against named thresholds rather than left to a model reading raw
// numbers. The model only ever sees facts that already cleared their
// bar, which is what stops it inventing significance for a metric that
// has none ("0 replays" is not an observation).
//
// Thresholds are starting values, deliberately in one place so they can
// be tuned without hunting through prose.
const ELIGIBILITY = {
  // One real listener is a true, tellable fact. Kept at 1 on purpose:
  // it guarantees any Echo somebody actually played has at least one
  // eligible fact, so the silent fallback stays reserved for Echoes
  // where nothing happened at all and never has to lie.
  PLAYS_MIN: 1,
  // A percentage needs a denominator worth quoting -- "100% stayed" off
  // a single listener is noise, not attention.
  COMPLETION_RATE_MIN: 70,
  COMPLETION_MIN_LISTENERS: 2,
  // Coming back at all is the signal; one deliberate return counts.
  REPLAYS_MIN: 1,
  REACTIONS_MIN: 1,
  COMMENTS_MIN: 1,
  WHISPER_SHARES_MIN: 1,
  // Night needs to be a shape, not a coincidence: at least two listens
  // and a meaningful share of the total.
  NIGHT_MIN_PLAYS: 2,
  NIGHT_RATIO_MIN: 0.4,
  // Late-night in the listener's own local time (Phase 3). Applied to
  // the shifted hour when a listen carries an offset, and to the UTC
  // hour when it does not.
  NIGHT_LOCAL_START_HOUR: 22,
  NIGHT_LOCAL_END_HOUR: 5,
  // How much of an Echo counts as having heard it (Phase 3). Not 100:
  // trailing silence and a listener closing the app on the last word
  // should still count as finishing.
  COMPLETION_HEARD_PCT: 90,
  // Two rather than one, deliberately. A creator whose Echo had a
  // single listener would otherwise learn that specific person had
  // never heard them before -- an aggregate of one is not an aggregate.
  NEW_LISTENERS_MIN: 2,
} as const;

type MetricId =
  | 'plays'
  | 'completion'
  | 'replays'
  | 'reactions'
  | 'comments'
  | 'whisper_shares'
  | 'night'
  | 'new_listeners';

// One entry per genuinely distinct thing that happened. `number` and
// `display` are computed here, so the model never supplies a figure and
// therefore cannot get one wrong or mis-pluralise it.
type EligibleFact = {
  metric_id: MetricId;
  label: string;
  value: number;
  display: string;
  number: string;
  emoji: string;
};

function nightRatio(metrics: MetricsSnapshot) {
  if (metrics.plays === 0) return 0;
  return metrics.night_plays / metrics.plays;
}

function eligibleFacts(metrics: MetricsSnapshot): EligibleFact[] {
  const facts: EligibleFact[] = [];

  if (metrics.plays >= ELIGIBILITY.PLAYS_MIN) {
    facts.push({
      metric_id: 'plays',
      label: plural(metrics.plays, 'person pressed play', 'people pressed play'),
      value: metrics.plays,
      display: counted(metrics.plays, 'person', 'people'),
      number: String(metrics.plays),
      emoji: '▶️',
    });
  }

  if (
    metrics.completion_rate >= ELIGIBILITY.COMPLETION_RATE_MIN &&
    metrics.plays >= ELIGIBILITY.COMPLETION_MIN_LISTENERS
  ) {
    facts.push({
      metric_id: 'completion',
      label: 'stayed until the end',
      value: metrics.completion_rate,
      display: `${metrics.completion_rate}%`,
      number: `${metrics.completion_rate}%`,
      emoji: '✅',
    });
  }

  if (metrics.replays >= ELIGIBILITY.REPLAYS_MIN) {
    facts.push({
      metric_id: 'replays',
      label: plural(metrics.replays, 'return listen', 'return listens'),
      value: metrics.replays,
      display: counted(metrics.replays, 'replay'),
      number: String(metrics.replays),
      emoji: '↩️',
    });
  }

  if (metrics.likes >= ELIGIBILITY.REACTIONS_MIN) {
    facts.push({
      metric_id: 'reactions',
      label: plural(metrics.likes, 'heart landed here', 'hearts landed here'),
      value: metrics.likes,
      display: counted(metrics.likes, 'heart'),
      number: String(metrics.likes),
      emoji: '❤️',
    });
  }

  if (metrics.comments >= ELIGIBILITY.COMMENTS_MIN) {
    facts.push({
      metric_id: 'comments',
      label: plural(metrics.comments, 'reply started here', 'replies started here'),
      value: metrics.comments,
      display: counted(metrics.comments, 'reply', 'replies'),
      number: String(metrics.comments),
      emoji: '💬',
    });
  }

  if (metrics.whisper_shares >= ELIGIBILITY.WHISPER_SHARES_MIN) {
    facts.push({
      metric_id: 'whisper_shares',
      label: plural(metrics.whisper_shares, 'Whisper share', 'Whisper shares'),
      value: metrics.whisper_shares,
      display: counted(metrics.whisper_shares, 'Whisper share'),
      number: String(metrics.whisper_shares),
      emoji: '✉️',
    });
  }

  if (
    metrics.night_plays >= ELIGIBILITY.NIGHT_MIN_PLAYS &&
    nightRatio(metrics) >= ELIGIBILITY.NIGHT_RATIO_MIN
  ) {
    facts.push({
      metric_id: 'night',
      label:
        metrics.night_plays_timezone_basis === 'server_utc'
          ? 'listened late at night'
          : 'listened late their time',
      value: metrics.night_plays,
      display: counted(metrics.night_plays, 'listener'),
      number: String(metrics.night_plays),
      emoji: '🌙',
    });
  }

  // Aggregate only. The count says how many first-time ears heard this
  // Echo; who they were never leaves countNewListeners.
  if (metrics.new_listeners >= ELIGIBILITY.NEW_LISTENERS_MIN) {
    facts.push({
      metric_id: 'new_listeners',
      label: 'heard you for the first time',
      value: metrics.new_listeners,
      display: counted(metrics.new_listeners, 'new listener'),
      number: String(metrics.new_listeners),
      emoji: '👋',
    });
  }

  return facts;
}

// Canonical metric rule -- the client mirror lives in lib/echoMetrics.ts
// and must be changed alongside this. See that file's header for why each
// metric is counted the way it is. In short: plays/completions/night are
// unique listeners because the copy says "people", replays stay a raw
// count because repeat listens are the point, and hearts/comments/shares
// come from the tables that actually own them rather than from the
// append-only echo_events mirror (which never drops a row on unlike).
type EchoEventRow = {
  user_id: string | null;
  event_type: string;
  created_at: string;
  // Phase 3, all nullable. Absent on every event written before that
  // capture shipped, and on any client that has not updated -- each
  // signal below degrades to its Phase 1 equivalent per listen rather
  // than per Echo, so one old listen never invalidates a whole Impact.
  heard_ms?: number | null;
  total_ms?: number | null;
  utc_offset_minutes?: number | null;
};

function echoWindow(createdAt: string) {
  const start = new Date(createdAt);
  const end = new Date(start.getTime() + ECHO_LIVE_DURATION_MS);

  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function uniqueEventUsers(events: EchoEventRow[], eventType: string) {
  return new Set(
    events
      .filter((event) => event.event_type === eventType && event.user_id)
      .map((event) => event.user_id)
  ).size;
}

function rawEventCount(events: EchoEventRow[], eventType: string) {
  return events.filter((event) => event.event_type === eventType).length;
}

// Night, measured where the listener actually was. When a listen
// carries the listener's own UTC offset the hour is shifted into their
// local time; without one it falls back to the Phase 1 UTC bucket for
// that listen alone.
function listenLocalHour(event: EchoEventRow) {
  const at = new Date(event.created_at);

  if (typeof event.utc_offset_minutes === 'number') {
    return new Date(at.getTime() + event.utc_offset_minutes * 60_000).getUTCHours();
  }

  return at.getUTCHours();
}

function isNightHour(hour: number) {
  return hour >= ELIGIBILITY.NIGHT_LOCAL_START_HOUR || hour < ELIGIBILITY.NIGHT_LOCAL_END_HOUR;
}

type NightSignal = {
  nightPlays: number;
  basis: 'listener_local' | 'server_utc' | 'mixed';
};

function nightSignal(events: EchoEventRow[]): NightSignal {
  const plays = events.filter((event) => event.event_type === 'play_started' && event.user_id);
  const withOffset = plays.filter((event) => typeof event.utc_offset_minutes === 'number').length;

  const nightPlays = new Set(
    plays.filter((event) => isNightHour(listenLocalHour(event))).map((event) => event.user_id)
  ).size;

  const basis: NightSignal['basis'] =
    withOffset === 0 ? 'server_utc' : withOffset === plays.length ? 'listener_local' : 'mixed';

  return { nightPlays, basis };
}

// Completion, measured as how much of the Echo a listener actually
// heard rather than whether the clip happened to reach its end.
//
// Per listener: the furthest point they reached over the Echo's whole
// run, as a percentage of its length. Crossing COMPLETION_HEARD_PCT
// counts as having finished it, and completion_rate stays what it has
// always been -- the share of listeners who did -- so the Phase 2
// threshold keeps its exact meaning.
//
// A listener with no measured progress (old event, or a client that
// does not send it yet) falls back to the boolean 'completed' flag.
// The fallback is per listener, not per Echo, so one stale listen does
// not drag a whole Impact back to the old signal.
type CompletionSignal = {
  completions: number;
  completionRate: number;
  basis: 'measured' | 'boolean' | 'mixed';
};

function completionSignal(events: EchoEventRow[], voiceNote: VoiceNote): CompletionSignal {
  const listeners = new Set(
    events
      .filter((event) => event.event_type === 'play_started' && event.user_id)
      .map((event) => event.user_id as string)
  );

  const fallbackTotalMs =
    typeof voiceNote.duration === 'number' && voiceNote.duration > 0
      ? voiceNote.duration * 1000
      : null;

  // Furthest percentage reached per listener.
  const heardPctByUser = new Map<string, number>();

  for (const event of events) {
    if (event.event_type !== 'listen_progress' || !event.user_id) continue;
    if (typeof event.heard_ms !== 'number' || event.heard_ms <= 0) continue;

    const totalMs =
      typeof event.total_ms === 'number' && event.total_ms > 0 ? event.total_ms : fallbackTotalMs;

    if (!totalMs) continue;

    const pct = Math.min(100, (event.heard_ms / totalMs) * 100);
    heardPctByUser.set(event.user_id, Math.max(heardPctByUser.get(event.user_id) ?? 0, pct));
  }

  const finishedByFlag = new Set(
    events
      .filter((event) => event.event_type === 'completed' && event.user_id)
      .map((event) => event.user_id as string)
  );

  let completions = 0;
  let measured = 0;

  for (const listener of listeners) {
    const pct = heardPctByUser.get(listener);

    if (pct === undefined) {
      if (finishedByFlag.has(listener)) completions += 1;
      continue;
    }

    measured += 1;
    if (pct >= ELIGIBILITY.COMPLETION_HEARD_PCT) completions += 1;
  }

  const basis: CompletionSignal['basis'] =
    listeners.size === 0 || measured === 0
      ? 'boolean'
      : measured === listeners.size
        ? 'measured'
        : 'mixed';

  return {
    completions,
    completionRate: completionRate(listeners.size, completions),
    basis,
  };
}

async function loadEchoEvents(
  supabase: ReturnType<typeof createClient>,
  voiceNoteId: string,
  window: { startIso: string; endIso: string }
) {
  const { data, error } = await supabase
    .from('echo_events')
    .select('user_id, event_type, created_at, heard_ms, total_ms, utc_offset_minutes')
    .eq('voice_note_id', voiceNoteId)
    .gte('created_at', window.startIso)
    .lte('created_at', window.endIso);

  if (error) {
    console.error('[generate-echo-impact] echo_events fetch failed', { voiceNoteId, error });
    throw error;
  }

  return (data ?? []) as EchoEventRow[];
}

// New listeners: people who heard this Echo having never played any of
// this creator's earlier Echoes before.
//
// Deliberately behavioural rather than relationship-based. "Not Tuned
// In" would keep calling someone new forever if they listen every day
// without ever following, which overstates newness; never having
// pressed play on this voice before is a fact that stays true.
//
// Only a count ever leaves this function. Identities are read to
// compute the diff and then discarded -- the Impact says "new ears",
// never who they were.
async function countNewListeners(
  supabase: ReturnType<typeof createClient>,
  voiceNote: VoiceNote,
  events: EchoEventRow[]
) {
  // First time each listener pressed play on this Echo.
  const firstPlayByUser = new Map<string, number>();

  for (const event of events) {
    if (event.event_type !== 'play_started' || !event.user_id) continue;

    const at = new Date(event.created_at).getTime();
    firstPlayByUser.set(event.user_id, Math.min(firstPlayByUser.get(event.user_id) ?? at, at));
  }

  if (firstPlayByUser.size === 0) return 0;

  const { data: otherEchoes, error: otherEchoesError } = await supabase
    .from('voice_notes')
    .select('id')
    .eq('user_id', voiceNote.user_id)
    .neq('id', voiceNote.id);

  if (otherEchoesError) {
    console.error('[generate-echo-impact] other Echoes lookup failed', { error: otherEchoesError });
    return 0;
  }

  const otherEchoIds = (otherEchoes ?? []).map((row: any) => row.id);
  if (otherEchoIds.length === 0) return firstPlayByUser.size;

  const { data: priorPlays, error: priorPlaysError } = await supabase
    .from('echo_events')
    .select('user_id, created_at')
    .eq('event_type', 'play_started')
    .in('voice_note_id', otherEchoIds)
    .in('user_id', Array.from(firstPlayByUser.keys()));

  if (priorPlaysError) {
    console.error('[generate-echo-impact] prior plays lookup failed', { error: priorPlaysError });
    return 0;
  }

  // Earliest time each of these listeners ever played this creator.
  const earliestPriorByUser = new Map<string, number>();

  for (const row of (priorPlays ?? []) as { user_id: string | null; created_at: string }[]) {
    if (!row.user_id) continue;

    const at = new Date(row.created_at).getTime();
    earliestPriorByUser.set(
      row.user_id,
      Math.min(earliestPriorByUser.get(row.user_id) ?? at, at)
    );
  }

  let newListeners = 0;

  for (const [userId, firstPlay] of firstPlayByUser) {
    const earliestPrior = earliestPriorByUser.get(userId);

    // New if they had never played this creator before this listen.
    // Comparing against their own first play rather than the Echo's
    // start keeps it right for someone who discovers the creator
    // through an older Echo midway through this one's run.
    if (earliestPrior === undefined || earliestPrior >= firstPlay) newListeners += 1;
  }

  return newListeners;
}

async function countRows(
  supabase: ReturnType<typeof createClient>,
  table: string,
  apply: (query: any) => any
) {
  try {
    const { count, error } = await apply(
      supabase.from(table).select('*', { count: 'exact', head: true })
    );

    if (error) {
      console.error('[generate-echo-impact] count failed', { table, error });
      return 0;
    }

    return count ?? 0;
  } catch (error) {
    console.error('[generate-echo-impact] count threw', { table, error: errorDetail(error) });
    return 0;
  }
}

async function buildMetrics(supabase: ReturnType<typeof createClient>, voiceNote: VoiceNote): Promise<MetricsSnapshot> {
  const window = echoWindow(voiceNote.created_at);
  const events = await loadEchoEvents(supabase, voiceNote.id, window);

  const [likes, comments, whisperShares] = await Promise.all([
    countRows(supabase, 'reactions', (query: any) => query.eq('voice_note_id', voiceNote.id)),
    countRows(supabase, 'notifications', (query: any) =>
      query
        .eq('voice_note_id', voiceNote.id)
        .eq('type', 'comment')
        .gte('created_at', window.startIso)
        .lte('created_at', window.endIso)
    ),
    countRows(supabase, 'whisper_messages', (query: any) =>
      query
        .eq('shared_voice_note_id', voiceNote.id)
        .gte('created_at', window.startIso)
        .lte('created_at', window.endIso)
    ),
  ]);

  const plays = uniqueEventUsers(events, 'play_started');
  const completion = completionSignal(events, voiceNote);
  const night = nightSignal(events);
  const newListeners = await countNewListeners(supabase, voiceNote, events);

  const metrics = {
    plays,
    completions: completion.completions,
    replays: rawEventCount(events, 'replayed'),
    likes,
    comments,
    whisper_shares: whisperShares,
    night_plays: night.nightPlays,
    completion_rate: completion.completionRate,
    new_listeners: newListeners,
    // Recorded so a stored snapshot always says how it was measured --
    // an Impact frozen before Phase 3 capture is not comparable to one
    // frozen after it, and the snapshot should not pretend otherwise.
    completion_basis: completion.basis,
    night_plays_timezone_basis: night.basis,
    echo: {
      caption: voiceNote.caption,
      duration: voiceNote.duration ?? null,
      created_at: voiceNote.created_at,
    },
    local_fallback_theme: 'Quiet Comfort',
  };

  return {
    ...metrics,
    local_fallback_theme: fallbackTheme(metrics),
  };
}

function totalInteractions(metrics: MetricsSnapshot) {
  return (
    metrics.plays +
    metrics.completions +
    metrics.replays +
    metrics.likes +
    metrics.comments +
    metrics.whisper_shares
  );
}

// metric_id is constrained to the eligible ids by enum, so the model
// cannot name a metric that did not clear its threshold. maxItems is
// capped by how many facts actually exist, which is what stops it
// padding a thin Echo up to three observations.
function schema(facts: EligibleFact[]) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['theme', 'subtitle', 'observations', 'closing'],
    properties: {
      theme: { type: 'string' },
      subtitle: { type: 'string' },
      observations: {
        type: 'array',
        minItems: 1,
        maxItems: Math.min(3, facts.length),
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['metric_id', 'title', 'body'],
          properties: {
            metric_id: { type: 'string', enum: facts.map((fact) => fact.metric_id) },
            title: { type: 'string' },
            body: { type: 'string' },
          },
        },
      },
      closing: { type: ['string', 'null'] },
    },
  };
}

function prompt(facts: EligibleFact[], correction?: string) {
  const factLines = facts
    .map(
      (fact) =>
        `- metric_id "${fact.metric_id}" — ${fact.display} ${fact.label}. If you mention this number, write it exactly as "${fact.display}".`
    )
    .join('\n');

  const maxObservations = Math.min(3, facts.length);

  return `Frequency is a private, voice-first social app.
Echoes live in the feed for 24 hours, then stay forever in Your Echoes.
Echo Impact tells the story of what happened to one Echo.
This is not analytics. This is not public validation.
The user should feel curious, seen, and encouraged.

Write like a cool, emotionally intelligent friend: friendly, chill, witty, Gen Z-light, grounded, positive but not fake sunshine.
Avoid corporate analytics, motivational language, LinkedIn energy, fake wholesomeness, and phrases like "your voice touched hearts", "spread light", "beautiful journey", "radiated positivity", or "inspired many".
Never shame low numbers. Never compare users. Never say "only". Do not over-celebrate weak metrics.
Use slang lightly, not in every observation. No markdown. No bullets.

Below is everything notable that happened to this Echo. Nothing else happened that is worth mentioning, so do not refer to, imply, or invent any other metric — and never mention something being absent, low, or missing.

${factLines}

Pick the ${maxObservations === 1 ? 'single most interesting fact' : `up to ${maxObservations} most interesting facts`} and write one short observation for each.

Rules:
- Use each metric_id at most once. Two observations about the same fact is the one thing that ruins this feature.
- Return at most ${maxObservations} observation${maxObservations === 1 ? '' : 's'}. Fewer is fine if only some are genuinely worth saying. Never pad.
- title: 2-4 words, no number in it.
- body: one or two sentences about what that fact felt like from the outside. Specific, warm, never negative.
- theme: 2-4 words naming the character of this Echo's run, drawn from the facts you picked.
- subtitle: one short line under the theme.
- closing: optional. Use null unless you can write one line that ties the facts you picked together into something neither says alone. It must not restate a single fact.${correction ? `\n\n${correction}` : ''}`;
}

function outputText(openAIResponse: any) {
  if (typeof openAIResponse.output_text === 'string') return openAIResponse.output_text;

  const firstText = openAIResponse.output
    ?.flatMap((item: any) => item.content ?? [])
    ?.find((content: any) => content.type === 'output_text' && typeof content.text === 'string');

  return firstText?.text ?? '';
}

function fallbackImpactWithLog(metrics: MetricsSnapshot, reason: string) {
  console.warn('[generate-echo-impact] using fallback impact', {
    reason,
    metrics,
  });

  return fallbackImpact(metrics);
}

// ---------------------------------------------------------------------
// AI select-and-write
//
// The model receives only eligible facts -- never raw metrics -- and
// chooses which of them are worth saying. It writes prose and nothing
// else: every number on a card is attached afterwards from the fact
// itself, so a figure can never be wrong or mis-pluralised.

type Observation = {
  metric_id: string;
  title: string;
  body: string;
};

type AiSelection = {
  theme: string;
  subtitle: string;
  observations: Observation[];
  closing: string | null;
};

async function callSelectAndWrite(
  facts: EligibleFact[],
  correction?: string
): Promise<AiSelection | null> {
  // Without a bound, one hung request blocks the whole serial sweep until
  // the instance is killed, starving every Echo behind it in the batch.
  // This confines the damage to the one Echo, which then falls through to
  // the deterministic fallback like any other failure.
  const abort = new AbortController();
  const abortTimer = setTimeout(() => abort.abort(), OPENAI_TIMEOUT_MS);

  let response: Response;

  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      signal: abort.signal,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        input: [
          {
            role: 'system',
            content: 'You return valid JSON for a private social app feature called Echo Impact.',
          },
          {
            role: 'user',
            content: prompt(facts, correction),
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'echo_impact',
            strict: true,
            schema: schema(facts),
          },
        },
      }),
    });
  } catch (error) {
    const timedOut = abort.signal.aborted;
    console.error('[generate-echo-impact] OpenAI request failed', {
      timedOut,
      timeoutMs: OPENAI_TIMEOUT_MS,
      error: errorDetail(error),
    });
    return null;
  } finally {
    clearTimeout(abortTimer);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('[generate-echo-impact] OpenAI error body', {
      status: response.status,
      errorBody,
    });
    return null;
  }

  const data = await response.json();
  const rawText = outputText(data);

  try {
    const parsed = JSON.parse(rawText) as AiSelection;

    if (!parsed || !Array.isArray(parsed.observations)) {
      console.warn('[generate-echo-impact] AI payload missing observations', { parsed });
      return null;
    }

    return parsed;
  } catch (error) {
    console.error('[generate-echo-impact] Echo Impact JSON parse failed', {
      error: errorDetail(error),
      rawText,
    });
    return null;
  }
}

// Verification guard (code, never the model). Structured output makes a
// duplicate metric_id unlikely but not impossible, and a repeat is the
// specific failure this phase exists to prevent -- so it is checked
// rather than assumed.
function findDuplicateMetricId(observations: Observation[]) {
  const seen = new Set<string>();

  for (const observation of observations) {
    if (seen.has(observation.metric_id)) return observation.metric_id;
    seen.add(observation.metric_id);
  }

  return null;
}

function dropRepeatedMetricIds(observations: Observation[]) {
  const seen = new Set<string>();

  return observations.filter((observation) => {
    if (seen.has(observation.metric_id)) return false;
    seen.add(observation.metric_id);
    return true;
  });
}

// metric_id arrives as an untrusted string from the model, so the lookup
// is keyed by string and membership is what proves it is a real fact.
function factsById(facts: EligibleFact[]) {
  return new Map<string, EligibleFact>(facts.map((fact) => [fact.metric_id, fact]));
}

function usableObservations(observations: Observation[], facts: EligibleFact[]) {
  const byId = factsById(facts);

  return observations.filter(
    (observation) =>
      observation
      && byId.has(observation.metric_id)
      && typeof observation.title === 'string'
      && observation.title.trim().length > 0
      && typeof observation.body === 'string'
      && observation.body.trim().length > 0
  );
}

function impactFromSelection(selection: AiSelection, facts: EligibleFact[]): ImpactPayload {
  const byId = factsById(facts);

  const cards: ImpactCard[] = selection.observations.map((observation) => {
    const fact = byId.get(observation.metric_id)!;

    return {
      emoji: fact.emoji,
      title: observation.title.trim(),
      number: fact.number,
      metric_label: fact.label,
      story: observation.body.trim(),
    };
  });

  return {
    theme: selection.theme?.trim() || 'Your Echo',
    subtitle: selection.subtitle?.trim() || 'Here is how this one landed.',
    cards,
    // Optional by design. An empty string means the UI renders no
    // closing card at all rather than an empty one.
    final_reflection: selection.closing?.trim() ?? '',
  };
}

// The saved row's `model` column is an audit trail: it is what tells a
// future read of echo_impacts whether a story was actually written by
// the model or is one of the two fixed scripts. So it has to come from
// whichever branch below actually ran, never guessed afterward from
// unrelated signals like "was a key configured" -- that guess is what
// let every fallback in this table get saved labelled as gpt-4.1-mini.
type GeneratedImpact = {
  impact: ImpactPayload;
  model: string;
};

const FALLBACK_MODEL_LABEL = 'fallback';
const SILENT_MODEL_LABEL = 'silent-echo';

async function generateImpact(metrics: MetricsSnapshot): Promise<GeneratedImpact> {
  const facts = eligibleFacts(metrics);

  console.log('[generate-echo-impact] generateImpact start', {
    hasOpenAIKey: OPENAI_API_KEY.length > 0,
    model: MODEL,
    totalInteractions: totalInteractions(metrics),
    eligibleFacts: facts.map((fact) => fact.metric_id),
  });

  // Nothing cleared a threshold. If nothing happened at all, the warm
  // silent copy is the honest answer and no call is made. If something
  // did happen but stayed under every bar, the deterministic fallback
  // reports the real numbers -- the silent copy would be a lie there.
  if (facts.length === 0) {
    if (totalInteractions(metrics) === 0) {
      console.log('[generate-echo-impact] no interactions, using silent Echo impact');
      return { impact: silentEchoImpact(), model: SILENT_MODEL_LABEL };
    }

    return {
      impact: fallbackImpactWithLog(metrics, 'no metric cleared its eligibility threshold'),
      model: FALLBACK_MODEL_LABEL,
    };
  }

  if (!OPENAI_API_KEY) {
    return {
      impact: fallbackImpactWithLog(metrics, 'OPENAI_API_KEY is missing'),
      model: FALLBACK_MODEL_LABEL,
    };
  }

  let selection = await callSelectAndWrite(facts);

  if (selection) {
    const duplicate = findDuplicateMetricId(selection.observations);

    if (duplicate) {
      console.warn('[generate-echo-impact] duplicate metric_id, retrying once', { duplicate });

      const retry = await callSelectAndWrite(
        facts,
        `Your previous answer used metric_id "${duplicate}" more than once. Every observation must use a different metric_id. Return fewer observations rather than repeating one.`
      );

      if (retry) selection = retry;
    }
  }

  if (!selection) {
    return {
      impact: fallbackImpactWithLog(metrics, 'AI select-and-write failed'),
      model: FALLBACK_MODEL_LABEL,
    };
  }

  // Last resort after the retry: keep the first mention of each fact and
  // drop the repeat, so the user sees a shorter Impact rather than the
  // same thing said twice.
  const deduped = dropRepeatedMetricIds(usableObservations(selection.observations, facts));

  if (deduped.length === 0) {
    return {
      impact: fallbackImpactWithLog(metrics, 'AI returned no usable observations'),
      model: FALLBACK_MODEL_LABEL,
    };
  }

  if (deduped.length !== selection.observations.length) {
    console.warn('[generate-echo-impact] dropped repeated or unusable observations', {
      returned: selection.observations.length,
      kept: deduped.length,
    });
  }

  return {
    impact: impactFromSelection({ ...selection, observations: deduped.slice(0, 3) }, facts),
    model: MODEL,
  };
}

type SaveOutcome = {
  saved: Record<string, unknown> | null;
  error: unknown;
  sealed: boolean;
  skipped?: 'already_sealed';
};

// Single path to producing and persisting an Echo Impact, shared by the
// owner-triggered request and the scheduled sweep.
//
// The seal is the freeze guard the product spec asks for. Once an Echo's
// live run is over its impact is written with is_final = true and is never
// regenerated or recomputed again -- not by a later sweep, not by the
// owner reopening the modal. While an Echo is still live its impact is
// only a preview, so regenerating is allowed and the final sweep will
// overwrite it with the complete 24h picture.
async function generateAndSaveImpact(
  supabaseService: ReturnType<typeof createClient>,
  voiceNote: VoiceNote
): Promise<SaveOutcome> {
  const { data: existing, error: existingError } = await supabaseService
    .from('echo_impacts')
    .select('*')
    .eq('voice_note_id', voiceNote.id)
    .maybeSingle();

  if (existingError) {
    return { saved: null, error: existingError, sealed: false };
  }

  if (existing?.is_final) {
    console.log('[generate-echo-impact] impact already sealed, returning stored copy', {
      voiceNoteId: voiceNote.id,
    });
    return { saved: existing, error: null, sealed: true, skipped: 'already_sealed' };
  }

  const seal = isEchoFinished(voiceNote);
  const metrics = await buildMetrics(supabaseService, voiceNote);
  const { impact, model: usedModel } = await generateImpact(metrics);

  const { data: saved, error: saveError } = await supabaseService
    .from('echo_impacts')
    .upsert(
      {
        voice_note_id: voiceNote.id,
        user_id: voiceNote.user_id,
        theme: impact.theme,
        subtitle: impact.subtitle,
        cards: impact.cards,
        final_reflection: impact.final_reflection,
        metrics_snapshot: metrics,
        model: usedModel,
        prompt_version: PROMPT_VERSION,
        is_final: seal,
        generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'voice_note_id' }
    )
    .select('*')
    .single();

  return { saved, error: saveError, sealed: seal };
}

// Freezes the impact of every Echo whose live run has ended and that does
// not have a sealed impact yet. Idempotent: an Echo already sealed is
// skipped, so re-running the sweep is harmless.
// Split in two on purpose. The scheduled caller (a dashboard Cron Job)
// caps its HTTP request at 5s, but a batch of Echoes takes tens of
// seconds because each one may make an OpenAI call. So the request does
// only the fast half -- one RPC to find out what is pending -- and the
// slow half runs as a background task after the response is sent.
async function pendingFinishedEchoes(supabaseService: ReturnType<typeof createClient>) {
  // unsealed_finished_echoes does the "finished but not sealed" test in
  // SQL so each run stays bounded regardless of how many Echoes exist.
  const { data: candidates, error: candidateError } = await supabaseService.rpc(
    'unsealed_finished_echoes',
    { batch_limit: SWEEP_BATCH_LIMIT }
  );

  if (candidateError) throw candidateError;

  return (candidates ?? []) as VoiceNote[];
}

// Seals one Echo at a time, committing each before starting the next.
// That per-Echo upsert is what makes the sweep crash-safe: if the
// instance is torn down partway through, everything already sealed
// stays sealed and the next run resumes at the first unsealed Echo.
// Deliberately not wrapped in a batch-level transaction -- that would
// trade this property for nothing.
async function processPendingEchoes(
  supabaseService: ReturnType<typeof createClient>,
  pending: VoiceNote[]
) {
  let sealed = 0;
  let failed = 0;

  for (const echo of pending) {
    try {
      const outcome = await generateAndSaveImpact(supabaseService, echo);

      if (outcome.error || !outcome.saved) {
        failed += 1;
        console.error('[generate-echo-impact] sweep failed to seal Echo', {
          voiceNoteId: echo.id,
          error: errorDetail(outcome.error),
        });
        continue;
      }

      sealed += 1;
    } catch (error) {
      failed += 1;
      console.error('[generate-echo-impact] sweep threw for Echo', {
        voiceNoteId: echo.id,
        error: errorDetail(error),
      });
    }
  }

  console.log('[generate-echo-impact] sweep finished', {
    considered: pending.length,
    sealed,
    failed,
  });

  return { considered: pending.length, sealed, failed };
}

Deno.serve(async (req) => {
  console.log('[generate-echo-impact] function start', {
    method: req.method,
    hasOpenAIKey: OPENAI_API_KEY.length > 0,
    model: MODEL,
  });

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
      console.error('[generate-echo-impact] Supabase environment is not configured', {
        hasUrl: SUPABASE_URL.length > 0,
        hasAnonKey: SUPABASE_ANON_KEY.length > 0,
        hasServiceRoleKey: SUPABASE_SERVICE_ROLE_KEY.length > 0,
      });
      return errorResponse(
        stage,
        {
          hasUrl: SUPABASE_URL.length > 0,
          hasAnonKey: SUPABASE_ANON_KEY.length > 0,
          hasServiceRoleKey: SUPABASE_SERVICE_ROLE_KEY.length > 0,
        },
        500
      );
    }

    const authorization = req.headers.get('Authorization') ?? '';
    const supabaseForUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authorization } },
    });
    const supabaseService = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Scheduled sweep mode. Same shape as cleanup-deleted-echo: a shared
    // secret header instead of a user JWT, since there is no user behind
    // this call. See the MANUAL STEP note at the top of this file.
    stage = 'sweep_mode_check';
    const cronSecretHeader = req.headers.get('x-cron-secret') ?? '';

    if (ECHO_IMPACT_CRON_SECRET && cronSecretHeader === ECHO_IMPACT_CRON_SECRET) {
      stage = 'sweep';
      console.log('[generate-echo-impact] running scheduled sweep');

      // Only the lookup is awaited -- one RPC, milliseconds -- so the
      // caller always gets its answer well inside the 5s cap it allows.
      const pending = await pendingFinishedEchoes(supabaseService);

      console.log('[generate-echo-impact] sweep scheduled', { pending: pending.length });

      if (pending.length > 0) {
        runInBackground(processPendingEchoes(supabaseService, pending));
      }

      // 202: accepted and started, not finished. The sweep's real result
      // lands in the function logs, not in this response.
      return jsonResponse({ scheduled: pending.length }, 202);
    }

    stage = 'authenticate_user';
    console.log('[generate-echo-impact] before auth getUser', {
      hasAuthorizationHeader: authorization.length > 0,
    });

    const { data: authData, error: authError } = await supabaseForUser.auth.getUser();
    console.log('[generate-echo-impact] auth result', {
      hasUser: Boolean(authData.user),
      userId: authData.user?.id ?? null,
      authError,
    });

    if (authError || !authData.user) {
      console.error('[generate-echo-impact] auth failed', {
        authError,
        hasUser: Boolean(authData.user),
      });
      return errorResponse(stage, authError ?? 'No authenticated user', 401);
    }

    stage = 'parse_request_body';
    const body = await req.json().catch(() => ({}));
    const voiceNoteId = typeof body.voice_note_id === 'string' ? body.voice_note_id : '';
    console.log('[generate-echo-impact] request body parsed', {
      voiceNoteId,
      bodyKeys: body && typeof body === 'object' ? Object.keys(body) : [],
      voiceNoteIdType: typeof body?.voice_note_id,
      userId: authData.user.id,
    });
    console.log('[generate-echo-impact] after request body parsing', {
      hasVoiceNoteId: voiceNoteId.length > 0,
      voiceNoteId,
    });

    if (!voiceNoteId) {
      return errorResponse(stage, {
        message: 'voice_note_id is required',
        bodyKeys: body && typeof body === 'object' ? Object.keys(body) : [],
        voiceNoteIdType: typeof body?.voice_note_id,
      }, 400);
    }

    stage = 'fetch_voice_note';
    console.log('[generate-echo-impact] fetching voice note', voiceNoteId);

    let voiceNote: Record<string, unknown> | null = null;
    let voiceNoteError: unknown = null;

    try {
      const voiceNoteResult = await supabaseService
        .from('voice_notes')
        .select('*')
        .eq('id', voiceNoteId)
        .single();

      voiceNote = voiceNoteResult.data;
      voiceNoteError = voiceNoteResult.error;
    } catch (error) {
      voiceNoteError = error;
      console.error('[generate-echo-impact] voice note fetch threw', {
        voiceNoteId,
        error: errorDetail(error),
      });
    }

    console.log('[generate-echo-impact] voice note fetch result', {
      hasVoiceNote: Boolean(voiceNote),
      voiceNoteError,
    });

    if (voiceNoteError || !voiceNote) {
      console.error('[generate-echo-impact] voice_note lookup failed', {
        voiceNoteId,
        error: errorDetail(voiceNoteError),
      });
      return errorResponse(stage, voiceNoteError ?? 'Echo not found', 404);
    }

    const ownedVoiceNote = {
      ...(voiceNote as VoiceNote),
      duration: typeof (voiceNote as VoiceNote).duration === 'number'
        ? (voiceNote as VoiceNote).duration
        : null,
    };

    stage = 'ownership_check';
    console.log('[generate-echo-impact] ownership check', {
      owner: ownedVoiceNote?.user_id,
      requester: authData.user.id,
    });

    if (ownedVoiceNote.user_id !== authData.user.id) {
      return errorResponse(
        stage,
        {
          owner: ownedVoiceNote.user_id,
          requester: authData.user.id,
        },
        403
      );
    }

    stage = 'generate_and_save_impact';
    console.log('[generate-echo-impact] generating impact', {
      voiceNoteId,
      finished: isEchoFinished(ownedVoiceNote),
    });

    let outcome: SaveOutcome;

    try {
      outcome = await generateAndSaveImpact(supabaseService, ownedVoiceNote);
    } catch (error) {
      console.error('[generate-echo-impact] generateAndSaveImpact threw', {
        error: errorDetail(error),
      });
      return errorResponse(stage, errorDetail(error), 500);
    }

    if (outcome.error || !outcome.saved) {
      console.error('[generate-echo-impact] echo_impacts save failed', {
        hasSavedImpact: Boolean(outcome.saved),
        saveError: errorDetail(outcome.error),
      });
      return errorResponse(stage, outcome.error ?? 'No saved impact returned', 500);
    }

    console.log('[generate-echo-impact] saved impact', {
      id: outcome.saved.id,
      voiceNoteId: outcome.saved.voice_note_id,
      model: outcome.saved.model,
      promptVersion: outcome.saved.prompt_version,
      sealed: outcome.sealed,
      skipped: outcome.skipped ?? null,
    });

    return jsonResponse(outcome.saved);
  } catch (error) {
    console.error('[generate-echo-impact] function failed', {
      stage,
      error: errorDetail(error),
    });
    return errorResponse(stage, errorDetail(error), 500);
  }
});
