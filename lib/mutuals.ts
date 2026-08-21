import { supabase } from './supabase';

export type MutualFrequency = {
  id: string;
  username: string;
  avatarUrl: string | null;
};

type TuneInOwnerRow = {
  frequency_owner_id: string;
};

type TuneInListenerRow = {
  listener_id: string;
};

type ProfileIdentityRow = {
  id: string;
  username: string | null;
  avatar_url: string | null;
};

function cleanUsername(username: string | null | undefined) {
  return String(username ?? 'frequency')
    .replace(/^@/, '')
    .trim() || 'frequency';
}

export async function fetchMutualFollowers(
  currentUserId: string,
  profileUserId: string
): Promise<MutualFrequency[]> {
  console.log('[Mutuals] fetchMutualFollowers:start', {
    currentUserId,
    viewedUserId: profileUserId,
  });

  if (!currentUserId || !profileUserId || currentUserId === profileUserId) {
    console.log('[Mutuals] fetchMutualFollowers:skipped', {
      currentUserId,
      viewedUserId: profileUserId,
      reason: currentUserId === profileUserId ? 'own-profile' : 'missing-id',
    });

    return [];
  }

  const { data: followingRows, error: followingError } = await supabase
    .from('tune_ins')
    .select('frequency_owner_id')
    .eq('listener_id', currentUserId)
    .eq('status', 'accepted');

  if (followingError) throw followingError;

  console.log('[Mutuals] current user follows', {
    currentUserId,
    count: followingRows?.length ?? 0,
    rows: followingRows,
  });

  const followingIds = [
    ...new Set(
      ((followingRows ?? []) as TuneInOwnerRow[])
        .map((row) => row.frequency_owner_id)
        .filter(Boolean)
    ),
  ];

  if (followingIds.length === 0) {
    console.log('[Mutuals] no accepted following rows for current user', {
      currentUserId,
      viewedUserId: profileUserId,
    });

    return [];
  }

  const { data: followerRows, error: followersError } = await supabase
    .from('tune_ins')
    .select('listener_id')
    .eq('frequency_owner_id', profileUserId)
    .eq('status', 'accepted')
    .in('listener_id', followingIds);

  if (followersError) throw followersError;

  console.log('[Mutuals] viewed profile followers intersected with following ids', {
    viewedUserId: profileUserId,
    count: followerRows?.length ?? 0,
    rows: followerRows,
  });

  const mutualIds = [
    ...new Set(
      ((followerRows ?? []) as TuneInListenerRow[])
        .map((row) => row.listener_id)
        .filter(Boolean)
    ),
  ];

  if (mutualIds.length === 0) {
    console.log('[Mutuals] no mutual ids after intersection', {
      currentUserId,
      viewedUserId: profileUserId,
      followingIds,
    });

    return [];
  }

  const { data: profileRows, error: profilesError } = await supabase
    .from('profiles')
    .select('id, username, avatar_url')
    .in('id', mutualIds);

  if (profilesError) throw profilesError;

  const profileById = new Map(
    ((profileRows ?? []) as ProfileIdentityRow[]).map((profile) => [profile.id, profile])
  );

  const mutuals = mutualIds
    .map((id) => {
      const profile = profileById.get(id);

      return {
        id,
        username: cleanUsername(profile?.username),
        avatarUrl: profile?.avatar_url ?? null,
      };
    })
    .sort((a, b) => a.username.localeCompare(b.username));

  console.log('[Mutuals] fetchMutualFollowers:result', {
    currentUserId,
    viewedUserId: profileUserId,
    mutuals,
    count: mutuals.length,
  });

  return mutuals;
}
