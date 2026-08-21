import Ionicons from '@expo/vector-icons/Ionicons';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import Touchable from './Touchable';

import Avatar from '@/components/Avatar';
import { FrequencyLogoLoader } from '@/components/branding/FrequencyLogo';
import {
  FrequencyColors as C,
  FrequencyRadius as R,
  FrequencySpacing as S,
} from '@/constants/frequencyTheme';
import type { TuneInCandidate } from '@/lib/groupWhispers';
import { selection } from '@/lib/haptics';

type GroupWhisperPickerProps = {
  candidates: TuneInCandidate[];
  loading: boolean;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  maxSelectable: number;
  emptyText: string;
};

export default function GroupWhisperPicker({
  candidates,
  loading,
  selectedIds,
  onToggle,
  maxSelectable,
  emptyText,
}: GroupWhisperPickerProps) {
  const atLimit = selectedIds.size >= maxSelectable;

  return (
    <FlatList
      data={candidates}
      keyExtractor={(item) => item.id}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.content}
      ListEmptyComponent={
        <View style={styles.emptyState}>
          {loading ? (
            <FrequencyLogoLoader size={40} />
          ) : (
            <Text style={styles.emptyText}>{emptyText}</Text>
          )}
        </View>
      }
      renderItem={({ item }) => {
        const selected = selectedIds.has(item.id);
        const disabled = !selected && atLimit;

        return (
          <Touchable
            style={[styles.row, selected && styles.rowSelected]}
            activeOpacity={0.82}
            disabled={disabled}
            onPress={() => {
              void selection();
              onToggle(item.id);
            }}
          >
            <Avatar
              avatarUrl={item.avatarUrl}
              initial={item.username}
              size={48}
              textSize={19}
              backgroundColor={C.elevated}
            />

            <Text style={[styles.username, disabled && styles.usernameDisabled]}>
              @{item.username}
            </Text>

            <View style={[styles.checkCircle, selected && styles.checkCircleSelected]}>
              {selected && <Ionicons name="checkmark" size={14} color="#0B100D" />}
            </View>
          </Touchable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingBottom: 40,
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

  rowSelected: {
    borderColor: C.accent,
    backgroundColor: 'rgba(107,168,130,0.1)',
  },

  username: {
    flex: 1,
    color: C.text,
    fontSize: 17,
    fontWeight: '700',
  },

  usernameDisabled: {
    color: C.faint,
  },

  checkCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: C.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },

  checkCircleSelected: {
    backgroundColor: C.accent,
    borderColor: C.accent,
  },

  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 88,
  },

  emptyText: {
    color: C.muted,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 23,
    maxWidth: 280,
  },
});
