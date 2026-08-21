import { supabase } from './supabase';

export const MAX_GROUP_PARTICIPANTS = 12;
export const MIN_GROUP_OTHER_PARTICIPANTS = 2;

export type WhisperGroupThread = {
  id: string;
  created_by: string;
  title: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
};

export type TuneInCandidate = {
  id: string;
  username: string;
  avatarUrl: string | null;
};

export type GroupMember = {
  id: string;
  username: string;
  avatarUrl: string | null;
  joinedAt: string;
  lastReadAt: string | null;
};

type TuneInRow = {
  listener_id: string;
  frequency_owner_id: string;
};

type ProfileRow = {
  id: string;
  username: string | null;
  avatar_url: string | null;
};

type ParticipantRow = {
  user_id: string;
  joined_at: string;
};

function cleanUsername(username: string | null | undefined) {
  return String(username ?? 'frequency').replace(/^@/, '').trim() || 'frequency';
}

async function requireCurrentUserId() {
  const { data: userData, error } = await supabase.auth.getUser();

  if (error || !userData.user) {
    throw new Error('Please log in again.');
  }

  return userData.user.id;
}

/**
 * Everyone the given user has an accepted Tune In with, in either
 * direction. Shared by the group-creation picker and the add-member flow.
 */
export async function fetchTuneInCandidates(currentUserId: string): Promise<TuneInCandidate[]> {
  const { data: tuneInRows, error: tuneInError } = await supabase
    .from('tune_ins')
    .select('listener_id, frequency_owner_id')
    .eq('status', 'accepted')
    .or(`listener_id.eq.${currentUserId},frequency_owner_id.eq.${currentUserId}`);

  if (tuneInError) throw tuneInError;

  const otherIds = [
    ...new Set(
      ((tuneInRows ?? []) as TuneInRow[])
        .map((row) => (row.listener_id === currentUserId ? row.frequency_owner_id : row.listener_id))
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

export async function createGroupWhisperThread(otherParticipantIds: string[]): Promise<WhisperGroupThread> {
  const currentUserId = await requireCurrentUserId();
  const uniqueOtherIds = [...new Set(otherParticipantIds.filter((id) => id !== currentUserId))];

  if (uniqueOtherIds.length < MIN_GROUP_OTHER_PARTICIPANTS) {
    throw new Error(`Choose at least ${MIN_GROUP_OTHER_PARTICIPANTS} people for a group Whisper.`);
  }

  if (uniqueOtherIds.length + 1 > MAX_GROUP_PARTICIPANTS) {
    throw new Error(`Group Whispers are limited to ${MAX_GROUP_PARTICIPANTS} participants.`);
  }

  // Creating the thread and seeding its participants has to happen
  // atomically, server-side -- see the fix migration
  // (20260806020000_fix_group_thread_creation.sql) for why doing this as
  // two separate client-side inserts doesn't work.
  const { data, error } = await supabase.rpc('create_group_whisper_thread', {
    p_other_participant_ids: uniqueOtherIds,
  });

  if (error) throw error;

  return data as WhisperGroupThread;
}

export async function fetchGroupThread(threadId: string): Promise<WhisperGroupThread | null> {
  const { data, error } = await supabase
    .from('whisper_group_threads')
    .select('*')
    .eq('id', threadId)
    .maybeSingle();

  if (error) throw error;

  return (data as WhisperGroupThread | null) ?? null;
}

export async function fetchGroupThreadMembers(threadId: string): Promise<GroupMember[]> {
  const { data: participantRows, error: participantError } = await supabase
    .from('whisper_group_participants')
    .select('user_id, joined_at, last_read_at')
    .eq('group_thread_id', threadId)
    .order('joined_at', { ascending: true });

  if (participantError) throw participantError;

  const participants = (participantRows ?? []) as (ParticipantRow & { last_read_at: string | null })[];
  const memberIds = participants.map((row) => row.user_id);

  if (memberIds.length === 0) return [];

  const { data: profileRows, error: profileError } = await supabase
    .from('profiles')
    .select('id, username, avatar_url')
    .in('id', memberIds);

  if (profileError) throw profileError;

  const profileById = new Map(
    ((profileRows ?? []) as ProfileRow[]).map((profile) => [profile.id, profile])
  );

  return participants.map((row) => {
    const profile = profileById.get(row.user_id);

    return {
      id: row.user_id,
      username: cleanUsername(profile?.username),
      avatarUrl: profile?.avatar_url ?? null,
      joinedAt: row.joined_at,
      lastReadAt: row.last_read_at,
    };
  });
}

export async function addGroupWhisperMember(threadId: string, userId: string) {
  const { error } = await supabase
    .from('whisper_group_participants')
    .insert({ group_thread_id: threadId, user_id: userId });

  if (error) throw error;
}

/**
 * Removes a member from a group Whisper. Passing the current user's own id
 * is how leaving a group works -- there is no separate "leave" endpoint.
 */
export async function removeGroupWhisperMember(threadId: string, userId: string) {
  const { error } = await supabase
    .from('whisper_group_participants')
    .delete()
    .eq('group_thread_id', threadId)
    .eq('user_id', userId);

  if (error) throw error;
}

export async function renameGroupWhisperThread(threadId: string, title: string) {
  const trimmed = title.trim();

  const { error } = await supabase
    .from('whisper_group_threads')
    .update({ title: trimmed || null })
    .eq('id', threadId);

  if (error) throw error;
}

export async function updateGroupAvatar(threadId: string, avatarUrl: string | null) {
  const { error } = await supabase
    .from('whisper_group_threads')
    .update({ avatar_url: avatarUrl })
    .eq('id', threadId);

  if (error) throw error;
}

/**
 * When a group has no custom title, derive a display name from its
 * members (excluding the viewer) so renaming stays entirely optional and
 * the name never goes stale as membership changes.
 */
export function getGroupDisplayName(
  members: GroupMember[],
  currentUserId: string,
  title: string | null
): string {
  if (title?.trim()) return title.trim();

  const otherNames = members
    .filter((member) => member.id !== currentUserId)
    .map((member) => `@${member.username}`);

  if (otherNames.length === 0) return 'Just you';
  if (otherNames.length === 1) return otherNames[0];
  if (otherNames.length === 2) return `${otherNames[0]} & ${otherNames[1]}`;

  return `${otherNames[0]}, ${otherNames[1]} & ${otherNames.length - 2} other${
    otherNames.length - 2 === 1 ? '' : 's'
  }`;
}

export type GroupThreadMessage = {
  id: string;
  group_thread_id: string;
  sender_id: string;
  audio_url: string;
  duration: number;
  caption: string | null;
  waveform: number[] | null;
  reply_to_message_id?: string | null;
  replyPreview?: {
    id: string;
    sender_id: string;
    username: string;
    duration: number;
    caption: string | null;
    waveform: number[] | null;
  } | null;
  created_at: string;
};

export async function fetchGroupThreadMessages(threadId: string): Promise<GroupThreadMessage[]> {
  const { data, error } = await supabase
    .from('whisper_group_messages')
    .select('*')
    .eq('group_thread_id', threadId)
    .order('created_at', { ascending: true });

  if (error) throw error;

  return (data ?? []) as GroupThreadMessage[];
}

export async function sendGroupWhisperMessage(params: {
  threadId: string;
  senderId: string;
  audioUrl: string;
  duration: number;
  caption: string | null;
  waveform: number[] | null;
  replyToMessageId?: string | null;
}): Promise<GroupThreadMessage> {
  const { data, error } = await supabase
    .from('whisper_group_messages')
    .insert({
      group_thread_id: params.threadId,
      sender_id: params.senderId,
      audio_url: params.audioUrl,
      duration: params.duration,
      caption: params.caption,
      waveform: params.waveform,
      reply_to_message_id: params.replyToMessageId ?? null,
    })
    .select('*')
    .single();

  // A failed insert is reported, never retried without the reply. An
  // earlier version dropped reply_to_message_id and re-sent when the
  // column was missing from the database, which turned a schema error
  // into an Echo that silently arrived as not-a-reply -- invisible in the
  // thread and unrecoverable, since the link was never written.
  if (error) throw error;

  return data as GroupThreadMessage;
}

/**
 * Records that the current viewer has personally heard an Echo. Private to
 * the viewer -- nobody else sees this in Phase 3. Phase 4 adds the "who has
 * listened" UI on top of this same table.
 */
export async function markGroupMessageListened(messageId: string, userId: string) {
  const { error } = await supabase
    .from('whisper_group_message_reads')
    .upsert(
      { group_message_id: messageId, user_id: userId },
      { onConflict: 'group_message_id,user_id', ignoreDuplicates: true }
    );

  if (error) throw error;
}

export async function fetchListenedMessageIds(
  messageIds: string[],
  userId: string
): Promise<Set<string>> {
  if (messageIds.length === 0) return new Set();

  const { data, error } = await supabase
    .from('whisper_group_message_reads')
    .select('group_message_id')
    .eq('user_id', userId)
    .in('group_message_id', messageIds);

  if (error) throw error;

  return new Set(
    ((data ?? []) as { group_message_id: string }[]).map((row) => row.group_message_id)
  );
}

export type GroupInboxThread = {
  threadId: string;
  displayName: string;
  avatarUrl: string | null;
  avatarMembers: { username: string; avatarUrl: string | null }[];
  extraMemberCount: number;
  // Shape and length of the thread's most recent Echo, so the inbox row can
  // show it holds a voice rather than a line of text.
  waveform: number[] | null;
  duration: number | null;
  sortAt: string;
  unread: boolean;
};

/**
 * Everything the Whispers inbox needs to render group threads alongside
 * 1:1 threads in one combined list.
 */
export async function fetchGroupInboxThreads(currentUserId: string): Promise<GroupInboxThread[]> {
  const { data: myParticipantRows, error: myParticipantError } = await supabase
    .from('whisper_group_participants')
    .select('group_thread_id, last_read_at')
    .eq('user_id', currentUserId);

  if (myParticipantError) throw myParticipantError;

  const myRows = (myParticipantRows ?? []) as { group_thread_id: string; last_read_at: string | null }[];
  const threadIds = [...new Set(myRows.map((row) => row.group_thread_id))];
  const myLastReadAtByThread = new Map(myRows.map((row) => [row.group_thread_id, row.last_read_at]));

  if (threadIds.length === 0) return [];

  const [
    { data: threadRows, error: threadError },
    { data: participantRows, error: participantError },
    { data: messageRows, error: messageError },
  ] = await Promise.all([
    supabase.from('whisper_group_threads').select('*').in('id', threadIds),
    supabase
      .from('whisper_group_participants')
      .select('group_thread_id, user_id, joined_at')
      .in('group_thread_id', threadIds),
    supabase
      .from('whisper_group_messages')
      .select('id, group_thread_id, sender_id, caption, created_at, waveform, duration')
      .in('group_thread_id', threadIds)
      .order('created_at', { ascending: false }),
  ]);

  if (threadError) throw threadError;
  if (participantError) throw participantError;
  if (messageError) throw messageError;

  const threads = (threadRows ?? []) as WhisperGroupThread[];
  const participants = (participantRows ?? []) as (ParticipantRow & { group_thread_id: string })[];
  const messages = (messageRows ?? []) as {
    id: string;
    group_thread_id: string;
    sender_id: string;
    caption: string | null;
    created_at: string;
    waveform: number[] | null;
    duration: number | null;
  }[];

  const memberIdsByThread = new Map<string, string[]>();
  const allMemberIds = new Set<string>();

  participants.forEach((row) => {
    allMemberIds.add(row.user_id);
    const list = memberIdsByThread.get(row.group_thread_id) ?? [];
    list.push(row.user_id);
    memberIdsByThread.set(row.group_thread_id, list);
  });

  const { data: profileRows, error: profileError } =
    allMemberIds.size > 0
      ? await supabase.from('profiles').select('id, username, avatar_url').in('id', [...allMemberIds])
      : { data: [], error: null };

  if (profileError) throw profileError;

  const profileById = new Map(
    ((profileRows ?? []) as ProfileRow[]).map((profile) => [profile.id, profile])
  );

  const latestByThread = new Map<string, (typeof messages)[number]>();
  const unreadThreadIds = new Set<string>();

  messages.forEach((message) => {
    if (!latestByThread.has(message.group_thread_id)) {
      latestByThread.set(message.group_thread_id, message);
    }

    const lastReadAt = myLastReadAtByThread.get(message.group_thread_id);

    if (
      message.sender_id !== currentUserId &&
      (!lastReadAt || new Date(message.created_at) > new Date(lastReadAt))
    ) {
      unreadThreadIds.add(message.group_thread_id);
    }
  });

  // A group with no Echoes in it yet is not a conversation, so it stays out
  // of the inbox until someone actually speaks -- same rule the 1:1 threads
  // follow, so the inbox never lists a thread with nothing to hear.
  return threads.filter((thread) => latestByThread.has(thread.id)).map((thread) => {
    const memberIds = memberIdsByThread.get(thread.id) ?? [];
    const members: GroupMember[] = memberIds.map((id) => {
      const profile = profileById.get(id);

      return {
        id,
        username: cleanUsername(profile?.username),
        avatarUrl: profile?.avatar_url ?? null,
        joinedAt: '',
        lastReadAt: null,
      };
    });
    const otherMembers = members.filter((member) => member.id !== currentUserId);
    const latest = latestByThread.get(thread.id)!;

    return {
      threadId: thread.id,
      displayName: getGroupDisplayName(members, currentUserId, thread.title),
      avatarUrl: thread.avatar_url,
      avatarMembers: otherMembers
        .slice(0, 2)
        .map((member) => ({ username: member.username, avatarUrl: member.avatarUrl })),
      extraMemberCount: Math.max(0, otherMembers.length - 2),
      waveform: latest.waveform,
      duration: latest.duration,
      sortAt: thread.last_message_at ?? latest.created_at,
      unread: unreadThreadIds.has(thread.id),
    };
  });
}

/**
 * Who has "seen" a given Echo -- every other member whose thread-open
 * cursor (last_read_at) is at or after the Echo's created_at. Matches
 * mainstream messaging apps (Instagram DMs included): "seen" means
 * "opened the conversation since this arrived," not "specifically played
 * this exact clip." Deliberately not based on whisper_group_message_reads
 * (per-Echo, tap-to-play) -- that table now only drives the current
 * viewer's own "have I personally played this" dimming, which is a
 * different, narrower question than what's shown to other members here.
 */
export function getSeenByMembers(
  message: { sender_id: string; created_at: string },
  members: GroupMember[]
): GroupMember[] {
  const messageCreatedAt = new Date(message.created_at).getTime();

  return members.filter(
    (member) =>
      member.id !== message.sender_id &&
      member.lastReadAt &&
      new Date(member.lastReadAt).getTime() >= messageCreatedAt
  );
}

export function formatSeenBy(usernames: string[], expanded: boolean): string {
  if (usernames.length === 0) return '';

  const names = usernames.map((username) => `@${username}`);

  if (expanded || names.length <= 2) {
    if (names.length === 1) return `Heard by ${names[0]}`;
    return `Heard by ${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
  }

  return `Heard by ${names[0]} & ${names.length - 1} other${names.length - 1 === 1 ? '' : 's'}`;
}

/**
 * Marks a group thread as opened by the current viewer. Mirrors 1:1
 * Whispers marking its whole thread read on open -- separate from (and
 * doesn't touch) the per-Echo whisper_group_message_reads state that
 * "seen by" and personal listened-dimming rely on, which stays tied to an
 * actual play tap so it doesn't become a dishonest signal.
 */
export async function markGroupThreadRead(threadId: string, userId: string) {
  const { error } = await supabase
    .from('whisper_group_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('group_thread_id', threadId)
    .eq('user_id', userId);

  if (error) throw error;
}

/**
 * Unread-Echo count across every group thread the user belongs to, for the
 * Whispers tab-bar dot. Uses each thread's last_read_at cursor (set by
 * markGroupThreadRead) rather than per-Echo listened state -- opening a
 * thread should clear this, the same way it does for 1:1 Whispers.
 */
export async function fetchGroupUnreadCount(userId: string): Promise<number> {
  const { data: participantRows, error: participantError } = await supabase
    .from('whisper_group_participants')
    .select('group_thread_id, last_read_at')
    .eq('user_id', userId);

  if (participantError) throw participantError;

  const participants = (participantRows ?? []) as { group_thread_id: string; last_read_at: string | null }[];
  const threadIds = [...new Set(participants.map((row) => row.group_thread_id))];

  if (threadIds.length === 0) return 0;

  const lastReadAtByThread = new Map(participants.map((row) => [row.group_thread_id, row.last_read_at]));

  const { data: messageRows, error: messageError } = await supabase
    .from('whisper_group_messages')
    .select('group_thread_id, created_at')
    .in('group_thread_id', threadIds)
    .neq('sender_id', userId);

  if (messageError) throw messageError;

  const messages = (messageRows ?? []) as { group_thread_id: string; created_at: string }[];

  return messages.reduce((count, message) => {
    const lastReadAt = lastReadAtByThread.get(message.group_thread_id);
    const isUnread = !lastReadAt || new Date(message.created_at) > new Date(lastReadAt);
    return isUnread ? count + 1 : count;
  }, 0);
}
