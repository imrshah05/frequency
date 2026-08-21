import { supabase } from './supabase';
import { fetchTuneInCandidates } from './groupWhispers';

// --- Tunable weights ---------------------------------------------------
// Named constants, not inline magic numbers, so scoring can be retuned
// without hunting through the query logic.
export const SUGGESTION_WEIGHTS = {
  mutualConnection: 3,
  sharedGroup: 2,
  recency: 1,
} as const;

// Recency decays linearly to 0 over this many days since the candidate's
// last Echo. A candidate with no Echo at all (or none inside the window)
// scores 0 on this dimension -- it never disqualifies them, since the hard
// floor is mutual connections / shared groups, not activity.
const RECENCY_WINDOW_DAYS = 14;

function cleanUsername(username: string | null | undefined) {
  return String(username ?? 'frequency').replace(/^@/, '').trim() || 'frequency';
}

// --- Step 2: mutual connections between two specific users --------------

export type MutualConnectionResult = {
  count: number;
  mutualUserIds: string[];
};

/**
 * Mutual Tune-In connections between two specific users -- the overlap of
 * "everyone A tunes into or is tuned into by (accepted)" and the same set
 * for B. Reuses fetchTuneInCandidates for the either-direction lookup
 * instead of re-querying tune_ins directly, so direction handling stays in
 * one place. Modeled on fetchMutualFollowers's two-query-then-intersect
 * shape in lib/mutuals.ts, adapted for two arbitrary users rather than
 * "mutual followers of the profile being viewed."
 */
export async function computeMutualConnections(
  userAId: string,
  userBId: string
): Promise<MutualConnectionResult> {
  if (!userAId || !userBId || userAId === userBId) {
    return { count: 0, mutualUserIds: [] };
  }

  const [aCandidates, bCandidates] = await Promise.all([
    fetchTuneInCandidates(userAId),
    fetchTuneInCandidates(userBId),
  ]);

  const bIds = new Set(bCandidates.map((candidate) => candidate.id));
  const mutualUserIds = aCandidates
    .filter((candidate) => bIds.has(candidate.id))
    .map((candidate) => candidate.id);

  return { count: mutualUserIds.length, mutualUserIds };
}

// --- Step 3: shared Group Whisper membership between two users ---------

export type SharedGroupResult = {
  count: number;
  sharedThreadIds: string[];
};

type ParticipantThreadRow = {
  group_thread_id: string;
};

/**
 * Group Whisper threads two specific users are both members of. No
 * existing precedent for this query -- written fresh, following the same
 * two-query-then-intersect convention as computeMutualConnections /
 * fetchMutualFollowers.
 */
export async function computeSharedGroupCount(
  userAId: string,
  userBId: string
): Promise<SharedGroupResult> {
  if (!userAId || !userBId || userAId === userBId) {
    return { count: 0, sharedThreadIds: [] };
  }

  const [{ data: aRows, error: aError }, { data: bRows, error: bError }] = await Promise.all([
    supabase.from('whisper_group_participants').select('group_thread_id').eq('user_id', userAId),
    supabase.from('whisper_group_participants').select('group_thread_id').eq('user_id', userBId),
  ]);

  if (aError) throw aError;
  if (bError) throw bError;

  const bThreadIds = new Set(((bRows ?? []) as ParticipantThreadRow[]).map((row) => row.group_thread_id));
  const sharedThreadIds = [
    ...new Set(((aRows ?? []) as ParticipantThreadRow[]).map((row) => row.group_thread_id)),
  ].filter((threadId) => bThreadIds.has(threadId));

  return { count: sharedThreadIds.length, sharedThreadIds };
}

// --- Step 5: composite scoring -------------------------------------------

/**
 * Linear decay from 1 (Echo posted just now) to 0 (posted
 * RECENCY_WINDOW_DAYS ago or longer, or no Echo at all). Reuses
 * voice_notes_user_active_idx as-is via the caller's query -- this
 * function only turns a timestamp into a score.
 */
export function computeRecencyScore(lastEchoAt: string | null): number {
  if (!lastEchoAt) return 0;

  const daysSince = (Date.now() - new Date(lastEchoAt).getTime()) / (1000 * 60 * 60 * 24);

  if (daysSince < 0) return 1;
  if (daysSince >= RECENCY_WINDOW_DAYS) return 0;

  return 1 - daysSince / RECENCY_WINDOW_DAYS;
}

