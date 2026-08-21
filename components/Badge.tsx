import { StyleSheet, Text, View } from 'react-native';

import { FrequencyColors as C } from '@/constants/frequencyTheme';

type BadgeProps = {
  count: number;
};

function labelFor(count: number) {
  return count === 1 ? '1 shared group' : `${count} shared groups`;
}

/**
 * Inline pill chip for shared-group counts. Visual language (elevated
 * background, thin divider border, small bold accent text) is carried over
 * from GroupAvatarCluster's "+N" overlay badge -- the closest existing
 * precedent -- adapted from a circular avatar-corner overlay to an inline
 * pill, since this renders in a row rather than stacked on an avatar.
 */
export default function Badge({ count }: BadgeProps) {
  return (
    <View style={styles.badge}>
      <Text style={styles.text}>{labelFor(count)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.divider,
  },

  text: {
    color: C.accentSoft,
    fontSize: 11,
    fontWeight: '800',
  },
});
