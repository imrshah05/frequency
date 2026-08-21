import Avatar from '@/components/Avatar';
import GroupAvatarCluster from '@/components/GroupAvatarCluster';
import { FrequencyColors as C } from '@/constants/frequencyTheme';

type ClusterMember = {
  username: string;
  avatarUrl: string | null;
};

type GroupAvatarDisplayProps = {
  avatarUrl: string | null;
  members: ClusterMember[];
  extraCount: number;
  size: number;
};

/**
 * A group's real photo once one has been set, otherwise the generated
 * stacked-member placeholder. Shared by the inbox row, the thread header,
 * and Manage Members so all three stay in sync automatically.
 */
export default function GroupAvatarDisplay({
  avatarUrl,
  members,
  extraCount,
  size,
}: GroupAvatarDisplayProps) {
  if (avatarUrl) {
    return (
      <Avatar
        avatarUrl={avatarUrl}
        initial="F"
        size={size}
        borderColor={C.divider}
      />
    );
  }

  return <GroupAvatarCluster members={members} extraCount={extraCount} size={size} />;
}