export function scoreSuggestion(input: {
  mutualConnectionCount: number;
  sharedGroupCount: number;
  recencyScore: number;
}): number {
  return (
    SUGGESTION_WEIGHTS.mutualConnection * input.mutualConnectionCount +
    SUGGESTION_WEIGHTS.sharedGroup * input.sharedGroupCount +
    SUGGESTION_WEIGHTS.recency * input.recencyScore
  );
}

// --- Step 4/7: dismissals -------------------------------------------------

type DismissedRow = {
  suggested_user_id: string;
  dismissed_at: string;
};

/**
 * Writes (or refreshes) a dismissal. Upsert rather than plain insert so
 * dismissing a suggestion that had resurfaced (see getSuggestedTuneIns)
 * bumps dismissed_at forward instead of being silently ignored by the
 * composite primary key.
 */
export async function dismissSuggestion(userId: string, suggestedUserId: string): Promise<void> {
  const { error } = await supabase
    .from('dismissed_suggestions')
    .upsert(
      { user_id: userId, suggested_user_id: suggestedUserId, dismissed_at: new Date().toISOString() },
      { onConflict: 'user_id,suggested_user_id' }
    );

  if (error) throw error;
}

// --- Step 6: main query ---------------------------------------------------

export type MutualPreviewPerson = {
  id: string;
  username: string;
  avatarUrl: string | null;
};

export type SuggestedTuneIn = {
  id: string;
  username: string;
  avatarUrl: string | null;
  mutualConnectionCount: number;
  mutualUserIds: string[];
  mutualPreview: MutualPreviewPerson[];
  sharedGroupCount: number;
  sharedGroupIds: string[];
  lastEchoAt: string | null;
  score: number;
};

type TuneInEdgeRow = {
  listener_id: string;
  frequency_owner_id: string;
  responded_at: string | null;
};

type ProfileRow = {
  id: string;
  username: string | null;
  avatar_url: string | null;
};

type VoiceNoteRow = {
  user_id: string;
  created_at: string;
};

/**
 * Ranked, floor-filtered, dismissal-aware suggestions for who `userId`
 * might want to Tune In to next.
 *
 * Candidate pool construction avoids scoring every profile in the app (an
 * N+1 fan-out of computeMutualConnections/computeSharedGroupCount per
 * candidate would re-run fetchTuneInCandidates(userId) once per candidate
 * -- wasteful, and tune_ins currently has no index on frequency_owner_id
 * alone per the live schema check, so each of those calls does a partial
 * seq scan). Instead this queries "friends of userId's friends" and
 * "co-members of userId's groups" directly, in bulk, and derives the same
 * counts/ids computeMutualConnections and computeSharedGroupCount would
 * return, from that single batch of rows.
 *
 * Pagination is applied in-memory after scoring -- the floor keeps the
 * candidate pool bounded to "people connected to your network," which is
 * small at current app scale. A DB-side paginated version would be needed
 * if that pool grows large; flagged as future work, not built here.
 */
