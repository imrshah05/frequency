import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import BackButton from '@/components/BackButton';
import Touchable from '@/components/Touchable';
import { router, useLocalSearchParams } from 'expo-router';

import Avatar from '@/components/Avatar';
import { FrequencyLogo, FrequencyLogoLoader } from '@/components/branding/FrequencyLogo';
import {
  FrequencyColors as C,
  FrequencyRadius as R,
  FrequencySpacing as S,
} from '@/constants/frequencyTheme';
import { fetchMutualFollowers, type MutualFrequency } from '@/lib/mutuals';
import { supabase } from '@/lib/supabase';

export default function MutualsScreen() {
  const params = useLocalSearchParams<{ profileUserId?: string | string[] }>();
  const profileUserId = useMemo(() => {
    const raw = params.profileUserId;
    return Array.isArray(raw) ? raw[0] ?? '' : raw ?? '';
  }, [params.profileUserId]);

  const [mutuals, setMutuals] = useState<MutualFrequency[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadMutuals() {
      setLoading(true);

      const { data: userData } = await supabase.auth.getUser();
      const me = userData.user?.id ?? '';

      if (!me || !profileUserId || me === profileUserId) {
        if (!mounted) return;
        setMutuals([]);
        setLoading(false);
        return;
      }

      try {
        const nextMutuals = await fetchMutualFollowers(me, profileUserId);
        if (!mounted) return;
        setMutuals(nextMutuals);
      } catch {
        if (!mounted) return;
        setMutuals([]);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadMutuals();

    return () => {
      mounted = false;
    };
  }, [profileUserId]);

  return (
    <View style={styles.screen}>
      <FlatList
        data={mutuals}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <BackButton variant="close" style={styles.backButton} />

            <Text style={styles.title}>Mutuals</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            {loading ? (
              <>
                <FrequencyLogoLoader size={46} />
                <Text style={styles.emptyText}>Finding mutuals...</Text>
              </>
            ) : (
              <>
                <FrequencyLogo size={54} opacity={0.14} style={styles.emptyLogo} />
                <Text style={styles.emptyText}>No mutuals yet</Text>
              </>
            )}
          </View>
        }
        renderItem={({ item }) => {
          const initial = item.username.charAt(0).toUpperCase() || 'F';

          return (
            <Touchable
              style={styles.row}
              activeOpacity={0.84}
              onPress={() => router.push(`/frequency/${item.id}`)}
            >
              <Avatar
                avatarUrl={item.avatarUrl}
                initial={initial}
                size={52}
                textSize={22}
                backgroundColor={C.elevated}
              />

              <View style={styles.rowText}>
                <Text style={styles.username}>@{item.username}</Text>
                <Text style={styles.subtitle}>View Frequency</Text>
              </View>
            </Touchable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.background,
  },

  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 64,
    paddingBottom: 80,
  },

  header: {
    marginBottom: S.lg,
  },

  backButton: {
    marginBottom: S.lg,
  },

  title: {
    color: C.text,
    fontSize: 36,
    fontWeight: '800',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
    padding: 16,
    borderRadius: R.lg,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.divider,
    marginBottom: S.sm,
  },

  rowText: {
    flex: 1,
  },

  username: {
    color: C.text,
    fontSize: 18,
    fontWeight: '800',
  },

  subtitle: {
    color: C.muted,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 5,
  },

  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 88,
  },

  emptyLogo: {
    marginBottom: S.md,
  },

  emptyText: {
    color: C.muted,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
});
