import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import BackButton from '@/components/BackButton';
import Touchable from '@/components/Touchable';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Audio, AVPlaybackStatus } from 'expo-av';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FrequencyLogo, FrequencyLogoLoader } from '@/components/branding/FrequencyLogo';
import {
  FrequencyColors as C,
  FrequencyRadius as R,
  FrequencySpacing as S,
} from '@/constants/frequencyTheme';
import { buildEchoImpactInsights, echoImpactStoryFromAIImpact, type AIEchoImpact, type EchoImpactInsight } from '@/lib/echoImpact';
import {
  EMPTY_ECHO_METRICS,
  metricsFromSnapshot,
  type EchoImpactMetrics,
} from '@/lib/echoMetrics';
import { loadLiveEchoMetrics } from '@/lib/loadEchoMetrics';
import GlassSheet from '@/components/GlassSheet';
import EchoImpactStory, { EchoImpactHeading } from '@/components/EchoImpactStory';
import { liveEchoCutoffIso } from '@/lib/echoLifecycle';
import { unarchiveEcho } from '@/lib/echoActions';
import { error as hapticError, success as hapticSuccess } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';
import { prefetchAudioUrls, withAudioUrl } from '@/lib/audioUrls';
import { getFallbackWaveform } from '@/lib/waveform';
import { useWaveformScrub } from '@/hooks/useWaveformScrub';

type ArchiveEcho = {
  id: string;
  user_id: string;
  audio_url?: string;
  audio_path?: string | null;
  caption: string | null;
  created_at: string;
  duration?: number | null;
  waveform?: number[] | null;
  archived_at: string | null;
};


function timeAgo(dateString: string) {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;

  return new Date(dateString).toLocaleDateString();
}

function waveformBars(waveform?: number[] | null) {
  const bars = waveform && waveform.length > 0 ? waveform : getFallbackWaveform();
  return bars.slice(0, 18);
}

function ArchiveWaveform({
  waveform,
  isPlaying,
  progress,
  onSeek,
}: {
  waveform?: number[] | null;
  isPlaying: boolean;
  progress: number;
  onSeek: (fraction: number) => void;
}) {
  const bars = waveformBars(waveform);
  const { containerRef, onLayout, panHandlers } = useWaveformScrub(onSeek);

  return (
    <View ref={containerRef} style={styles.waveform} onLayout={onLayout} {...panHandlers}>
      {bars.map((amplitude, index) => (
        <View
          key={index}
          style={[
            styles.waveformBar,
            {
              height: 8 + amplitude * 28,
              opacity: isPlaying && index / bars.length <= progress ? 1 : 0.44,
            },
          ]}
        />
      ))}
    </View>
  );
}

