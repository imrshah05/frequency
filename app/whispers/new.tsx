import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Avatar from '@/components/Avatar';
import BackButton, { BACK_BUTTON_WIDTH } from '@/components/BackButton';
import SearchBar from '@/components/SearchBar';
import Touchable from '@/components/Touchable';
import { FrequencyLogoLoader } from '@/components/branding/FrequencyLogo';
import {
  FrequencyColors as C,
  FrequencyRadius as R,
  FrequencySpacing as S,
} from '@/constants/frequencyTheme';
import { error as hapticError, light, selection } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';
import {
  fetchListeningTo,
  openOrCreateWhisperThread,
  type ListeningToContact,
} from '@/lib/whispers';

export default function NewWhisperScreen() {
  const [contacts, setContacts] = useState<ListeningToContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [openingId, setOpeningId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);

      const { data: userData } = await supabase.auth.getUser();
      const me = userData.user?.id;

      if (!me) {
        if (mounted) setLoading(false);
        return;
      }

      try {
        const next = await fetchListeningTo(me);
        if (mounted) setContacts(next);
      } catch (err) {
        if (mounted) {
          void hapticError();
          Alert.alert(
            'Whisper Error',
            err instanceof Error ? err.message : 'Could not load who you Listen To.'
          );
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();

    return () => {
      mounted = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return contacts;
    return contacts.filter((contact) => contact.username.toLowerCase().includes(needle));
  }, [contacts, query]);

  async function openChat(contact: ListeningToContact) {
    if (openingId) return;

    setOpeningId(contact.id);

    try {
      const thread = await openOrCreateWhisperThread(contact.id);
      void light();
      router.replace({
        pathname: '/whispers/[threadId]',
        params: { threadId: thread.id, otherUserId: contact.id },
      });
    } catch (err) {
      setOpeningId(null);
      void hapticError();
      Alert.alert(
        'Whisper Error',
        err instanceof Error ? err.message : 'Could not open this Whisper.'
      );
    }
  }

  const emptyText = contacts.length === 0
    ? "You aren't Listening To anyone yet — Whispers start with people you Tune In to."
    : 'No one matches that search.';

  return (
    <View style={styles.screen}>
      <SafeAreaView edges={['top']} style={styles.safeHeader}>
        <View style={styles.header}>
          <BackButton variant="close" />
          <Text style={styles.title}>New Whisper</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.searchWrap}>
          <SearchBar value={query} onChangeText={setQuery} placeholder="Find a voice to whisper to..." />
        </View>
      </SafeAreaView>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={styles.emptyState}>
            {loading ? (
              <FrequencyLogoLoader size={40} />
            ) : (
              <Text style={styles.emptyText}>{emptyText}</Text>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <Touchable
            style={styles.row}
            activeOpacity={0.82}
            disabled={openingId !== null}
            onPress={() => {
              void selection();
              openChat(item);
            }}
          >
            <Avatar
              avatarUrl={item.avatarUrl}
              initial={item.username}
              size={54}
              textSize={22}
              backgroundColor={C.elevated}
            />

            <Text style={styles.username} numberOfLines={1}>
              @{item.username}
            </Text>

            {openingId === item.id && <FrequencyLogoLoader size={20} />}
          </Touchable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.background,
  },

  safeHeader: {
    backgroundColor: 'transparent',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
  },

  // Balances the BackButton so the centred title stays centred.
  headerSpacer: {
    width: BACK_BUTTON_WIDTH,
  },

  title: {
    color: C.text,
    fontSize: 20,
    fontWeight: '800',
  },

  searchWrap: {
    paddingHorizontal: 20,
    paddingTop: S.lg,
    paddingBottom: S.md,
  },

  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
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

  username: {
    flex: 1,
    color: C.text,
    fontSize: 17,
    fontWeight: '700',
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
