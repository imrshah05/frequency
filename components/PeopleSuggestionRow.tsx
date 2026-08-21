import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import Touchable from './Touchable';

import Avatar from '@/components/Avatar';
import Badge from '@/components/Badge';
import MutualAvatars from '@/components/MutualAvatars';
import {
  FrequencyColors as C,
  FrequencyRadius as R,
  FrequencySpacing as S,
} from '@/constants/frequencyTheme';
import { useTuneIn } from '@/hooks/useTuneIn';
import type { SuggestedTuneIn } from '@/lib/suggestedTuneIns';

export type PeopleSuggestionRowProps = {
  suggestion: SuggestedTuneIn;
  /** Called once the Tune In request succeeds (status leaves 'none'). */
  onActioned: (id: string) => void;
  onDismiss: (id: string) => void;
};

export default function PeopleSuggestionRow({ suggestion, onActioned, onDismiss }: PeopleSuggestionRowProps) {
  const { tuneInStatus, isSubmitting, toggleTuneIn } = useTuneIn(suggestion.id);
  const actionedRef = useRef(false);

  // useTuneIn moves tuneInStatus off 'none' only once the request actually
  // succeeds (it leaves it at 'none' on error) -- that transition is the
  // success signal, no separate try/catch needed here.
  useEffect(() => {
    if (tuneInStatus !== 'none' && !actionedRef.current) {
      actionedRef.current = true;
      onActioned(suggestion.id);
    }
  }, [tuneInStatus, suggestion.id, onActioned]);

  const buttonText =
    tuneInStatus === 'accepted' ? 'Tuned In' : tuneInStatus === 'pending' ? 'Pending' : 'Tune In';
  const isDisabled = isSubmitting || tuneInStatus !== 'none';

  return (
    <View style={styles.row}>
      <Touchable
        style={styles.identity}
        activeOpacity={0.8}
        onPress={() => router.push(`/frequency/${suggestion.id}`)}
      >
        <Avatar
          avatarUrl={suggestion.avatarUrl}
          initial={suggestion.username}
          size={54}
          textSize={22}
          backgroundColor={C.elevated}
        />

        <View style={styles.rowText}>
          <Text style={styles.username} numberOfLines={1}>
            @{suggestion.username}
          </Text>

          <View style={styles.badgeRow}>
            {suggestion.mutualConnectionCount > 0 && (
              <MutualAvatars
                mutuals={suggestion.mutualPreview}
                totalCount={suggestion.mutualConnectionCount}
              />
            )}
            {suggestion.sharedGroupCount > 0 && <Badge count={suggestion.sharedGroupCount} />}
          </View>
        </View>
      </Touchable>

      <Touchable
        style={styles.dismissButton}
        activeOpacity={0.7}
        onPress={() => onDismiss(suggestion.id)}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Ionicons name="close" size={16} color={C.muted} />
      </Touchable>

      <Touchable
        style={[styles.tuneButton, tuneInStatus === 'pending' && styles.pendingButton]}
        activeOpacity={0.86}
        onPress={() => void toggleTuneIn()}
        disabled={isDisabled}
      >
        <Text style={[styles.tuneButtonText, tuneInStatus !== 'none' && styles.tunedButtonText]}>
          {buttonText}
        </Text>
      </Touchable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: S.md,
    padding: 16,
    borderRadius: R.lg,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.divider,
  },

  identity: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },

  rowText: {
    flex: 1,
    minWidth: 0,
    marginLeft: S.md,
    marginRight: S.sm,
  },

  username: {
    color: C.text,
    fontSize: 17,
    fontWeight: '800',
  },

  badgeRow: {
    flexDirection: 'column',
    gap: 6,
    marginTop: 8,
  },

  dismissButton: {
    marginRight: S.sm,
  },

  tuneButton: {
    minWidth: 82,
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: R.md,
    backgroundColor: C.accent,
  },

  pendingButton: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.divider,
  },

  tuneButtonText: {
    color: '#0B100D',
    fontSize: 13,
    fontWeight: '800',
  },

  tunedButtonText: {
    color: C.text,
  },
});