export default function ArchivesScreen() {
  const insets = useSafeAreaInsets();
  const [echoes, setEchoes] = useState<ArchiveEcho[]>([]);
  const [metricsByEchoId, setMetricsByEchoId] = useState<Record<string, EchoImpactMetrics>>({});
  const [impactByEchoId, setImpactByEchoId] = useState<Record<string, AIEchoImpact | null>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedEcho, setSelectedEcho] = useState<ArchiveEcho | null>(null);
  const [playingEchoId, setPlayingEchoId] = useState<string | null>(null);
  const [isSoundPlaying, setIsSoundPlaying] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const soundRef = useRef<Audio.Sound | null>(null);
  const playingEchoIdRef = useRef<string | null>(null);
  const seekingRef = useRef(false);
  const pendingSeekRef = useRef<{ echo: ArchiveEcho; fraction: number } | null>(null);
  const durationMillisRef = useRef<number | null>(null);

  // An archived Echo's numbers come from the impact frozen by the sweep,
  // never from a live recount -- that is the whole point of sealing, and
  // recomputing here is what used to let a "final" story keep drifting.
  //
  // The live recount below is only for the gap between an Echo finishing
  // and the next sweep sealing it. Once sealed, this function stops
  // touching the database for that Echo entirely.
  async function loadArchivedEchoMetrics(
    echo: ArchiveEcho,
    storedImpact: AIEchoImpact | null
  ): Promise<EchoImpactMetrics> {
    if (storedImpact) {
      return metricsFromSnapshot(storedImpact.metrics_snapshot) ?? EMPTY_ECHO_METRICS;
    }

    return loadLiveEchoMetrics(echo);
  }

  const loadArchives = useCallback(async () => {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();

    if (!userData.user) {
      setLoading(false);
      router.replace('/login');
      return;
    }

    const { data, error } = await supabase
      .from('voice_notes')
      .select('*')
      .eq('user_id', userData.user.id)
      .is('deleted_at', null)
      .or(`archived_at.not.is.null,created_at.lt.${liveEchoCutoffIso()}`)
      .order('created_at', { ascending: false });

    if (error) {
      void hapticError();
      Alert.alert('Archives Error', error.message);
      setEchoes([]);
      setLoading(false);
      return;
    }

    const archiveRows = (data ?? []) as ArchiveEcho[];
    void prefetchAudioUrls(archiveRows.map((echo) => echo.audio_path));
    setEchoes(archiveRows);

    // Impacts first: a sealed one supplies the metrics, so there is
    // nothing left to query for those Echoes.
    const impactRows = archiveRows.length > 0
      ? await supabase
          .from('echo_impacts')
          .select('*')
          .eq('user_id', userData.user.id)
          .in('voice_note_id', archiveRows.map((echo) => echo.id))
      : { data: [] };

    const nextImpacts: Record<string, AIEchoImpact | null> = {};
    ((impactRows.data ?? []) as AIEchoImpact[]).forEach((impact) => {
      nextImpacts[impact.voice_note_id] = impact;
    });

    const metricEntries = await Promise.all(
      archiveRows.map(
        async (echo) =>
          [echo.id, await loadArchivedEchoMetrics(echo, nextImpacts[echo.id] ?? null)] as const
      )
    );

    setMetricsByEchoId(Object.fromEntries(metricEntries));
    setImpactByEchoId(nextImpacts);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadArchives();
    }, [loadArchives])
  );

  useEffect(() => {
    return () => {
      void stopEchoPlayback();
    };
  }, []);

  async function refreshArchives() {
    setRefreshing(true);
    try {
      await loadArchives();
    } finally {
      setRefreshing(false);
    }
  }

  async function handleUnarchive(echo: ArchiveEcho) {
    setEchoes((current) => current.filter((item) => item.id !== echo.id));

    try {
      await unarchiveEcho(echo.id);
      void hapticSuccess();
    } catch (err: any) {
      void hapticError();
      Alert.alert('Unarchive Error', err.message ?? 'Could not unarchive this Echo.');
      setEchoes((current) => [...current, echo]);
    }
  }

  async function stopEchoPlayback() {
    try {
      if (soundRef.current) {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
    } finally {
      playingEchoIdRef.current = null;
      durationMillisRef.current = null;
      setPlayingEchoId(null);
      setIsSoundPlaying(false);
      setPlaybackProgress(0);
    }
  }

  async function playEcho(echo: ArchiveEcho, seekFraction?: number) {
    if (!echo.audio_url) return;

    try {
      await stopEchoPlayback();
      setPlayingEchoId(echo.id);
      playingEchoIdRef.current = echo.id;
      setPlaybackProgress(Math.max(0, Math.min(1, seekFraction ?? 0)));
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const created = await withAudioUrl(echo.audio_path, (uri) =>
        Audio.Sound.createAsync({ uri })
      );
      if (!created) {
        setPlayingEchoId(null);
        playingEchoIdRef.current = null;
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
        if (status.durationMillis && playingEchoIdRef.current === echo.id && !seekingRef.current) {
          setPlaybackProgress(status.positionMillis / status.durationMillis);
        }
        if (status.didJustFinish) {
          playingEchoIdRef.current = null;
          durationMillisRef.current = null;
          setPlayingEchoId(null);
          setIsSoundPlaying(false);
          setPlaybackProgress(0);
        }
      });
    } catch (error: any) {
      void hapticError();
      Alert.alert('Playback Error', error.message);
      await stopEchoPlayback();
    }
  }

  async function toggleEchoPlayback(echo: ArchiveEcho) {
    if (playingEchoIdRef.current === echo.id && soundRef.current) {
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
  }

  async function seekEcho(echo: ArchiveEcho, fraction: number) {
    const clamped = Math.max(0, Math.min(1, fraction));

    if (playingEchoIdRef.current !== echo.id || !soundRef.current) {
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
  }

  function renderMetric(icon: keyof typeof Ionicons.glyphMap, value: number) {
    return (
      <View style={styles.metric}>
        <Ionicons name={icon} size={19} color={C.muted} />
        <Text style={styles.metricNumber}>{value}</Text>
      </View>
    );
  }

  function impactInsightsForEcho(echo: ArchiveEcho): EchoImpactInsight[] {
    const savedImpact = impactByEchoId[echo.id];
    if (savedImpact) return echoImpactStoryFromAIImpact(savedImpact).insights;
    const metrics = metricsByEchoId[echo.id];
    return metrics ? buildEchoImpactInsights(metrics).insights : [];
  }

  if (loading && !refreshing) {
    return (
      <View style={styles.centered}>
        <FrequencyLogoLoader size={58} label="Opening Archives..." />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: Math.max(insets.top + 24, 58), paddingBottom: insets.bottom + 72 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshArchives}
            tintColor={C.accent}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <BackButton style={styles.backButton} />

        <Text style={styles.title}>Archives</Text>
        <Text style={styles.subtitle}>Your private Echo history.</Text>

        {echoes.length === 0 ? (
          <View style={styles.emptyCard}>
            <FrequencyLogo size={58} opacity={0.14} style={styles.emptyLogo} />
            <Text style={styles.emptyTitle}>No archived Echoes yet.</Text>
            <Text style={styles.emptyText}>Echoes appear here after their live window ends.</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {echoes.map((echo) => {
              const metrics = metricsByEchoId[echo.id];
              const isLoaded = playingEchoId === echo.id;
              const isPlaying = isLoaded && isSoundPlaying;

              return (
                <View key={echo.id} style={styles.archiveCard}>
                  <View style={styles.archiveTop}>
                    <View style={styles.archivePill}>
                      <View style={styles.archiveDot} />
                      <Text style={styles.archivePillText}>Archived</Text>
                    </View>
                    <Text style={styles.remainingText}>{timeAgo(echo.created_at)}</Text>
                  </View>

                  <Text style={styles.echoTitle} numberOfLines={2}>
                    {echo.caption?.trim() || 'Untitled Echo'}
                  </Text>

                  <View style={styles.playbackRow}>
                    <Touchable
                      style={styles.playButton}
                      activeOpacity={0.84}
                      onPress={() => toggleEchoPlayback(echo)}
                    >
                      <Ionicons name={isPlaying ? 'pause' : 'play'} size={19} color="#0B100D" />
                    </Touchable>
                    <ArchiveWaveform
                      waveform={echo.waveform}
                      isPlaying={isLoaded}
                      progress={isLoaded ? playbackProgress : 0}
                      onSeek={(fraction) => {
                        void seekEcho(echo, fraction);
                      }}
                    />
                  </View>

                  {metrics ? (
                    <View style={styles.metricsRow}>
                      {renderMetric('play-outline', metrics.plays)}
                      {renderMetric('heart-outline', metrics.hearts)}
                      {renderMetric('chatbubble-outline', metrics.comments)}
                      {renderMetric('paper-plane-outline', metrics.shares)}
                    </View>
                  ) : (
                    <Text style={styles.echoMeta}>Final Echo Impact is still warming up.</Text>
                  )}

                  <View style={styles.cardFooterRow}>
                    <Touchable
                      style={styles.impactButton}
                      activeOpacity={0.7}
                      onPress={() => setSelectedEcho(echo)}
                    >
                      <Text style={styles.impactButtonText}>See the final impact</Text>
                      <Ionicons name="chevron-forward" size={15} color={C.accentSoft} />
                    </Touchable>

                    {echo.archived_at && (
                      <Touchable
                        style={styles.unarchiveButton}
                        activeOpacity={0.8}
                        onPress={() => handleUnarchive(echo)}
                      >
                        <Text style={styles.unarchiveButtonText}>Unarchive</Text>
                      </Touchable>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <GlassSheet visible={!!selectedEcho} onClose={() => setSelectedEcho(null)}>
        <View style={styles.sheetHeader}>
          <View style={styles.sheetHeaderCopy}>
            <EchoImpactHeading
              eyebrow="Final Echo Impact"
              theme={selectedEcho?.caption?.trim() || 'Untitled Echo'}
            />
          </View>
          <Touchable
            style={styles.closeButton}
            activeOpacity={0.8}
            onPress={() => setSelectedEcho(null)}
          >
            <Ionicons name="close" size={20} color={C.text} />
          </Touchable>
        </View>

        <ScrollView style={styles.impactScroll} showsVerticalScrollIndicator={false} bounces>
          {selectedEcho && <EchoImpactStory insights={impactInsightsForEcho(selectedEcho)} />}
        </ScrollView>
      </GlassSheet>

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

  content: {
    paddingHorizontal: 28,
  },

  backButton: {
    marginBottom: 26,
  },

  title: {
    color: C.text,
    fontSize: 44,
    fontWeight: '800',
    letterSpacing: -1.2,
  },

  subtitle: {
    color: C.muted,
    fontSize: 18,
    marginTop: 8,
    marginBottom: S.xl,
  },

  emptyCard: {
    padding: S.lg,
    borderRadius: R.lg,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.divider,
  },

  emptyLogo: {
    marginBottom: S.md,
  },

  emptyTitle: {
    color: C.text,
    fontSize: 19,
    fontWeight: '800',
  },

  emptyText: {
    color: C.muted,
    fontSize: 16,
    lineHeight: 24,
    marginTop: 6,
  },

  list: {
    gap: S.md,
  },

  archiveCard: {
    padding: S.lg,
    borderRadius: R.lg,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.divider,
    gap: S.md,
  },

  archiveTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: S.md,
  },

  echoTitle: {
    color: C.text,
    fontSize: 19,
    fontWeight: '800',
    lineHeight: 25,
  },

  remainingText: {
    color: C.muted,
    fontSize: 13,
    fontWeight: '800',
  },

  echoMeta: {
    color: C.muted,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 8,
  },

  // Deliberately the same shape and rhythm as the profile's "Live now" pill,
  // but on the neutral surface rather than the accent tint — an archived Echo
  // should sit in the same slot without borrowing the live state's colour.
  archivePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: R.md,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.divider,
  },

  archiveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: C.faint,
  },

  archivePillText: {
    color: C.muted,
    fontSize: 13,
    fontWeight: '800',
  },

  playbackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
  },

  playButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.accent,
  },

  waveform: {
    flex: 1,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    overflow: 'hidden',
  },

  waveformBar: {
    width: 4,
    borderRadius: 4,
    backgroundColor: C.accent,
    opacity: 0.72,
  },

  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.lg,
  },

  metric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  metricNumber: {
    color: C.muted,
    fontSize: 14,
    fontWeight: '600',
  },

  impactButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
  },

  impactButtonText: {
    color: C.accentSoft,
    fontSize: 14,
    fontWeight: '700',
  },

  cardFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: S.md,
  },

  unarchiveButton: {
    alignSelf: 'flex-end',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },

  unarchiveButtonText: {
    color: C.text,
    fontSize: 14,
    fontWeight: '700',
  },

  impactScroll: {
    flexShrink: 1,
  },

  sheetHeaderCopy: {
    paddingRight: 46,
  },

  sheetHeader: {
    position: 'relative',
    marginBottom: S.lg,
  },

  closeButton: {
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 2,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.divider,
  },
});
