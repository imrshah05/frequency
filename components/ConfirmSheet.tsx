import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Touchable from './Touchable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  FrequencyColors as C,
  FrequencyRadius as R,
  FrequencySpacing as S,
} from '@/constants/frequencyTheme';

type ConfirmSheetProps = {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

// Generic confirm bottom sheet, styled to match the rest of Frequency's
// sheets instead of the system Alert.alert. Currently used for the Delete
// confirmation on My Frequency.
export default function ConfirmSheet({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onClose,
}: ConfirmSheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.modalRoot, { paddingBottom: Math.max(insets.bottom, 14) }]}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />

        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.title}>{title}</Text>
          {message && <Text style={styles.message}>{message}</Text>}

          <Touchable
            style={[styles.confirmButton, danger && styles.confirmButtonDanger]}
            activeOpacity={0.86}
            onPress={onConfirm}
          >
            <Text style={[styles.confirmText, danger && styles.confirmTextDanger]}>
              {confirmLabel}
            </Text>
          </Touchable>

          <Touchable style={styles.cancelButton} activeOpacity={0.78} onPress={onClose}>
            <Text style={styles.cancelText}>{cancelLabel}</Text>
          </Touchable>
        </View>
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
    marginBottom: 14,
    paddingHorizontal: S.lg,
    paddingTop: 22,
    paddingBottom: 28,
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
    marginBottom: 22,
  },

  title: {
    color: C.text,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
    textAlign: 'center',
  },

  message: {
    color: C.muted,
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 10,
  },

  confirmButton: {
    height: 54,
    borderRadius: R.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.accent,
    marginTop: S.lg,
  },

  confirmButtonDanger: {
    backgroundColor: C.danger,
  },

  confirmText: {
    color: '#0B100D',
    fontSize: 16,
    fontWeight: '800',
  },

  confirmTextDanger: {
    color: '#1A0E0E',
  },

  cancelButton: {
    height: 52,
    borderRadius: R.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: S.sm,
  },

  cancelText: {
    color: C.text,
    fontSize: 16,
    fontWeight: '700',
  },
});
