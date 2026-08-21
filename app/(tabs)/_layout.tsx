import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Tabs, router, usePathname } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { FrequencyColors } from '@/constants/frequencyTheme';
import { useBottomDockSuppressed } from '@/lib/bottomDockVisibility';
import { fetchGroupUnreadCount } from '@/lib/groupWhispers';
import { selection } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';
import { fetchTodaysResonance } from '@/lib/resonance';

const SCREEN_WIDTH = Dimensions.get('window').width;
const DOCK_WIDTH = Math.min((SCREEN_WIDTH - 72) * 1.09, 360);
const RECORD_SIZE = 76;

function DockIcon({
  focused,
  children,
}: {
  focused: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.iconShell, focused && styles.iconShellActive]}>
      {children}
    </View>
  );
}

function CenterRecordMark() {
  const markColor = FrequencyColors.logoSageDeep;

  return (
    <Svg width={55} height={55} viewBox="0 0 100 100">
      <Circle cx="11" cy="50" r="2.5" fill={markColor} />
      <Rect x="15.5" y="32" width="5" height="36" rx="2.5" fill={markColor} />
      <Rect x="22.5" y="22" width="5" height="56" rx="2.5" fill={markColor} />
      <Rect x="29.5" y="39" width="5" height="22" rx="2.5" fill={markColor} />
      <Rect x="36.5" y="22" width="5" height="56" rx="2.5" fill={markColor} />
      <Rect x="43.5" y="41" width="5" height="18" rx="2.5" fill={markColor} />
      <Circle cx="53" cy="50" r="2.5" fill={markColor} />
      <Path
        d="M32,66 L32,74 Q32,88 43.58,80.15 L78.08,56.73 Q88,50 78.08,43.27 L43.58,19.85 Q32,12 32,26 L32,34"
        fill="none"
        stroke={markColor}
        strokeWidth="5"
        strokeLinecap="butt"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

type DockRouteName = 'index' | 'search' | 'whispers' | 'resonance-field';

const dockTabs: {
  name: DockRouteName;
  label: string;
  icon: 'house.fill' | 'magnifyingglass' | 'bubble.left.fill' | 'brain';
}[] = [
  { name: 'index', label: 'Feed', icon: 'house.fill' },
  { name: 'search', label: 'Search', icon: 'magnifyingglass' },
  { name: 'whispers', label: 'Whispers', icon: 'bubble.left.fill' },
  { name: 'resonance-field', label: 'Resonance Field', icon: 'brain' },
];

function FrequencyTabBar({
  state,
  descriptors,
  navigation,
  bottomInset,
  whisperUnreadCount,
}: BottomTabBarProps & {
  bottomInset: number;
  whisperUnreadCount: number;
}) {
  const bottomDockSuppressed = useBottomDockSuppressed();
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSubscription = Keyboard.addListener(showEvent, () => setKeyboardOpen(true));
    const hideSubscription = Keyboard.addListener(hideEvent, () => setKeyboardOpen(false));

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  if (bottomDockSuppressed || keyboardOpen) {
    return null;
  }

  const renderTab = (name: DockRouteName) => {
    const routeIndex = state.routes.findIndex((route) => route.name === name);
    const route = state.routes[routeIndex];
    const tab = dockTabs.find((item) => item.name === name);

    if (!route || !tab) return null;

    const focused = state.index === routeIndex;
    const options = descriptors[route.key]?.options;
    const color = FrequencyColors.text;

    const icon = (
      <DockIcon focused={focused}>
        <IconSymbol name={tab.icon} size={29} color={color} />
        {name === 'whispers' && whisperUnreadCount > 0 && (
          <View style={styles.whisperUnreadDot} />
        )}
      </DockIcon>
    );

    return (
      <Pressable
        key={route.key}
        accessibilityRole="button"
        accessibilityLabel={options?.tabBarAccessibilityLabel ?? tab.label}
        accessibilityState={focused ? { selected: true } : {}}
        testID={options?.tabBarButtonTestID}
        onPress={() => {
          void selection();
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });

          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
          }
        }}
        onLongPress={() => {
          navigation.emit({
            type: 'tabLongPress',
            target: route.key,
          });
        }}
        style={[
          styles.tabSlot,
          name === 'index' && styles.outerTabLeft,
          name === 'search' && styles.innerTabLeft,
          name === 'whispers' && styles.innerTabRight,
          name === 'resonance-field' && styles.outerTabRight,
        ]}
      >
        {icon}
      </Pressable>
    );
  };

  return (
    <View
      pointerEvents="box-none"
      style={[styles.tabBarWrapper, { bottom: Math.max(bottomInset, 12) }]}
    >
      <View style={styles.dock}>
        <View style={styles.tabGroup}>
          {renderTab('index')}
          {renderTab('search')}
        </View>

        <View pointerEvents="none" style={styles.recordGap} />

        <View style={styles.tabGroup}>
          {renderTab('whispers')}
          {renderTab('resonance-field')}
        </View>

        <View style={styles.centerButtonPosition}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Record"
            onPress={() => {
              void selection();
              router.push('/record');
            }}
            style={styles.centerButtonPressable}
          >
            {({ pressed }) => (
              <View style={[styles.centerButton, pressed && styles.centerButtonPressed]}>
                <CenterRecordMark />
              </View>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export default function TabLayout() {
  const [whisperUnreadCount, setWhisperUnreadCount] = useState(0);
  const [groupWhisperUnreadCount, setGroupWhisperUnreadCount] = useState(0);
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const resonancePromptCheckedRef = useRef(false);

  // Resonance is a once-a-day prompt, checked once per app session rather
  // than on every tab focus — it should never nag beyond the first ask.
  useEffect(() => {
    if (resonancePromptCheckedRef.current) return;
    resonancePromptCheckedRef.current = true;

    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) return;

      const todaysEntry = await fetchTodaysResonance(userId);
      if (!todaysEntry) {
        router.push('/resonance');
      }
    })();
  }, []);

  const refreshWhisperUnreadCount = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;

    if (!userId) {
      setWhisperUnreadCount(0);
      return;
    }

    const { count, error } = await supabase
      .from('whisper_messages')
      .select('id', { count: 'exact', head: true })
      .eq('receiver_id', userId)
      .is('read_at', null);

    if (!error) {
      setWhisperUnreadCount(count ?? 0);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    let subscriptionGeneration = 0;
    let currentUserId: string | null = null;
    let whisperChannel: ReturnType<typeof supabase.channel> | null = null;
    let whisperChannelUserId: string | null = null;
    let operationQueue = Promise.resolve();

    function debug(message: string) {
      if (__DEV__) console.debug(`[realtime] ${message}`);
    }

    async function removeWhisperChannels() {
      const channels = supabase
        .getChannels()
        .filter((channel) => channel.topic.startsWith('realtime:whisper-unread-'));

      if (whisperChannel && !channels.includes(whisperChannel)) {
        channels.push(whisperChannel);
      }

      whisperChannel = null;
      whisperChannelUserId = null;

      if (channels.length === 0) return;

      debug('removing previous whisper channel');
      await Promise.all(channels.map((channel) => supabase.removeChannel(channel)));
      debug('cleanup completed');
    }

    function enqueue(operation: () => Promise<void>) {
      const nextOperation = operationQueue.then(operation, operation);
      operationQueue = nextOperation.catch((error) => {
        console.error('[realtime] whisper channel lifecycle failed', error);
      });
      return nextOperation;
    }

    function subscribeToWhisperUnread(userId: string | null) {
      currentUserId = userId;
      const generation = ++subscriptionGeneration;

      void enqueue(async () => {
        if (!mounted || generation !== subscriptionGeneration) return;

        if (!userId) {
          await removeWhisperChannels();
          return;
        }

        if (whisperChannel && whisperChannelUserId === userId) {
          debug('duplicate subscription prevented');
          return;
        }

        await removeWhisperChannels();

        if (!mounted || generation !== subscriptionGeneration || currentUserId !== userId) {
          return;
        }

        const channel = supabase.channel(`whisper-unread-${userId}`);
        debug('creating whisper channel');
        channel.on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'whisper_messages',
            filter: `receiver_id=eq.${userId}`,
          },
          () => {
            refreshWhisperUnreadCount();
          }
        );
        debug('attaching postgres callback');

        // Store ownership before subscribe so cleanup can remove this exact
        // channel even if auth changes while Realtime is joining.
        whisperChannel = channel;
        whisperChannelUserId = userId;
        debug('subscribing');
        channel.subscribe();
      });
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;

      const nextUserId = session?.user.id ?? null;
      debug('auth user changed');
      subscribeToWhisperUnread(nextUserId);
      if (nextUserId) {
        refreshWhisperUnreadCount();
      } else {
        setWhisperUnreadCount(0);
      }
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      subscribeToWhisperUnread(data.session?.user.id ?? null);
      if (data.session?.user.id) refreshWhisperUnreadCount();
    });

    return () => {
      mounted = false;
      subscriptionGeneration += 1;
      currentUserId = null;
      subscription.unsubscribe();
      void enqueue(async () => {
        await removeWhisperChannels();
      });
    };
  }, [refreshWhisperUnreadCount]);

  useEffect(() => {
    refreshWhisperUnreadCount();
  }, [pathname, refreshWhisperUnreadCount]);

  const refreshGroupWhisperUnreadCount = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;

    if (!userId) {
      setGroupWhisperUnreadCount(0);
      return;
    }

    try {
      setGroupWhisperUnreadCount(await fetchGroupUnreadCount(userId));
    } catch {
      // Tab-bar badge is a nice-to-have; a failed count refresh should
      // never surface as user-facing breakage.
    }
  }, []);

  // Group Echoes have no single receiver_id to filter a realtime channel
  // by (unlike 1:1 whisper_messages), so this channel is unfiltered and
  // just triggers a recount on any change -- simpler than the 1:1
  // channel above, which has to be torn down and recreated whenever the
  // signed-in user changes because its filter is user-specific.
  useEffect(() => {
    let mounted = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function setupChannel() {
      // A channel that's already had `.subscribe()` called on it throws if
      // `.on()` is called again -- so a stale channel left behind by a
      // Fast Refresh / remount (same topic, still joined) has to be
      // removed before creating a fresh one. Same guard the 1:1 whisper
      // channel above uses via removeWhisperChannels().
      const staleChannels = supabase
        .getChannels()
        .filter((existing) => existing.topic === 'realtime:group-whisper-unread');

      if (staleChannels.length > 0) {
        await Promise.all(staleChannels.map((existing) => supabase.removeChannel(existing)));
      }

      if (!mounted) return;

      channel = supabase
        .channel('group-whisper-unread')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'whisper_group_messages' },
          () => {
            if (mounted) refreshGroupWhisperUnreadCount();
          }
        )
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'whisper_group_message_reads' },
          () => {
            if (mounted) refreshGroupWhisperUnreadCount();
          }
        )
        .subscribe();
    }

    void setupChannel();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;

      if (session?.user.id) {
        refreshGroupWhisperUnreadCount();
      } else {
        setGroupWhisperUnreadCount(0);
      }
    });

    void refreshGroupWhisperUnreadCount();

    return () => {
      mounted = false;
      subscription.unsubscribe();
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [refreshGroupWhisperUnreadCount]);

  useEffect(() => {
    refreshGroupWhisperUnreadCount();
  }, [pathname, refreshGroupWhisperUnreadCount]);

  return (
    <Tabs
      tabBar={(props) => (
        <FrequencyTabBar
          {...props}
          bottomInset={insets.bottom}
          whisperUnreadCount={whisperUnreadCount + groupWhisperUnreadCount}
        />
      )}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Feed',
        }}
      />

      <Tabs.Screen
        name="search"
        options={{
          title: 'Search',
        }}
      />

      <Tabs.Screen
        name="create"
        options={{
          title: '',
        }}
      />

      <Tabs.Screen
        name="whispers"
        options={{
          title: 'Whispers',
        }}
      />

      <Tabs.Screen
        name="frequency"
        options={{
          title: 'My Frequency',
        }}
      />

      <Tabs.Screen
        name="resonance-field"
        options={{
          title: 'Resonance Field',
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBarWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  dock: {
    width: DOCK_WIDTH,
    height: 74,
    borderRadius: 37,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    backgroundColor: 'rgba(17, 22, 20, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(168, 205, 183, 0.12)',
    shadowColor: FrequencyColors.accent,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.16,
    shadowRadius: 28,
    elevation: 18,
  },
  tabGroup: {
    flex: 1,
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  tabSlot: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  outerTabLeft: {
    transform: [{ translateX: -10 }],
  },
  innerTabLeft: {
    transform: [{ translateX: -7 }],
  },
  innerTabRight: {
    transform: [{ translateX: 7 }],
  },
  outerTabRight: {
    transform: [{ translateX: 10 }],
  },
  recordGap: {
    width: RECORD_SIZE,
    height: '100%',
  },
  iconShell: {
    width: 48,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    transform: [{ translateY: -1 }],
  },
  iconShellActive: {
    backgroundColor: 'rgba(168, 205, 183, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(168, 205, 183, 0.13)',
  },
  centerButtonPosition: {
    position: 'absolute',
    left: DOCK_WIDTH / 2 - RECORD_SIZE / 2,
    top: -18,
    width: RECORD_SIZE,
    height: RECORD_SIZE,
  },
  centerButtonPressable: {
    width: RECORD_SIZE,
    height: RECORD_SIZE,
  },
  centerButton: {
    width: RECORD_SIZE,
    height: RECORD_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: RECORD_SIZE / 2,
    backgroundColor: FrequencyColors.accent,
    shadowColor: FrequencyColors.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 14,
  },
  centerButtonPressed: {
    transform: [{ scale: 0.965 }],
  },
  whisperUnreadDot: {
    position: 'absolute',
    top: 5,
    right: 6,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: FrequencyColors.accent,
    borderWidth: 2,
    borderColor: FrequencyColors.background,
  },
});
