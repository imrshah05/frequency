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
    const { error } = await supabase
      .from('profiles')
      .update({ username })
      .eq('id', user.id);

    if (error && __DEV__) {
      console.warn('[profiles] Failed to update profile username.', error.message);
    }

    return;
  }

  if (__DEV__) {
    console.warn(
      '[profiles] Missing profile row for authenticated user. The database auth trigger should create it.',
      user.id
    );
  }
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
