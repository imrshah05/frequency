import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  ListRenderItem,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import BackButton, { BACK_BUTTON_WIDTH } from '@/components/BackButton';
import Touchable from '@/components/Touchable';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Avatar from '@/components/Avatar';
import { FrequencyLogoLoader } from '@/components/branding/FrequencyLogo';
import {
  FrequencyColors as C,
  FrequencyRadius as R,
  FrequencySpacing as S,
} from '@/constants/frequencyTheme';
import { error as hapticError, light } from '@/lib/haptics';
import { requestTuneIn as createTuneInRequest, withdrawTuneIn } from '@/lib/tuneIns';
import { supabase } from '@/lib/supabase';

type ConnectionType = 'listening' | 'tuned-in';
type TuneInStatus = 'none' | 'pending' | 'accepted' | 'declined';

type ConnectionUser = {
  id: string;
  username: string;
  bio: string;
  avatarUrl: string | null;
  tuneInStatus: TuneInStatus;
};

type TuneInRow = {
  listener_id: string;
  frequency_owner_id: string;
  status?: TuneInStatus | null;
};

type ProfileRow = {
  id: string;
  username: string | null;
  bio: string | null;
  avatar_url: string | null;
};

function cleanUsername(username: string | null | undefined) {
  return String(username ?? 'frequency')
    .replace(/^@/, '')
    .trim() || 'frequency';
}

function uniqueIds(ids: string[]) {
  return [...new Set(ids.filter(Boolean))];
}

