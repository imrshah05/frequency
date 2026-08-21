import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import BackButton, { BACK_BUTTON_WIDTH } from '@/components/BackButton';
import Touchable from '@/components/Touchable';
import { SafeAreaView } from 'react-native-safe-area-context';

import Avatar from '@/components/Avatar';
import GroupAvatarDisplay from '@/components/GroupAvatarDisplay';
import { FrequencyLogoLoader } from '@/components/branding/FrequencyLogo';
import {
  FrequencyColors as C,
  FrequencyRadius as R,
  FrequencySpacing as S,
} from '@/constants/frequencyTheme';
import { uploadGroupAvatar } from '@/lib/avatars';
import {
  fetchGroupThread,
  fetchGroupThreadMembers,
  getGroupDisplayName,
  removeGroupWhisperMember,
  renameGroupWhisperThread,
  updateGroupAvatar,
  type GroupMember,
  type WhisperGroupThread,
} from '@/lib/groupWhispers';
import { error as hapticError, light, success } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';

const TITLE_MAX_LENGTH = 60;

export default function GroupWhisperMembersScreen() {
  const params = useLocalSearchParams<{ threadId?: string | string[] }>();
  const threadId = useMemo(() => {
    const raw = params.threadId;
    return Array.isArray(raw) ? raw[0] ?? '' : raw ?? '';
  }, [params.threadId]);

  const [currentUserId, setCurrentUserId] = useState('');
  const [thread, setThread] = useState<WhisperGroupThread | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const displayName = thread
    ? getGroupDisplayName(members, currentUserId, thread.title)
    : '';
  const clusterMembers = useMemo(
    () =>
      members
        .filter((member) => member.id !== currentUserId)
        .slice(0, 2)
        .map((member) => ({ username: member.username, avatarUrl: member.avatarUrl })),
    [members, currentUserId]
  );
  const clusterExtraCount = Math.max(
    0,
    members.filter((member) => member.id !== currentUserId).length - 2
  );

  const load = useCallback(async () => {
    if (!threadId) return;

    setLoading(true);

    const { data: userData } = await supabase.auth.getUser();
    const me = userData.user?.id ?? '';

    if (!me) {
      setLoading(false);
      return;
    }

    try {
      const [nextThread, nextMembers] = await Promise.all([
        fetchGroupThread(threadId),
        fetchGroupThreadMembers(threadId),
      ]);

      if (!nextThread) {
        Alert.alert('Group Whisper', 'This group no longer exists.');
        router.replace('/(tabs)/whispers');
        return;
      }

      setCurrentUserId(me);
      setThread(nextThread);
      setMembers(nextMembers);
    } catch (err) {
      void hapticError();
      Alert.alert(
        'Whisper Error',
        err instanceof Error ? err.message : 'Could not load this group.'
      );
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  function beginEditTitle() {
    if (!thread) return;
    setTitleDraft(thread.title ?? '');
    setEditingTitle(true);
    void light();
  }

  async function saveTitle() {
    if (!thread || savingTitle) return;

    setSavingTitle(true);

    try {
      await renameGroupWhisperThread(thread.id, titleDraft);
      setThread({ ...thread, title: titleDraft.trim() || null });
      setEditingTitle(false);
    } catch (err) {
      void hapticError();
      Alert.alert(
        'Whisper Error',
        err instanceof Error ? err.message : 'Could not rename this group.'
      );
    } finally {
      setSavingTitle(false);
    }
  }

  function chooseGroupAvatar() {
    if (!thread || uploadingAvatar) return;

    if (thread.avatar_url) {
      Alert.alert('Group Photo', undefined, [
        { text: 'Choose New Photo', onPress: () => void pickAndUploadAvatar() },
        { text: 'Remove Photo', style: 'destructive', onPress: () => void clearGroupAvatar() },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }

    void pickAndUploadAvatar();
  }

  async function pickAndUploadAvatar() {
    if (!thread) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      void hapticError();
      Alert.alert('Photo Access Needed', 'Please allow photo access to set a group photo.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.86,
    });

    if (result.canceled || !result.assets[0]?.uri) return;

    try {
      setUploadingAvatar(true);
      const avatarUrl = await uploadGroupAvatar(thread.id, currentUserId, result.assets[0].uri);
      await updateGroupAvatar(thread.id, avatarUrl);
      setThread((current) => (current ? { ...current, avatar_url: avatarUrl } : current));
      void success();
    } catch (err) {
      void hapticError();
      Alert.alert(
        'Photo Error',
        err instanceof Error ? err.message : 'Could not update the group photo.'
      );
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function clearGroupAvatar() {
    if (!thread) return;

    try {
      setUploadingAvatar(true);
      await updateGroupAvatar(thread.id, null);
      setThread((current) => (current ? { ...current, avatar_url: null } : current));
      void success();
    } catch (err) {
      void hapticError();
      Alert.alert(
        'Photo Error',
        err instanceof Error ? err.message : 'Could not remove the group photo.'
      );
    } finally {
      setUploadingAvatar(false);
    }
  }

  function confirmRemove(member: GroupMember) {
    const isSelf = member.id === currentUserId;

    Alert.alert(
      isSelf ? 'Leave Group' : `Remove @${member.username}`,
      isSelf
        ? 'You will no longer see this group Whisper.'
        : `@${member.username} will no longer see this group Whisper.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isSelf ? 'Leave' : 'Remove',
          style: 'destructive',
          onPress: () => void removeMember(member.id, isSelf),
        },
      ]
    );
  }

  async function removeMember(memberId: string, isSelf: boolean) {
    if (!thread || pendingMemberId) return;

    setPendingMemberId(memberId);

    try {
      await removeGroupWhisperMember(thread.id, memberId);
      void success();

      if (isSelf) {
        router.replace('/(tabs)/whispers');
        return;
      }

      setMembers((current) => current.filter((member) => member.id !== memberId));
    } catch (err) {
      void hapticError();
      Alert.alert(
        'Whisper Error',
        err instanceof Error ? err.message : 'Could not update this group.'
      );
    } finally {
      setPendingMemberId(null);
    }
  }

  if (loading && !thread) {
    return (
      <View style={styles.loadingScreen}>
        <FrequencyLogoLoader size={44} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <SafeAreaView edges={['top']} style={styles.safeHeader}>
        <View style={styles.header}>
          <BackButton />

          {editingTitle ? (
            <TextInput
              style={styles.titleInput}
              value={titleDraft}
              onChangeText={(text) => setTitleDraft(text.slice(0, TITLE_MAX_LENGTH))}
              placeholder={displayName}
              placeholderTextColor={C.faint}
              autoFocus
              maxLength={TITLE_MAX_LENGTH}
              selectionColor={C.accent}
              onBlur={saveTitle}
              onSubmitEditing={saveTitle}
            />
          ) : (
            <Touchable style={styles.titleButton} activeOpacity={0.78} onPress={beginEditTitle}>
              <Text style={styles.title} numberOfLines={1}>
                {displayName}
              </Text>
              <Ionicons name="pencil-outline" size={14} color={C.faint} />
            </Touchable>
          )}

          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.avatarSection}>
          <Touchable
            style={styles.avatarButton}
            activeOpacity={0.86}
            onPress={chooseGroupAvatar}
            disabled={uploadingAvatar}
          >
            <GroupAvatarDisplay
              avatarUrl={thread?.avatar_url ?? null}
              members={clusterMembers}
              extraCount={clusterExtraCount}
              size={88}
            />
            <View style={styles.avatarEditPill}>
              <Text style={styles.avatarEditText}>
                {uploadingAvatar ? 'Uploading...' : thread?.avatar_url ? 'Edit' : 'Add Photo'}
              </Text>
            </View>
          </Touchable>
        </View>

        <Text style={styles.memberCount}>
          {members.length} {members.length === 1 ? 'person' : 'people'}
        </Text>
      </SafeAreaView>

      <FlatList
        data={members}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <Touchable
            style={styles.addButton}
            activeOpacity={0.82}
            onPress={() =>
              router.push({
                pathname: '/whispers/group/[threadId]/add',
                params: { threadId },
              })
            }
          >
            <Ionicons name="person-add-outline" size={18} color={C.accent} />
            <Text style={styles.addButtonText}>Add Members</Text>
          </Touchable>
        }
        renderItem={({ item }) => {
          const isSelf = item.id === currentUserId;
          const removing = pendingMemberId === item.id;

          return (
            <View style={styles.row}>
              <Avatar
                avatarUrl={item.avatarUrl}
                initial={item.username}
                size={48}
                textSize={19}
                backgroundColor={C.elevated}
              />

              <Text style={styles.username}>
                @{item.username}
                {isSelf && <Text style={styles.youLabel}> · You</Text>}
              </Text>

              <Touchable
                style={styles.removeButton}
                activeOpacity={0.78}
                disabled={removing}
                onPress={() => confirmRemove(item)}
              >
                <Text style={styles.removeButtonText}>{isSelf ? 'Leave' : 'Remove'}</Text>
              </Touchable>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.background,
  },

  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.background,
  },

  safeHeader: {
    backgroundColor: 'transparent',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 8,
  },

  // Balances the BackButton so the centred title stays centred.
  headerSpacer: {
    width: BACK_BUTTON_WIDTH,
  },

  titleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },

  title: {
    color: C.text,
    fontSize: 18,
    fontWeight: '800',
    maxWidth: 220,
  },

  titleInput: {
    flex: 1,
    color: C.text,
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },

  avatarSection: {
    alignItems: 'center',
    marginTop: S.lg,
  },

  avatarButton: {
    alignItems: 'center',
  },

  avatarEditPill: {
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: R.sm,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.divider,
  },

  avatarEditText: {
    color: C.accent,
    fontSize: 13,
    fontWeight: '700',
  },

  memberCount: {
    color: C.muted,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: S.lg,
  },

  content: {
    paddingHorizontal: 20,
    paddingBottom: 60,
  },

  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: C.divider,
    borderStyle: 'dashed',
    marginBottom: S.lg,
  },

  addButtonText: {
    color: C.accent,
    fontSize: 15,
    fontWeight: '700',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
    padding: 14,
    borderRadius: R.lg,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.divider,
    marginBottom: S.sm,
  },

  username: {
    flex: 1,
    color: C.text,
    fontSize: 16,
    fontWeight: '700',
  },

  youLabel: {
    color: C.muted,
    fontWeight: '600',
  },

  removeButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: R.sm,
    backgroundColor: C.elevated,
  },

  removeButtonText: {
    color: C.danger,
    fontSize: 13,
    fontWeight: '700',
  },
});
