import { supabase } from './supabase';
import { createNotification } from './notifications';
import { fetchUsernameForUser } from './profiles';
import type { User } from '@supabase/supabase-js';

export type TuneInRequestStatus = 'pending' | 'accepted' | 'declined';

export type TuneInRequest = {
  id: string;
  listener_id: string;
  frequency_owner_id: string;
  status: TuneInRequestStatus;
  created_at: string;
  responded_at: string | null;
};

type ExistingTuneIn = {
  id: string;
  status: string;
  created_at: string;
};

const inFlightRequests = new Map<string, Promise<{ status: TuneInRequestStatus }>>();

export async function requestTuneIn(ownerId: string): Promise<{
  status: TuneInRequestStatus;
}> {
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user || userData.user.id === ownerId) {
    throw new Error('Please log in again.');
  }

  const listenerId = userData.user.id;
  const requestKey = `${listenerId}:${ownerId}`;
  const existingRequest = inFlightRequests.get(requestKey);

  if (existingRequest) return existingRequest;

  const request = requestTuneInForUser(ownerId, userData.user);
  inFlightRequests.set(requestKey, request);

  try {
    return await request;
  } finally {
    inFlightRequests.delete(requestKey);
  }
}

async function requestTuneInForUser(ownerId: string, user: User): Promise<{
  status: TuneInRequestStatus;
}> {
  const listenerId = user.id;
  const { data: existingTuneIn, error: lookupError } = await supabase
    .from('tune_ins')
    .select('id, status, created_at')
    .eq('listener_id', listenerId)
    .eq('frequency_owner_id', ownerId)
    .order('created_at', { ascending: false });

  if (lookupError) throw lookupError;

  const existingRows = ((existingTuneIn as ExistingTuneIn[] | null) ?? []).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  const existingStatus = existingRows.find((row) => row.status === 'accepted')?.status ??
    existingRows.find((row) => row.status === 'pending')?.status;

  if (existingStatus === 'accepted' || existingStatus === 'pending') {
    return { status: existingStatus };
  }

  const nextTuneIn = {
    listener_id: listenerId,
    frequency_owner_id: ownerId,
    status: 'pending',
    created_at: new Date().toISOString(),
    responded_at: null,
  };

  const latestDeclined = existingRows.find((row) => row.status === 'declined');
  const { error } = latestDeclined
    ? await supabase
        .from('tune_ins')
        .update(nextTuneIn)
        .eq('id', latestDeclined.id)
        .eq('listener_id', listenerId)
        .eq('frequency_owner_id', ownerId)
        .eq('status', 'declined')
    : await supabase.from('tune_ins').insert(nextTuneIn);

  if (error) throw error;

  const actorUsername = await fetchUsernameForUser(listenerId, user.email);

  await createNotification({
    recipientId: ownerId,
    actorId: listenerId,
    type: 'tune_in',
    voiceNoteId: null,
    message: `@${actorUsername} wants to tune into your Frequency.`,
  });

  return { status: 'pending' };
}

export async function withdrawTuneIn(ownerId: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user || userData.user.id === ownerId) {
    throw new Error('Please log in again.');
  }

  const { error } = await supabase.rpc('withdraw_tune_in', { p_owner_id: ownerId });

  if (error) throw error;
}

export async function respondToTuneInRequest(
  requestId: string,
  status: Extract<TuneInRequestStatus, 'accepted' | 'declined'>
): Promise<TuneInRequest> {
  const { data: userData } = await supabase.auth.getUser();
  const currentUserId = userData.user?.id;

  if (!currentUserId) throw new Error('Please log in again.');

  const { data, error } = await supabase
    .from('tune_ins')
    .update({ status, responded_at: new Date().toISOString() })
    .eq('id', requestId)
    .eq('frequency_owner_id', currentUserId)
    .eq('status', 'pending')
    .select('id, listener_id, frequency_owner_id, status, created_at, responded_at')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('No pending Tune In request was found to update.');

  return data as TuneInRequest;
}
