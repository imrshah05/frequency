import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import BackButton, { BACK_BUTTON_WIDTH } from '@/components/BackButton';
import Touchable from '@/components/Touchable';
import { SafeAreaView } from 'react-native-safe-area-context';

import GroupWhisperPicker from '@/components/GroupWhisperPicker';
import { FrequencyLogoLoader } from '@/components/branding/FrequencyLogo';
import {
  FrequencyColors as C,
  FrequencyRadius as R,
  FrequencySpacing as S,
} from '@/constants/frequencyTheme';
import {
  createGroupWhisperThread,
  fetchTuneInCandidates,
  MAX_GROUP_PARTICIPANTS,
  MIN_GROUP_OTHER_PARTICIPANTS,
  type TuneInCandidate,
} from '@/lib/groupWhispers';
import { error as hapticError, success } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';

const MAX_OTHERS = MAX_GROUP_PARTICIPANTS - 1;

export default function NewGroupWhisperScreen() {
  const [candidates, setCandidates] = useState<TuneInCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);

      const { data: userData } = await supabase.auth.getUser();
      const me = userData.user?.id;

      if (!me) {
        if (mounted) setLoading(false);
        return;
      }

      try {
        const next = await fetchTuneInCandidates(me);
        if (mounted) setCandidates(next);
      } catch (err) {
        if (mounted) {
          void hapticError();
          Alert.alert(
            'Whisper Error',
            err instanceof Error ? err.message : 'Could not load your Tune Ins.'
          );
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();

    return () => {
      mounted = false;
    };
  }, []);

  function toggle(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < MAX_OTHERS) {
        next.add(id);
      }

      return next;
    });
  }

  async function handleCreate() {
    if (creating || selectedIds.size < MIN_GROUP_OTHER_PARTICIPANTS) return;

    setCreating(true);

    try {
      const thread = await createGroupWhisperThread([...selectedIds]);
      void success();
      router.replace({
        pathname: '/whispers/group/[threadId]',
        params: { threadId: thread.id },
      });
    } catch (err) {
      void hapticError();
      Alert.alert(
        'Group Whisper Error',
        err instanceof Error ? err.message : 'Could not create this group.'
      );
      setCreating(false);
    }
  }

  const canCreate = selectedIds.size >= MIN_GROUP_OTHER_PARTICIPANTS && !creating;
  const subtitle =
    selectedIds.size === 0
      ? `Choose at least ${MIN_GROUP_OTHER_PARTICIPANTS} people you're tuned in with.`
      : `${selectedIds.size} selected · up to ${MAX_OTHERS} people`;

  return (
    <View style={styles.screen}>
      <SafeAreaView edges={['top']} style={styles.safeHeader}>
        <View style={styles.header}>
          <BackButton variant="close" />

          <Text style={styles.title}>New Group</Text>

          <View style={styles.headerSpacer} />
        </View>

        <Text style={styles.subtitle}>{subtitle}</Text>
      </SafeAreaView>

      <View style={styles.body}>
        <GroupWhisperPicker
          candidates={candidates}
          loading={loading}
          selectedIds={selectedIds}
          onToggle={toggle}
          maxSelectable={MAX_OTHERS}
          emptyText="Tune into a few people first — group Whispers are built from your Tune Ins."
        />
      </View>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <Touchable
          style={[styles.createButton, !canCreate && styles.createButtonDisabled]}
          activeOpacity={0.86}
          disabled={!canCreate}
          onPress={handleCreate}
        >
          {creating ? (
            <FrequencyLogoLoader size={22} />
          ) : (
            <Text style={styles.createButtonText}>Create Group</Text>
          )}
        </Touchable>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.background,
  },

  safeHeader: {
    backgroundColor: 'transparent',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
  },

  // Balances the BackButton so the centred title stays centred.
  headerSpacer: {
    width: BACK_BUTTON_WIDTH,
  },

  title: {
    color: C.text,
    fontSize: 20,
    fontWeight: '800',
  },

  subtitle: {
    color: C.muted,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 32,
    marginTop: S.sm,
    marginBottom: S.lg,
  },

  body: {
    flex: 1,
    paddingHorizontal: 20,
  },

  footer: {
    paddingHorizontal: 20,
    paddingTop: S.sm,
    backgroundColor: 'transparent',
  },

  createButton: {
    height: 56,
    borderRadius: R.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.accent,
  },

  createButtonDisabled: {
    backgroundColor: C.elevated,
  },

  createButtonText: {
    color: '#0B100D',
    fontSize: 17,
    fontWeight: '800',
  },
});
