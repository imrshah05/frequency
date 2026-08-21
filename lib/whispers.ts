import { supabase } from './supabase';

export type ListeningToContact = {
  id: string;
  username: string;
  avatarUrl: string | null;
};

type TuneInRow = {
  frequency_owner_id: string;
};

type ProfileRow = {
  id: string;
  username: string | null;
  avatar_url: string | null;
};

function cleanUsername(username: string | null | undefined) {
  return String(username ?? 'frequency').replace(/^@/, '').trim() || 'frequency';
}

// People you're Listening To -- the candidate list for starting a new 1:1
// Whisper. Deliberately one-directional (unlike group Whispers' mutual Tune
// In candidates): you can whisper to anyone you follow, whether or not they
// follow you back, same as the "Listening To" list on your own profile.
export async function fetchListeningTo(currentUserId: string): Promise<ListeningToContact[]> {
  const { data: tuneInRows, error: tuneInError } = await supabase
    .from('tune_ins')
    .select('frequency_owner_id')
    .eq('listener_id', currentUserId)
    .eq('status', 'accepted');

  if (tuneInError) throw tuneInError;

  const otherIds = [
    ...new Set(
      ((tuneInRows ?? []) as TuneInRow[])
        .map((row) => row.frequency_owner_id)
        .filter((id) => id && id !== currentUserId)
    ),
  ];

  if (otherIds.length === 0) return [];

  const { data: profileRows, error: profileError } = await supabase
    .from('profiles')
    .select('id, username, avatar_url')
    .in('id', otherIds);

  if (profileError) throw profileError;

  return ((profileRows ?? []) as ProfileRow[])
    .map((profile) => ({
      id: profile.id,
      username: cleanUsername(profile.username),
      avatarUrl: profile.avatar_url ?? null,
    }))
    .sort((a, b) => a.username.localeCompare(b.username));
}

export type WhisperThread = {
  id: string;
  user_a_id: string;
  user_b_id: string;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
};

export function getOtherWhisperUserId(thread: WhisperThread, currentUserId: string) {
  return thread.user_a_id === currentUserId ? thread.user_b_id : thread.user_a_id;
}

function sortUserPair(userId: string, otherUserId: string) {
  return [userId, otherUserId].sort() as [string, string];
}

export async function openOrCreateWhisperThread(otherUserId: string) {
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    throw new Error('Please log in again.');
  }

  const currentUserId = userData.user.id;

  if (currentUserId === otherUserId) {
    throw new Error('You cannot whisper to yourself.');
  }

  const { data: existing, error: existingError } = await supabase
    .from('whisper_threads')
    .select('*')
    .or(
      `and(user_a_id.eq.${currentUserId},user_b_id.eq.${otherUserId}),and(user_a_id.eq.${otherUserId},user_b_id.eq.${currentUserId})`
    )
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existing) {
    return existing as WhisperThread;
  }

  const [userAId, userBId] = sortUserPair(currentUserId, otherUserId);
  const { data: created, error: createError } = await supabase
    .from('whisper_threads')
    .insert({
      user_a_id: userAId,
      user_b_id: userBId,
    })
    .select('*')
    .single();

  if (createError) {
    throw createError;
  }

  return created as WhisperThread;
}
