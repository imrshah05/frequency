import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import Avatar from '@/components/Avatar';
import { FrequencyColors as C } from '@/constants/frequencyTheme';

type ClusterMember = {
  username: string;
  avatarUrl: string | null;
};

type GroupAvatarClusterProps = {
  members: ClusterMember[];
  extraCount: number;
  size: number;
};

export default function GroupAvatarCluster({ members, extraCount, size }: GroupAvatarClusterProps) {
  const shown = members.slice(0, 2);
  const circleSize = Math.round(size * 0.68);

  if (shown.length === 0) {
    return (
      <View
        style={[
          styles.placeholder,
          { width: size, height: size, borderRadius: size / 2 },
        ]}
      >
        <Ionicons name="people-outline" size={Math.round(size * 0.46)} color={C.accentSoft} />
      </View>
    );
  }

  return (
    <View style={{ width: size, height: size }}>
      {shown.map((member, index) => (
        <Avatar
          key={member.username + index}
          avatarUrl={member.avatarUrl}
          initial={member.username}
          size={circleSize}
          textSize={Math.round(circleSize * 0.4)}
          borderColor={C.background}
          style={[
            styles.clusterAvatar,
            index === 0 ? styles.clusterAvatarBack : styles.clusterAvatarFront,
          ]}
        />
      ))}

      {extraCount > 0 && (
        <View style={styles.extraBadge}>
          <Text style={styles.extraBadgeText}>+{extraCount}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.divider,
  },

  clusterAvatar: {
    position: 'absolute',
  },

  clusterAvatarBack: {
    top: 0,
    left: 0,
  },

  clusterAvatarFront: {
    bottom: 0,
    right: 0,
  },

  extraBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.background,
  },

  extraBadgeText: {
    color: C.text,
    fontSize: 10,
    fontWeight: '800',
  },
});
