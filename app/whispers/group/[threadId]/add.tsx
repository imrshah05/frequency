import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
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
  addGroupWhisperMember,
  fetchGroupThreadMembers,
  fetchTuneInCandidates,
  MAX_GROUP_PARTICIPANTS,
  type TuneInCandidate,
} from '@/lib/groupWhispers';
import { error as hapticError, success } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';

export default function AddGroupWhisperMembersScreen() {
  const params = useLocalSearchParams<{ threadId?: string | string[] }>();
  const threadId = useMemo(() => {
    const raw = params.threadId;
    return Array.isArray(raw) ? raw[0] ?? '' : raw ?? '';
  }, [params.threadId]);

  const [candidates, setCandidates] = useState<TuneInCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [remainingSlots, setRemainingSlots] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function load() {
      if (!threadId) return;

      setLoading(true);

      const { data: userData } = await supabase.auth.getUser();
      const me = userData.user?.id;

      if (!me) {
        if (mounted) setLoading(false);
        return;
      }

      try {
        const [allCandidates, members] = await Promise.all([
          fetchTuneInCandidates(me),
          fetchGroupThreadMembers(threadId),
        ]);

        if (!mounted) return;

        const memberIds = new Set(members.map((member) => member.id));
        setCandidates(allCandidates.filter((candidate) => !memberIds.has(candidate.id)));
        setRemainingSlots(Math.max(0, MAX_GROUP_PARTICIPANTS - members.length));
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
  }, [threadId]);

  function toggle(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < remainingSlots) {
        next.add(id);
      }

      return next;
    });
  }

  async function handleAdd() {
    if (saving || selectedIds.size === 0 || !threadId) return;

    setSaving(true);

    try {
      for (const userId of selectedIds) {
        await addGroupWhisperMember(threadId, userId);
      }

      void success();
      router.back();
    } catch (err) {
      void hapticError();
      Alert.alert(
        'Whisper Error',
        err instanceof Error ? err.message : 'Could not add everyone selected.'
      );
      setSaving(false);
    }
  }

  const canAdd = selectedIds.size > 0 && !saving && remainingSlots > 0;

  return (
    <View style={styles.screen}>
      <SafeAreaView edges={['top']} style={styles.safeHeader}>
        <View style={styles.header}>
          <BackButton variant="close" />

          <Text style={styles.title}>Add Members</Text>

          <View style={styles.headerSpacer} />
        </View>

        <Text style={styles.subtitle}>
          {remainingSlots === 0
            ? 'This group is full.'
            : `Up to ${remainingSlots} more ${remainingSlots === 1 ? 'person' : 'people'}.`}
        </Text>
      </SafeAreaView>

      <View style={styles.body}>
        <GroupWhisperPicker
          candidates={candidates}
          loading={loading}
          selectedIds={selectedIds}
          onToggle={toggle}
          maxSelectable={remainingSlots}
          emptyText="Everyone you're tuned in with is already here."
        />
      </View>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <Touchable
          style={[styles.addButton, !canAdd && styles.addButtonDisabled]}
          activeOpacity={0.86}
          disabled={!canAdd}
          onPress={handleAdd}
        >
          {saving ? (
            <FrequencyLogoLoader size={22} />
          ) : (
            <Text style={styles.addButtonText}>
              {selectedIds.size > 0 ? `Add ${selectedIds.size}` : 'Add'}
            </Text>
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

  addButton: {
    height: 56,
    borderRadius: R.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.accent,
  },

  addButtonDisabled: {
    backgroundColor: C.elevated,
  },

  addButtonText: {
    color: '#0B100D',
    fontSize: 17,
    fontWeight: '800',
  },
});
