import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Touchable from './Touchable';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  FrequencyColors as C,
  FrequencyRadius as R,
  FrequencySpacing as S,
} from '@/constants/frequencyTheme';

type EchoOptionsSheetProps = {
  visible: boolean;
  title: string;
  onArchive: () => void;
  onDelete: () => void;
  onClose: () => void;
};

// Replaces the native Alert.alert action sheet for the Archive/Delete
// long-press menu on My Frequency, matching the app's own sheet language
// (bioSheet / impactSheet in app/(tabs)/frequency.tsx) instead of the
// system default styling.
export default function EchoOptionsSheet({
  visible,
  title,
  onArchive,
  onDelete,
  onClose,
}: EchoOptionsSheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.modalRoot, { paddingBottom: Math.max(insets.bottom, 14) }]}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />

        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>

          <Touchable style={styles.optionRow} activeOpacity={0.7} onPress={onArchive}>
            <Ionicons name="archive-outline" size={20} color={C.text} />
            <Text style={styles.optionText}>Archive</Text>
          </Touchable>

          <View style={styles.divider} />

          <Touchable style={styles.optionRow} activeOpacity={0.7} onPress={onDelete}>
            <Ionicons name="trash-outline" size={20} color={C.danger} />
            <Text style={[styles.optionText, styles.dangerText]}>Delete</Text>
          </Touchable>
        </View>

        <Touchable style={styles.cancelPill} activeOpacity={0.78} onPress={onClose}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Touchable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },

  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },

  sheet: {
    marginHorizontal: 12,
    marginBottom: S.sm,
    paddingHorizontal: S.lg,
    paddingTop: 22,
    paddingBottom: S.sm,
    borderRadius: R.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.07)',
    backgroundColor: C.surface,
  },

  sheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 3,
    backgroundColor: 'rgba(226,237,232,0.26)',
    marginBottom: 18,
  },

  title: {
    color: C.muted,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    textAlign: 'center',
    marginBottom: S.sm,
  },

  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    paddingVertical: 18,
  },

  optionText: {
    color: C.text,
    fontSize: 17,
    fontWeight: '700',
  },

  dangerText: {
    color: C.danger,
  },

  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.divider,
  },

  cancelPill: {
    marginHorizontal: 12,
    height: 54,
    borderRadius: R.xl,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.07)',
  },

  cancelText: {
    color: C.text,
    fontSize: 16,
    fontWeight: '800',
  },
});
