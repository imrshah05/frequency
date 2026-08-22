import { User } from '@supabase/supabase-js';

import { supabase } from './supabase';

export const USERNAME_PATTERN = /^[a-z0-9_]+$/;

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export function validateUsername(value: string) {
  const username = normalizeUsername(value);

  if (!username) {
    return { username, error: 'Choose a username.' };
  }

  if (username.length < 3) {
    return { username, error: 'Username must be at least 3 characters.' };
  }

  if (username.length > 20) {
    return { username, error: 'Username must be 20 characters or fewer.' };
  }

  if (!USERNAME_PATTERN.test(username)) {
    return {
      username,
      error: 'Username can only use lowercase letters, numbers, and underscores.',
    };
  }

  return { username, error: null };
}

export function fallbackUsernameFromEmail(email?: string | null, fallback = 'user') {
  return email?.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '') || fallback;
}

export function resolveDisplayUsername({
  username,
  displayName,
  email,
  fallback = 'frequency',
}: {
  username?: string | null;
  displayName?: string | null;
  email?: string | null;
  fallback?: string;
}) {
  const candidate = username ?? displayName ?? fallbackUsernameFromEmail(email, fallback);

  return String(candidate)
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9_]/g, '') || fallback;
}

export function deriveUsernameFromUser(user: User) {
  const metadata = user.user_metadata ?? {};
  const metadataUsername = metadata.username ?? metadata.user_name;

  return resolveDisplayUsername({
    username: typeof metadataUsername === 'string' ? metadataUsername : null,
    email: user.email,
    fallback: 'user',
  });
}

export async function ensureProfileForUser(
  user: User | null | undefined,
  preferredUsername?: string | null
) {
  if (!user) return;

  const username = preferredUsername
    ? normalizeUsername(preferredUsername)
    : deriveUsernameFromUser(user);

  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id, username, bio, created_at')
    .eq('id', user.id)
    .maybeSingle();

  if (existingProfile?.username) return;

  if (existingProfile) {
    // Same availability check the signup screen makes, for the same reason.
    // This update writes a username directly and so bypasses handle_new_user
    // entirely -- the only thing between it and a collision is
    // profiles_username_unique_idx, whose 23505 used to be swallowed below.
    // Asking first turns that into a decision rather than a silent no-op.
    const { data: isAvailable, error: availabilityError } = await supabase.rpc(
      'is_username_available',
      { candidate: username }
    );

    if (availabilityError) {
      console.warn(
        '[profiles] Could not check username availability; leaving it unset.',
        availabilityError.message
      );
      return;
    }

    if (isAvailable === false) {
      // Leaving it null is the honest outcome: the username genuinely is not
      // set, and the person can still choose one. Believing it was set while
      // it silently was not is the failure this replaces.
      console.warn(
        `[profiles] Cannot backfill username "${username}" for ${user.id}: already taken. Profile still has none.`
      );
      return;
    }

    const { error } = await supabase
      .from('profiles')
      .update({ username })
      .eq('id', user.id);

    // Not gated on __DEV__. A device build is exactly where this failing
    // matters and where __DEV__ is false, and there is no crash reporter in
    // this project, so the console is the only place it can surface.
    if (error) {
      console.warn('[profiles] Failed to update profile username.', error.message);
    }

    return;
  }

  // Ungated for the same reason: this one means the signup trigger did not
  // create the row, which is a real fault and not a development detail.
  console.warn(
    '[profiles] Missing profile row for authenticated user. The database auth trigger should create it.',
    user.id
  );
}

export async function fetchUsernameForUser(userId: string, email?: string | null) {
  const { data } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', userId)
    .maybeSingle();

  return resolveDisplayUsername({
    username: data?.username,
    email,
    fallback: 'someone',
  });
}