export async function getSuggestedTuneIns(
  userId: string,
  limit: number,
  offset = 0
): Promise<SuggestedTuneIn[]> {
  if (!userId) return [];

  // Everyone userId already has an accepted Tune In with, in either
  // direction -- excluded from suggestions outright.
  const alreadyTunedIn = await fetchTuneInCandidates(userId);
  const excludedIds = new Set(alreadyTunedIn.map((candidate) => candidate.id));
  excludedIds.add(userId);
  const networkIds = [...excludedIds].filter((id) => id !== userId);

  // userId's own accepted tune_ins rows (needed for resurface timestamps
  // below, not just membership).
  const { data: ownTuneInRows, error: ownTuneInError } = await supabase
    .from('tune_ins')
    .select('listener_id, frequency_owner_id, responded_at')
    .eq('status', 'accepted')
    .or(`listener_id.eq.${userId},frequency_owner_id.eq.${userId}`);

  if (ownTuneInError) throw ownTuneInError;

  const respondedAtByFriend = new Map<string, string | null>();
  ((ownTuneInRows ?? []) as TuneInEdgeRow[]).forEach((row) => {
    const friendId = row.listener_id === userId ? row.frequency_owner_id : row.listener_id;
    respondedAtByFriend.set(friendId, row.responded_at);
  });

  // "Friends of friends": accepted tune_ins touching anyone in userId's
  // network. Each row's non-network side is a mutual-connection candidate;
  // the network-side id is the mutual friend who connects them.
  const mutualFriendsByCandidate = new Map<string, Map<string, string | null>>();

  if (networkIds.length > 0) {
    const orClause = networkIds
      .map((id) => `listener_id.eq.${id},frequency_owner_id.eq.${id}`)
      .join(',');

    const { data: edgeRows, error: edgeError } = await supabase
      .from('tune_ins')
      .select('listener_id, frequency_owner_id, responded_at')
      .eq('status', 'accepted')
      .or(orClause);

    if (edgeError) throw edgeError;

    ((edgeRows ?? []) as TuneInEdgeRow[]).forEach((row) => {
      const [a, b] = [row.listener_id, row.frequency_owner_id];
      const aIsFriend = networkIds.includes(a);
      const bIsFriend = networkIds.includes(b);

      // Skip edges entirely inside userId's own network (both sides
      // already excluded) and edges not touching the network at all.
      if (aIsFriend === bIsFriend) return;

      const friendId = aIsFriend ? a : b;
      const candidateId = aIsFriend ? b : a;

      if (candidateId === userId || excludedIds.has(candidateId)) return;

      const friendsForCandidate = mutualFriendsByCandidate.get(candidateId) ?? new Map();
      friendsForCandidate.set(friendId, row.responded_at);
      mutualFriendsByCandidate.set(candidateId, friendsForCandidate);
    });
  }

  // userId's own group threads, with join time (for resurface timestamps).
  const { data: ownParticipantRows, error: ownParticipantError } = await supabase
    .from('whisper_group_participants')
    .select('group_thread_id, joined_at')
    .eq('user_id', userId);

  if (ownParticipantError) throw ownParticipantError;

  const ownThreadIds = ((ownParticipantRows ?? []) as { group_thread_id: string; joined_at: string }[]);
  const ownJoinedAtByThread = new Map(ownThreadIds.map((row) => [row.group_thread_id, row.joined_at]));

  // Co-members of those threads (excluding userId) -- each is a
  // shared-group candidate.
  const sharedThreadsByCandidate = new Map<string, Map<string, string>>();

  if (ownThreadIds.length > 0) {
    const { data: coMemberRows, error: coMemberError } = await supabase
      .from('whisper_group_participants')
      .select('group_thread_id, user_id, joined_at')
      .in('group_thread_id', ownThreadIds.map((row) => row.group_thread_id))
      .neq('user_id', userId);

    if (coMemberError) throw coMemberError;

    ((coMemberRows ?? []) as { group_thread_id: string; user_id: string; joined_at: string }[]).forEach(
      (row) => {
        if (excludedIds.has(row.user_id)) return;

        const threadsForCandidate = sharedThreadsByCandidate.get(row.user_id) ?? new Map();
        threadsForCandidate.set(row.group_thread_id, row.joined_at);
        sharedThreadsByCandidate.set(row.user_id, threadsForCandidate);
      }
    );
  }

  // Hard floor: only candidates with at least one mutual connection or one
  // shared group are ever considered -- never ranked, never returned,
  // regardless of recency.
  const candidateIds = new Set([
    ...mutualFriendsByCandidate.keys(),
    ...sharedThreadsByCandidate.keys(),
  ]);

  if (candidateIds.size === 0) return [];

  // Dismissals: a dismissed candidate is excluded unless a mutual
  // connection or shared group has formed since the dismissal. There's no
  // existing "resurface after state change" pattern elsewhere in the app
  // (checked lib/notifications.ts -- one-way state, no precedent), so this
  // compares dismissed_at against the freshest contributing signal directly.
  const { data: dismissedRows, error: dismissedError } = await supabase
    .from('dismissed_suggestions')
    .select('suggested_user_id, dismissed_at')
    .eq('user_id', userId)
    .in('suggested_user_id', [...candidateIds]);

  if (dismissedError) throw dismissedError;

  const dismissedAtById = new Map(
    ((dismissedRows ?? []) as DismissedRow[]).map((row) => [row.suggested_user_id, row.dismissed_at])
  );

  function freshestSignalAt(candidateId: string): string | null {
    const timestamps: string[] = [];

    const friends = mutualFriendsByCandidate.get(candidateId);
    friends?.forEach((candidateFriendRespondedAt, friendId) => {
      const ownRespondedAt = respondedAtByFriend.get(friendId);
      // The mutual link exists from whichever of the two acceptances
      // (userId<->friend, friend<->candidate) happened more recently.
      [ownRespondedAt, candidateFriendRespondedAt].forEach((value) => {
        if (value) timestamps.push(value);
      });
    });

    const threads = sharedThreadsByCandidate.get(candidateId);
    threads?.forEach((candidateJoinedAt, threadId) => {
      const ownJoinedAt = ownJoinedAtByThread.get(threadId);
      // Sharing a group starts at whichever of the two joins happened
      // later.
      [ownJoinedAt, candidateJoinedAt].forEach((value) => {
        if (value) timestamps.push(value);
      });
    });

    if (timestamps.length === 0) return null;

    return timestamps.reduce((latest, value) => (value > latest ? value : latest));
  }

  const survivingCandidateIds = [...candidateIds].filter((candidateId) => {
    const dismissedAt = dismissedAtById.get(candidateId);
    if (!dismissedAt) return true;

    const freshestAt = freshestSignalAt(candidateId);
    return !!freshestAt && freshestAt > dismissedAt;
  });

  if (survivingCandidateIds.length === 0) return [];

  // Union of every mutual friend id across all surviving candidates, so
  // their avatars/usernames can be fetched in the same batched profiles
  // query below instead of one query per candidate.
  const mutualFriendIds = new Set<string>();
  survivingCandidateIds.forEach((candidateId) => {
    mutualFriendsByCandidate.get(candidateId)?.forEach((_respondedAt, friendId) => {
      mutualFriendIds.add(friendId);
    });
  });
  const profileFetchIds = [...new Set([...survivingCandidateIds, ...mutualFriendIds])];

  const [{ data: profileRows, error: profileError }, { data: voiceNoteRows, error: voiceNoteError }] =
    await Promise.all([
      supabase.from('profiles').select('id, username, avatar_url').in('id', profileFetchIds),
      supabase
        .from('voice_notes')
        .select('user_id, created_at')
        .in('user_id', survivingCandidateIds)
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
    ]);

  if (profileError) throw profileError;
  if (voiceNoteError) throw voiceNoteError;

  const profileById = new Map(
    ((profileRows ?? []) as ProfileRow[]).map((profile) => [profile.id, profile])
  );

  // voice_notes_user_active_idx is (user_id, created_at desc), so the
  // first row seen per user_id in this already-descending result is their
  // most recent Echo -- no extra per-user query needed.
  const lastEchoAtByUser = new Map<string, string>();
  ((voiceNoteRows ?? []) as VoiceNoteRow[]).forEach((row) => {
    if (!lastEchoAtByUser.has(row.user_id)) {
      lastEchoAtByUser.set(row.user_id, row.created_at);
    }
  });

  const scored: SuggestedTuneIn[] = survivingCandidateIds.map((candidateId) => {
    const profile = profileById.get(candidateId);
    const mutualUserIds = [...(mutualFriendsByCandidate.get(candidateId)?.keys() ?? [])];
    const mutualPreview: MutualPreviewPerson[] = mutualUserIds
      .slice(0, 3)
      .map((friendId) => profileById.get(friendId))
      .filter((friendProfile): friendProfile is ProfileRow => !!friendProfile)
      .map((friendProfile) => ({
        id: friendProfile.id,
        username: cleanUsername(friendProfile.username),
        avatarUrl: friendProfile.avatar_url ?? null,
      }));
    const sharedGroupIds = [...(sharedThreadsByCandidate.get(candidateId)?.keys() ?? [])];
    const lastEchoAt = lastEchoAtByUser.get(candidateId) ?? null;
    const recencyScore = computeRecencyScore(lastEchoAt);

    return {
      id: candidateId,
      username: cleanUsername(profile?.username),
      avatarUrl: profile?.avatar_url ?? null,
      mutualConnectionCount: mutualUserIds.length,
      mutualUserIds,
      mutualPreview,
      sharedGroupCount: sharedGroupIds.length,
      sharedGroupIds,
      lastEchoAt,
      score: scoreSuggestion({
        mutualConnectionCount: mutualUserIds.length,
        sharedGroupCount: sharedGroupIds.length,
        recencyScore,
      }),
    };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(offset, offset + limit);
}
