import { StyleSheet, Text, View } from 'react-native';

import Avatar from '@/components/Avatar';
import { FrequencyColors as C } from '@/constants/frequencyTheme';
import type { MutualPreviewPerson } from '@/lib/suggestedTuneIns';

type MutualAvatarsProps = {
  mutuals: MutualPreviewPerson[];
  totalCount: number;
};

/**
 * "Tuned in by @alex, @sam and 3 others" -- replaces a bare "N mutual"
 * count with who those mutuals actually are. Avatar stack reuses the same
 * overlap technique as the group Whisper "seen by" row
 * (app/whispers/group/[threadId]/index.tsx), just larger since this sits on
 * its own row rather than tucked under a bubble.
 *
 * Falls back to nothing if the profile fetch for these ids ever comes back
 * empty (e.g. a mutual's profile row disappeared) rather than showing a
 * name-less "Tuned in by and 2 others".
 */
export default function MutualAvatars({ mutuals, totalCount }: MutualAvatarsProps) {
  if (mutuals.length === 0 || totalCount === 0) return null;

  const shown = mutuals.slice(0, 3);
  const named = mutuals.slice(0, 2);
  const othersCount = totalCount - named.length;

  const label =
    named.length === 1
      ? `Tuned in by @${named[0].username}`
      : othersCount > 0
        ? `Tuned in by @${named[0].username}, @${named[1].username} and ${othersCount} other${othersCount === 1 ? '' : 's'}`
        : `Tuned in by @${named[0].username} and @${named[1].username}`;

  return (
    <View style={styles.row}>
      <View style={styles.stack}>
        {shown.map((person, index) => (
          <Avatar
            key={person.id}
            avatarUrl={person.avatarUrl}
            initial={person.username}
            size={18}
            textSize={9}
            borderColor={C.surface}
            style={[styles.avatar, index > 0 && styles.avatarStacked]}
          />
        ))}
      </View>

      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  stack: {
    flexDirection: 'row',
  },

  avatar: {
    borderWidth: 1.5,
  },

  avatarStacked: {
    marginLeft: -7,
  },

  label: {
    flex: 1,
    minWidth: 0,
    color: C.muted,
    fontSize: 12,
    fontWeight: '600',
  },
});
