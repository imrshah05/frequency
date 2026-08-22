import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import BackButton from '@/components/BackButton';
import Touchable from '@/components/Touchable';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Audio, AVPlaybackStatus } from 'expo-av';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Avatar from '@/components/Avatar';
import FrequencyWaveform from '@/components/FrequencyWaveform';
import { FrequencyLogoLoader } from '@/components/branding/FrequencyLogo';
import { FrequencyColors as C } from '@/constants/frequencyTheme';
import { formatRemainingLiveDuration, isEchoLive, liveEchoCutoffIso } from '@/lib/echoLifecycle';
import { supabase } from '@/lib/supabase';
import { prefetchAudioUrls, withAudioUrl } from '@/lib/audioUrls';

const { height } = Dimensions.get('window');

type LiveEcho = {
  id: string;
  user_id: string;
  username: string | null;
  audio_url: string;
  audio_path?: string | null;
  caption: string | null;
  created_at: string;
  waveform?: number[] | null;
  avatarUrl?: string | null;
};

type ProfileRow = {
  username: string | null;
  avatar_url: string | null;
};

function timeAgo(dateString: string) {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);

  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return new Date(dateString).toLocaleDateString();
}

function cleanUsername(username: string | null | undefined) {
  return String(username ?? 'frequency').replace(/^@/, '').trim() || 'frequency';
}