export default function FrequencyConnectionsScreen() {
  const params = useLocalSearchParams<{
    userId?: string | string[];
    type?: string | string[];
  }>();
  const insets = useSafeAreaInsets();
  const userId = useMemo(() => {
    const raw = params.userId;
    return Array.isArray(raw) ? raw[0] ?? '' : raw ?? '';
  }, [params.userId]);
  const connectionType: ConnectionType = useMemo(() => {
    const raw = Array.isArray(params.type) ? params.type[0] : params.type;
    return raw === 'tuned-in' ? 'tuned-in' : 'listening';
  }, [params.type]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [users, setUsers] = useState<ConnectionUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [submittingUserId, setSubmittingUserId] = useState<string | null>(null);

  const title = connectionType === 'listening' ? 'Listening To' : 'Tuned In';
  const emptyText =
    connectionType === 'listening'
      ? "This user isn't listening to anyone yet."
      : 'No one has tuned in yet.';

  const loadConnections = useCallback(async () => {
    if (!userId) {
      setUsers([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const { data: userData } = await supabase.auth.getUser();
    const me = userData.user?.id ?? '';
    const relationshipQuery =
      connectionType === 'listening'
        ? supabase
            .from('tune_ins')
            .select('listener_id, frequency_owner_id, status, created_at')
            .eq('listener_id', userId)
            .eq('status', 'accepted')
            .order('created_at', { ascending: false })
        : supabase
            .from('tune_ins')
            .select('listener_id, frequency_owner_id, status, created_at')
            .eq('frequency_owner_id', userId)
            .eq('status', 'accepted')
            .order('created_at', { ascending: false });

    const { data: relationshipRows, error: relationshipError } = await relationshipQuery;

    if (relationshipError) {
      setLoading(false);
      void hapticError();
      Alert.alert('Frequency Error', relationshipError.message);
      return;
    }

    const rows = (relationshipRows ?? []) as TuneInRow[];
    const listedIds = uniqueIds(
      rows.map((row) =>
        connectionType === 'listening' ? row.frequency_owner_id : row.listener_id
      )
    );

    if (listedIds.length === 0) {
      setCurrentUserId(me);
      setUsers([]);
      setLoading(false);
      return;
    }

    const [{ data: profileRows, error: profilesError }, { data: statusRows }] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, username, bio, avatar_url')
        .in('id', listedIds),
      me
        ? supabase
            .from('tune_ins')
            .select('frequency_owner_id, status, created_at')
            .eq('listener_id', me)
            .in('frequency_owner_id', listedIds)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [] }),
    ]);

    if (profilesError) {
      setLoading(false);
      void hapticError();
      Alert.alert('Frequency Error', profilesError.message);
      return;
    }

    const profilesById = new Map(
      ((profileRows ?? []) as ProfileRow[]).map((profile) => [profile.id, profile])
    );
    const statusByOwnerId = new Map<string, TuneInStatus>();

    ((statusRows ?? []) as Pick<TuneInRow, 'frequency_owner_id' | 'status'>[]).forEach((row) => {
      if (!statusByOwnerId.has(row.frequency_owner_id)) {
        statusByOwnerId.set(row.frequency_owner_id, row.status ?? 'none');
      }
    });

    setCurrentUserId(me);
    setUsers(
      listedIds.map((id) => {
        const profile = profilesById.get(id);
        const username = cleanUsername(profile?.username);

        return {
          id,
          username,
          bio: profile?.bio?.trim() ?? '',
          avatarUrl: profile?.avatar_url ?? null,
          tuneInStatus: id === me ? 'accepted' : statusByOwnerId.get(id) ?? 'none',
        };
      })
    );
    setLoading(false);
  }, [connectionType, userId]);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  async function requestTuneIn(targetUser: ConnectionUser) {
    if (!currentUserId || submittingUserId || targetUser.id === currentUserId) return;

    setSubmittingUserId(targetUser.id);

    try {
      const result = await createTuneInRequest(targetUser.id);

      if (result.status === 'accepted') {
        setSubmittingUserId(null);
        return;
      }
    } catch (error) {
      setSubmittingUserId(null);
      void hapticError();
      Alert.alert('Tune In Error', error instanceof Error ? error.message : 'Could not send request.');
      return;
    }

    setUsers((current) =>
      current.map((user) =>
        user.id === targetUser.id ? { ...user, tuneInStatus: 'pending' } : user
      )
    );
    void light();

    setSubmittingUserId(null);
  }

  async function untuneFrom(targetUser: ConnectionUser) {
    if (!currentUserId || submittingUserId || targetUser.id === currentUserId) return;

    setSubmittingUserId(targetUser.id);

    const previousStatus = targetUser.tuneInStatus;
    const shouldRemoveFromList = connectionType === 'listening' && userId === currentUserId;
    setUsers((current) =>
      shouldRemoveFromList
        ? current.filter((user) => user.id !== targetUser.id)
        : current.map((user) =>
            user.id === targetUser.id ? { ...user, tuneInStatus: 'none' } : user
          )
    );

    const { error } = await supabase
      .from('tune_ins')
      .delete()
      .eq('listener_id', currentUserId)
      .eq('frequency_owner_id', targetUser.id);

    if (error) {
      setUsers((current) =>
        shouldRemoveFromList
          ? [...current, { ...targetUser, tuneInStatus: previousStatus }]
          : current.map((user) =>
              user.id === targetUser.id ? { ...user, tuneInStatus: previousStatus } : user
            )
      );
      setSubmittingUserId(null);
      void hapticError();
      Alert.alert('Tune In Error', error.message);
      return;
    }

    void light();
    setSubmittingUserId(null);
  }

  async function withdrawFrom(targetUser: ConnectionUser) {
    if (!currentUserId || submittingUserId || targetUser.id === currentUserId) return;

    setSubmittingUserId(targetUser.id);

    const previousStatus = targetUser.tuneInStatus;
    setUsers((current) =>
      current.map((user) =>
        user.id === targetUser.id ? { ...user, tuneInStatus: 'none' } : user
      )
    );

    try {
      await withdrawTuneIn(targetUser.id);
    } catch (error) {
      setUsers((current) =>
        current.map((user) =>
          user.id === targetUser.id ? { ...user, tuneInStatus: previousStatus } : user
        )
      );
      setSubmittingUserId(null);
      void hapticError();
      Alert.alert('Tune In Error', error instanceof Error ? error.message : 'Could not withdraw request.');
      return;
    }

    void light();
    setSubmittingUserId(null);
  }

  function handleTuneButton(user: ConnectionUser) {
    if (user.tuneInStatus === 'accepted') {
      untuneFrom(user);
      return;
    }

    if (user.tuneInStatus === 'pending') {
      withdrawFrom(user);
      return;
    }

    requestTuneIn(user);
  }

  const renderUser: ListRenderItem<ConnectionUser> = ({ item }) => {
    const isSelf = item.id === currentUserId;
    const isTunedIn = item.tuneInStatus === 'accepted';
    const isPending = item.tuneInStatus === 'pending';
    const disabled = isSelf || submittingUserId === item.id;
    const initial = item.username.charAt(0).toUpperCase();

    return (
      <Touchable
        style={styles.row}
        activeOpacity={0.82}
        onPress={() => router.push({ pathname: '/frequency/[userId]', params: { userId: item.id } })}
      >
        <Avatar avatarUrl={item.avatarUrl} initial={initial} size={52} textSize={22} />

        <View style={styles.rowCopy}>
          <Text style={styles.username} numberOfLines={1}>
            @{item.username}
          </Text>
          {!!item.bio && (
            <Text style={styles.bio} numberOfLines={2}>
              {item.bio}
            </Text>
          )}
        </View>

        {!isSelf && (
          <Touchable
            style={[
              styles.tuneButton,
              (isTunedIn || isPending) && styles.tunedButton,
              disabled && !isTunedIn && !isPending && styles.disabledButton,
            ]}
            activeOpacity={0.84}
            onPress={() => handleTuneButton(item)}
            disabled={disabled}
          >
            <Text style={[styles.tuneButtonText, (isTunedIn || isPending) && styles.tunedButtonText]}>
              {isTunedIn ? 'Tuned In' : isPending ? 'Pending' : 'Tune In'}
            </Text>
          </Touchable>
        )}
      </Touchable>
    );
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 18 }]}>
      <View style={styles.header}>
        <BackButton />
        <Text style={styles.title}>{title}</Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.loading}>
          <FrequencyLogoLoader size={48} label="Finding frequencies..." />
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(item) => item.id}
          renderItem={renderUser}
          contentContainerStyle={[
            styles.listContent,
            users.length === 0 && styles.emptyContent,
            { paddingBottom: insets.bottom + 28 },
          ]}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>{emptyText}</Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.background,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingBottom: S.md,
    borderBottomWidth: 1,
    borderBottomColor: C.divider,
  },

  title: {
    flex: 1,
    color: C.text,
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },

  // Balances the BackButton so the centred title stays centred.
  headerSpacer: {
    width: BACK_BUTTON_WIDTH,
  },

  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },

  listContent: {
    paddingHorizontal: 18,
    paddingTop: S.md,
  },

  emptyContent: {
    flexGrow: 1,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
    paddingVertical: S.md,
  },

  rowCopy: {
    flex: 1,
    minWidth: 0,
  },

  username: {
    color: C.text,
    fontSize: 16,
    fontWeight: '800',
  },

  bio: {
    color: C.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },

  tuneButton: {
    minWidth: 94,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: R.md,
    backgroundColor: C.accent,
  },

  tunedButton: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.divider,
  },

  disabledButton: {
    opacity: 0.58,
  },

  tuneButtonText: {
    color: '#0B100D',
    fontSize: 13,
    fontWeight: '900',
  },

  tunedButtonText: {
    color: C.text,
  },

  separator: {
    height: 1,
    marginLeft: 68,
    backgroundColor: C.divider,
  },

  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 34,
  },

  emptyText: {
    color: C.muted,
    fontSize: 17,
    lineHeight: 25,
    textAlign: 'center',
  },
});
