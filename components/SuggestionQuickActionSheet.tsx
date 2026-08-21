import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Touchable from './Touchable';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  FrequencyColors as C,
  FrequencyRadius as R,
  FrequencySpacing as S,
} from '@/constants/frequencyTheme';

type SuggestionQuickActionSheetProps = {
  visible: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

// Long-press quick action on the Feed's Suggested Tune-In card. Same sheet
// language as EchoOptionsSheet (modal/backdrop/handle/cancelPill), just a
// single, non-destructive option -- this turns a durable preference off,
// it doesn't delete anything, so no danger styling.
export default function SuggestionQuickActionSheet({
  visible,
  onConfirm,
  onClose,
}: SuggestionQuickActionSheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.modalRoot, { paddingBottom: Math.max(insets.bottom, 14) }]}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />

        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />

          <Touchable style={styles.optionRow} activeOpacity={0.7} onPress={onConfirm}>
            <Ionicons name="eye-off-outline" size={20} color={C.text} />
            <Text style={styles.optionText}>Don&apos;t suggest people in my Feed</Text>
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