export default function LiveEchoViewerScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ userId?: string | string[] }>();
  const userId = useMemo(() => {
    const raw = params.userId;
    return Array.isArray(raw) ? raw[0] ?? '' : raw ?? '';
  }, [params.userId]);
  const [echoes, setEchoes] = useState<LiveEcho[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [isSoundPlaying, setIsSoundPlaying] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [now, setNow] = useState(Date.now());
  const soundRef = useRef<Audio.Sound | null>(null);
  const playingIdRef = useRef<string | null>(null);
  const seekingRef = useRef(false);
  const pendingSeekRef = useRef<{ echo: LiveEcho; fraction: number } | null>(null);
  const durationMillisRef = useRef<number | null>(null);
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 70 }).current;

  const stopPlayback = useCallback(async () => {
    try {
      if (soundRef.current) {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
    } finally {
      playingIdRef.current = null;
      durationMillisRef.current = null;
      setPlayingId(null);
      setIsSoundPlaying(false);
      setPlaybackProgress(0);
    }
  }, []);

  const playEcho = useCallback(
    async (echo: LiveEcho, seekFraction?: number) => {
      try {
        await stopPlayback();
        setPlayingId(echo.id);
        playingIdRef.current = echo.id;
        setPlaybackProgress(Math.max(0, Math.min(1, seekFraction ?? 0)));
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
        const created = await withAudioUrl(echo.audio_path, (uri) =>
          Audio.Sound.createAsync({ uri })
        );
        if (!created) {
          setPlayingId(null);
          playingIdRef.current = null;
          return;
        }
        const { sound, status: initialStatus } = created;
        soundRef.current = sound;
        durationMillisRef.current =
          initialStatus.isLoaded && initialStatus.durationMillis
            ? initialStatus.durationMillis
            : null;
        await sound.setProgressUpdateIntervalAsync(100);

        if (seekFraction != null && durationMillisRef.current) {
          await sound.setPositionAsync(
            Math.max(0, Math.min(1, seekFraction)) * durationMillisRef.current
          );
        }

        await sound.playAsync();
        setIsSoundPlaying(true);
        sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
          if (!status.isLoaded) return;
          if (status.durationMillis) {
            durationMillisRef.current = status.durationMillis;
          }
          if (status.durationMillis && playingIdRef.current === echo.id && !seekingRef.current) {
            setPlaybackProgress(status.positionMillis / status.durationMillis);
          }
          if (status.didJustFinish) {
            playingIdRef.current = null;
            durationMillisRef.current = null;
            setPlayingId(null);
            setIsSoundPlaying(false);
            setPlaybackProgress(0);
          }
        });
      } catch {
        await stopPlayback();
      }
    },
    [stopPlayback]
  );

  const togglePlayback = useCallback(
    async (echo: LiveEcho) => {
      if (playingIdRef.current === echo.id && soundRef.current) {
        const status = await soundRef.current.getStatusAsync();
        if (status.isLoaded) {
          if (status.isPlaying) {
            await soundRef.current.pauseAsync();
            setIsSoundPlaying(false);
          } else {
            await soundRef.current.playAsync();
            setIsSoundPlaying(true);
          }
          return;
        }
      }

      await playEcho(echo);
    },
    [playEcho]
  );

  const seekEcho = useCallback(
    async (echo: LiveEcho, fraction: number) => {
      const clamped = Math.max(0, Math.min(1, fraction));

      if (playingIdRef.current !== echo.id || !soundRef.current) {
        await playEcho(echo, clamped);
        return;
      }

      setPlaybackProgress(clamped);

      if (seekingRef.current) {
        pendingSeekRef.current = { echo, fraction: clamped };
        return;
      }

      seekingRef.current = true;
      try {
        if (durationMillisRef.current) {
          await soundRef.current.setPositionAsync(clamped * durationMillisRef.current);
        }
      } catch {
        // A superseded seek rejects with "Seeking interrupted" — safe to ignore.
      } finally {
        seekingRef.current = false;
        const pending = pendingSeekRef.current;
        pendingSeekRef.current = null;
        if (pending) {
          void seekEcho(pending.echo, pending.fraction);
        }
      }
    },
    [playEcho]
  );

  useEffect(() => {
    let mounted = true;

    async function loadLiveEchoes() {
      if (!userId) {
        setLoading(false);
        return;
      }

      const [{ data: echoData }, { data: profileData }] = await Promise.all([
        supabase
          .from('voice_notes')
          .select('id, user_id, username, audio_url, audio_path, caption, created_at, waveform')
          .eq('user_id', userId)
          .is('deleted_at', null)
          .is('archived_at', null)
          .gte('created_at', liveEchoCutoffIso())
          .order('created_at', { ascending: false }),
        supabase
          .from('profiles')
          .select('username, avatar_url')
          .eq('id', userId)
          .maybeSingle(),
      ]);

      if (!mounted) return;

      const profile = profileData as ProfileRow | null;
      const liveRows = ((echoData ?? []) as LiveEcho[])
        .filter((echo) => isEchoLive(echo.created_at))
        .map((echo) => ({
          ...echo,
          username: profile?.username ?? echo.username,
          avatarUrl: profile?.avatar_url ?? null,
        }));

      if (liveRows.length === 0) {
        router.back();
        return;
      }

      void prefetchAudioUrls(liveRows.map((echo) => echo.audio_path));
      setEchoes(liveRows);
      setLoading(false);
      void playEcho(liveRows[0]);
    }

    loadLiveEchoes();

    return () => {
      mounted = false;
      void stopPlayback();
    };
  }, [playEcho, stopPlayback, userId]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setEchoes((current) => {
      const liveRows = current.filter((echo) => isEchoLive(echo.created_at, now));

      if (current.length > 0 && liveRows.length === 0) {
        void stopPlayback();
        router.back();
      }

      if (playingIdRef.current && !liveRows.some((echo) => echo.id === playingIdRef.current)) {
        void stopPlayback();
      }

      return liveRows;
    });
  }, [now, stopPlayback]);

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    const echo = viewableItems[0]?.item as LiveEcho | undefined;
    if (!echo || playingIdRef.current === echo.id) return;
    void playEcho(echo);
  }).current;

  if (loading) {
    return (
      <View style={styles.centered}>
        <FrequencyLogoLoader size={58} label="Opening live Echoes..." />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <BackButton
        style={[styles.backButton, { top: insets.top + 10 }]}
        onPress={() => {
          void stopPlayback();
          router.back();
        }}
      />

      <FlatList
        data={echoes}
        keyExtractor={(item) => item.id}
        pagingEnabled
        snapToInterval={height}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={onViewableItemsChanged}
        renderItem={({ item }) => {
          const isLoaded = playingId === item.id;
          const isPlaying = isLoaded && isSoundPlaying;
          const username = cleanUsername(item.username);

          return (
            <View style={[styles.echoPage, { paddingTop: insets.top + 76 }]}>
              <View style={styles.creatorRow}>
                <Avatar
                  avatarUrl={item.avatarUrl}
                  initial={username}
                  size={50}
                  textSize={20}
                  borderColor="rgba(107,168,130,0.58)"
                />
                <View>
                  <Text style={styles.username}>@{username}</Text>
                  <Text style={styles.meta}>
                    {timeAgo(item.created_at)} · {formatRemainingLiveDuration(item.created_at)}
                  </Text>
                </View>
              </View>

              <View style={styles.echoCenter}>
                <View style={styles.livePill}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>Live Echo</Text>
                </View>
                <Text style={styles.echoTitle}>{item.caption?.trim() || 'Untitled Echo'}</Text>

                <Touchable
                  style={styles.playButton}
                  activeOpacity={0.86}
                  onPress={() => {
                    void togglePlayback(item);
                  }}
                >
                  <Ionicons name={isPlaying ? 'pause' : 'play'} size={31} color="#0B100D" />
                </Touchable>

                <View style={styles.waveformWrap}>
                  <FrequencyWaveform
                    active={isLoaded}
                    progress={isLoaded ? playbackProgress : 0}
                    waveform={item.waveform}
                    onSeek={(fraction) => {
                      void seekEcho(item, fraction);
                    }}
                  />
                </View>
              </View>
            </View>
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

  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.background,
  },

  // Floats over the full-bleed pager rather than sitting in a header row,
  // so it needs its own positioning; the control itself is the standard one.
  backButton: {
    position: 'absolute',
    left: 20,
    zIndex: 5,
  },

  echoPage: {
    height,
    paddingHorizontal: 28,
    paddingBottom: 96,
  },

  creatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },

  username: {
    color: C.text,
    fontSize: 17,
    fontWeight: '800',
  },

  meta: {
    color: C.muted,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 4,
  },

  echoCenter: {
    flex: 1,
    justifyContent: 'center',
    paddingBottom: 34,
  },

  livePill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: 'rgba(107,168,130,0.13)',
    borderWidth: 1,
    borderColor: 'rgba(107,168,130,0.28)',
    marginBottom: 28,
  },

  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: C.accent,
  },

  liveText: {
    color: C.accentSoft,
    fontSize: 13,
    fontWeight: '900',
  },

  echoTitle: {
    color: C.text,
    fontSize: 45,
    fontWeight: '900',
    lineHeight: 52,
    letterSpacing: -1.2,
    marginBottom: 44,
  },

  playButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.accent,
    marginBottom: 26,
  },

  waveformWrap: {
    overflow: 'hidden',
  },
});
