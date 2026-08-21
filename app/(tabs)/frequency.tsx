import { useCallback, useEffect, useRef, useState } from 'react';
import Constants from 'expo-constants';
import * as ImagePicker from 'expo-image-picker';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  View,
  Text,
  TextInput,
  StyleSheet,
} from 'react-native';
import Touchable from '@/components/Touchable';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { Audio, AVPlaybackStatus } from 'expo-av';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ProfileAvatarStage from '@/components/ProfileAvatarStage';
import { FrequencyLogo } from '@/components/branding/FrequencyLogo';
import {
  FrequencyColors as C,
  FrequencyRadius as R,
  FrequencySpacing as S,
} from '../../constants/frequencyTheme';
import { uploadProfileAvatar } from '../../lib/avatars';
import { supabase } from '../../lib/supabase';
import { useTuneIn } from '../../hooks/useTuneIn';
import { useWaveformScrub } from '../../hooks/useWaveformScrub';
import { resolveDisplayUsername } from '@/lib/profiles';
import { getFallbackWaveform } from '@/lib/waveform';
import { error as hapticError, success } from '@/lib/haptics';
import { setFeedSuggestionsEnabled } from '@/lib/preferences';
import { useTutorialProgress } from '@/lib/tutorial/useTutorialProgress';
import { deleteAccount } from '@/lib/account';
import {
  isEchoLive,
  liveEchoCutoffIso,
} from '@/lib/echoLifecycle';
import { loadLiveEchoMetrics } from '@/lib/loadEchoMetrics';
import { type EchoImpactMetrics } from '@/lib/echoMetrics';
import {
  archiveEcho,
  DELETE_UNDO_WINDOW_MS,
  finalizeDeletedEchoBestEffort,
  restoreEcho,
  softDeleteEcho,
} from '@/lib/echoActions';
import EchoActionToast from '@/components/EchoActionToast';
import EchoOptionsSheet from '@/components/EchoOptionsSheet';
import ConfirmSheet from '@/components/ConfirmSheet';

const BIO_MAX_LENGTH = 100;
const appVersion = Constants.expoConfig?.version ?? '1.0.0';

type Profile = {
  id: string;
  username: string;
  initial: string;
  bio: string;
  avatarUrl: string | null;
};

type ProfileEcho = {
  id: string;
  user_id?: string;
  audio_url?: string;
  caption: string | null;
  created_at: string;
  duration?: number | null;
  waveform?: number[] | null;
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

function LiveEchoWaveform({
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
    <View ref={containerRef} style={styles.waveformThumb} onLayout={onLayout} {...panHandlers}>
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

export default function FrequencyScreen() {
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState<Profile>({
    id: '',
    username: '@frequency',
    initial: 'F',
    bio: '',
    avatarUrl: null,
  });
  const [bioDraft, setBioDraft] = useState('');
  const [bioSheetOpen, setBioSheetOpen] = useState(false);
  const [savingBio, setSavingBio] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [echoes, setEchoes] = useState<ProfileEcho[]>([]);
  const [echoCount, setEchoCount] = useState(0);
  const [metricsByEchoId, setMetricsByEchoId] = useState<Record<string, EchoImpactMetrics>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [playingEchoId, setPlayingEchoId] = useState<string | null>(null);
  const [isSoundPlaying, setIsSoundPlaying] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [now, setNow] = useState(Date.now());
  const soundRef = useRef<Audio.Sound | null>(null);
  const playingEchoIdRef = useRef<string | null>(null);
  const seekingRef = useRef(false);
  const pendingSeekRef = useRef<{ echo: ProfileEcho; fraction: number } | null>(null);
  const durationMillisRef = useRef<number | null>(null);
  const [infoToastMessage, setInfoToastMessage] = useState<string | null>(null);
  const infoToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ echo: ProfileEcho; index: number } | null>(
    null
  );
  const [undoSecondsLeft, setUndoSecondsLeft] = useState(0);
  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [optionsEcho, setOptionsEcho] = useState<ProfileEcho | null>(null);
  const [deleteConfirmEcho, setDeleteConfirmEcho] = useState<ProfileEcho | null>(null);
  const [feedSuggestionsEnabled, setFeedSuggestionsEnabledState] = useState(true);
  const [deleteAccountSheetOpen, setDeleteAccountSheetOpen] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  const loadProfile = useCallback(async () => {
    const { data } = await supabase.auth.getUser();

    if (!data.user) {
      setEchoes([]);
      setEchoCount(0);
      return;
    }

    const { data: profileData } = await supabase
      .from('profiles')
      .select('username, bio, avatar_url, feed_suggestions_enabled')
      .eq('id', data.user.id)
      .maybeSingle();
    const username = resolveDisplayUsername({
      username: profileData?.username,
      displayName: data.user.user_metadata?.display_name,
      email: data.user.email,
    });
    const bio = String(profileData?.bio ?? '');

    setFeedSuggestionsEnabledState(profileData?.feed_suggestions_enabled ?? true);

    setProfile({
      id: data.user.id,
      username: `@${username}`,
      initial: username.charAt(0).toUpperCase(),
      bio,
      avatarUrl: profileData?.avatar_url ?? null,
    });
    setBioDraft(bio);

    // Every Echo ever posted, Archives included -- the stat is a lifetime
    // total, unlike the Live count it sits next to.
    const { count: totalEchoes } = await supabase
      .from('voice_notes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', data.user.id)
      .is('deleted_at', null);

    setEchoCount(totalEchoes ?? 0);

    const { data: echoData, error: echoError } = await supabase
      .from('voice_notes')
      .select('*')
      .eq('user_id', data.user.id)
      .is('deleted_at', null)
      .is('archived_at', null)
      .gte('created_at', liveEchoCutoffIso())
      .order('created_at', { ascending: false });

    if (echoError) {
      Alert.alert('Echoes Error', echoError.message);
      setEchoes([]);
      return;
    }

    const liveEchoes = ((echoData ?? []) as ProfileEcho[]).filter((echo) =>
      isEchoLive(echo.created_at)
    );

    setEchoes(liveEchoes);
    const metricEntries = await Promise.all(
      liveEchoes.map(async (echo) => [echo.id, await loadLiveEchoMetrics(echo)] as const)
    );
    setMetricsByEchoId(Object.fromEntries(metricEntries));
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [loadProfile])
  );

  const { tunedInCount, listeningCount } = useTuneIn(profile.id);
  const { resetAll: resetTutorials } = useTutorialProgress(profile.id || null);
  const displayBio = profile.bio.trim() || 'No bio yet.';
  const liveEchoes = echoes.filter((echo) => isEchoLive(echo.created_at, now));

  async function handleLogOut() {
    await stopEchoPlayback();
    await supabase.auth.signOut();
  }

  async function handleDeleteAccount() {
    setDeletingAccount(true);

    try {
      await stopEchoPlayback();
      await deleteAccount();
      setDeleteAccountSheetOpen(false);
    } catch (error: any) {
      void hapticError();
      Alert.alert('Could Not Delete Account', error.message);
    } finally {
      setDeletingAccount(false);
    }
  }

  async function handleShowTutorialsAgain() {
    await resetTutorials();
    void success();
    // showInfoToast rather than setInfoToastMessage: it owns the dismiss
    // timer, and setting the message directly leaves the toast up for good.
    showInfoToast('Tutorials will show again.');
  }

  async function handleToggleFeedSuggestions(nextValue: boolean) {
    setFeedSuggestionsEnabledState(nextValue);

    try {
      await setFeedSuggestionsEnabled(profile.id, nextValue);
    } catch (error: any) {
      setFeedSuggestionsEnabledState(!nextValue);
      void hapticError();
      Alert.alert('Settings Error', error.message);
    }
  }

  function openConnections(type: 'listening' | 'tuned-in') {
    if (!profile.id) return;

    router.push({
      pathname: '/frequency-connections',
      params: { userId: profile.id, type },
    });
  }

  function openBioSheet() {
    setBioDraft(profile.bio);
    setBioSheetOpen(true);
  }

  function closeBioSheet() {
    setBioSheetOpen(false);
  }

  async function chooseAvatarFromLibrary() {
    if (!profile.id || uploadingAvatar) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      void hapticError();
      Alert.alert('Photo Access Needed', 'Please allow photo access to update your profile picture.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.86,
    });

    if (result.canceled || !result.assets[0]?.uri) return;

    try {
      setUploadingAvatar(true);
      const avatarUrl = await uploadProfileAvatar(profile.id, result.assets[0].uri);
      const { error } = await supabase
        .from('profiles')
        .update({
          username: profile.username.replace(/^@/, ''),
          bio: profile.bio,
          avatar_url: avatarUrl,
        })
        .eq('id', profile.id);

      if (error) throw error;

      setProfile((current) => ({ ...current, avatarUrl }));
      void success();
    } catch (error: any) {
      void hapticError();
      Alert.alert('Avatar Error', error.message);
    } finally {
      setUploadingAvatar(false);
    }
  }

  function openAvatarOptions() {
    Alert.alert('Edit Profile Picture', 'Choose a photo for your Frequency.', [
      { text: 'Choose Photo', onPress: chooseAvatarFromLibrary },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function saveBio() {
    if (!profile.id || savingBio) return;

    const nextBio = bioDraft.slice(0, BIO_MAX_LENGTH).trim();
    setSavingBio(true);

    const { error } = await supabase
      .from('profiles')
      .update({
        username: profile.username.replace(/^@/, ''),
        bio: nextBio,
      })
      .eq('id', profile.id);

    setSavingBio(false);

    if (error) {
      void hapticError();
      Alert.alert('Bio Error', error.message);
      return;
    }

    await loadProfile();
    closeBioSheet();
    void success();
  }

  async function refreshFrequency() {
    setRefreshing(true);
    try {
      await loadProfile();
    } finally {
      setRefreshing(false);
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

  async function playEcho(echo: ProfileEcho, seekFraction?: number) {
    if (!echo.audio_url) return;

    try {
      await stopEchoPlayback();
      setPlayingEchoId(echo.id);
      playingEchoIdRef.current = echo.id;
      setPlaybackProgress(Math.max(0, Math.min(1, seekFraction ?? 0)));

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      const { sound, status: initialStatus } = await Audio.Sound.createAsync({
        uri: echo.audio_url,
      });
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

  async function toggleEchoPlayback(echo: ProfileEcho) {
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

  async function seekEcho(echo: ProfileEcho, fraction: number) {
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

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setEchoes((current) => current.filter((echo) => isEchoLive(echo.created_at, now)));
  }, [now]);

  useEffect(() => {
    return () => {
      void stopEchoPlayback();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (infoToastTimeoutRef.current) clearTimeout(infoToastTimeoutRef.current);
      if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
      if (undoIntervalRef.current) clearInterval(undoIntervalRef.current);
    };
  }, []);

  function insertEchoAt(list: ProfileEcho[], echo: ProfileEcho, index: number) {
    const next = [...list];
    next.splice(Math.max(0, Math.min(index, next.length)), 0, echo);
    return next;
  }

  function showInfoToast(message: string) {
    if (infoToastTimeoutRef.current) clearTimeout(infoToastTimeoutRef.current);
    setInfoToastMessage(message);
    infoToastTimeoutRef.current = setTimeout(() => setInfoToastMessage(null), 2400);
  }

  function clearUndoTimers() {
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    if (undoIntervalRef.current) clearInterval(undoIntervalRef.current);
    undoTimeoutRef.current = null;
    undoIntervalRef.current = null;
  }

  function openEchoOptions(echo: ProfileEcho) {
    setOptionsEcho(echo);
  }

  async function handleArchiveEcho(echo: ProfileEcho) {
    const index = echoes.findIndex((item) => item.id === echo.id);
    setEchoes((current) => current.filter((item) => item.id !== echo.id));

    try {
      await archiveEcho(echo.id);
      void success();
      showInfoToast('Moved to Archives.');
    } catch (err: any) {
      void hapticError();
      Alert.alert('Archive Error', err.message ?? 'Could not archive this Echo.');
      setEchoes((current) => insertEchoAt(current, echo, index));
    }
  }

  function confirmDeleteEcho(echo: ProfileEcho) {
    setDeleteConfirmEcho(echo);
  }

  async function handleDeleteEcho(echo: ProfileEcho) {
    clearUndoTimers();
    const index = echoes.findIndex((item) => item.id === echo.id);
    setEchoes((current) => current.filter((item) => item.id !== echo.id));

    try {
      await softDeleteEcho(echo.id);
    } catch (err: any) {
      void hapticError();
      Alert.alert('Delete Error', err.message ?? 'Could not delete this Echo.');
      setEchoes((current) => insertEchoAt(current, echo, index));
      return;
    }

    void success();
    setPendingDelete({ echo, index });
    setUndoSecondsLeft(Math.round(DELETE_UNDO_WINDOW_MS / 1000));

    undoIntervalRef.current = setInterval(() => {
      setUndoSecondsLeft((seconds) => Math.max(0, seconds - 1));
    }, 1000);

    undoTimeoutRef.current = setTimeout(() => {
      clearUndoTimers();
      setPendingDelete(null);
      void finalizeDeletedEchoBestEffort(echo.id);
    }, DELETE_UNDO_WINDOW_MS);
  }

  async function handleUndoDelete() {
    const pending = pendingDelete;
    if (!pending) return;

    clearUndoTimers();
    setPendingDelete(null);
    setEchoes((current) => insertEchoAt(current, pending.echo, pending.index));

    try {
      await restoreEcho(pending.echo.id);
      void success();
    } catch (err: any) {
      void hapticError();
      Alert.alert('Undo Error', err.message ?? 'Could not restore this Echo.');
      setEchoes((current) => current.filter((item) => item.id !== pending.echo.id));
    }
  }

  function renderMetric(icon: keyof typeof Ionicons.glyphMap, value: number) {
    return (
      <View style={styles.echoMetric}>
        <Ionicons name={icon} size={19} color={C.muted} />
        <Text style={styles.echoMetricNumber}>{value}</Text>
      </View>
    );
  }

  function renderLiveEchoCard(echo: ProfileEcho) {
    const metrics = metricsByEchoId[echo.id];
    const isLoaded = playingEchoId === echo.id;
    const isPlaying = isLoaded && isSoundPlaying;

    // The whole card is the long-press target, not just the title.
    // Holding it anywhere opens the Echo's options -- the caption was a
    // ~25px strip and nothing about it said it could be held, so the only
    // route to Archive was one most people would never find.
    //
    // The waveform is the one exception: useWaveformScrub claims the touch
    // on contact for scrubbing, so a press handler above it never sees a
    // finger resting on the bars. Same constraint the Whisper bubbles hit.
    return (
      <Pressable
        key={echo.id}
        style={styles.echoCard}
        onLongPress={() => openEchoOptions(echo)}
        delayLongPress={320}
      >
        <View style={styles.liveRow}>
          <View style={styles.livePill}>
            <View style={styles.liveDot} />
            <Text style={styles.livePillText}>Live now</Text>
          </View>
          <Text style={styles.remainingText}>{timeAgo(echo.created_at)}</Text>
        </View>

        <View style={styles.echoHeader}>
          <View style={styles.echoTitleBlock}>
            <Text style={styles.echoTitle} numberOfLines={2}>
              {echo.caption?.trim() || 'Untitled Echo'}
            </Text>
          </View>
        </View>

        <View style={styles.echoPlaybackRow}>
          <Touchable
            style={styles.echoPlayButton}
            activeOpacity={0.84}
            onPress={() => toggleEchoPlayback(echo)}
          >
            <Ionicons
              name={isPlaying ? 'pause' : 'play'}
              size={19}
              color="#0B100D"
            />
          </Touchable>

          <LiveEchoWaveform
            waveform={echo.waveform}
            isPlaying={isLoaded}
            progress={isLoaded ? playbackProgress : 0}
            onSeek={(fraction) => {
              void seekEcho(echo, fraction);
            }}
          />
        </View>

        {/*
          While an Echo is live its creator sees two things and no more:
          how many people pressed play, and how many hearts it has. Every
          other signal -- replays, completion, comments, Whisper shares,
          night listening -- belongs to the Impact, and the Impact is a
          reveal that arrives once the 24 hours are over. Watching those
          numbers move in real time is the scoreboard this product is not.
        */}
        {metrics && (
          <View style={styles.echoMetricsRow}>
            {renderMetric('play-outline', metrics.plays)}
            {renderMetric('heart-outline', metrics.hearts)}
          </View>
        )}
      </Pressable>
    );
  }

  function renderProfileLiveEchoes() {
    if (liveEchoes.length === 0) {
      return (
        <View style={styles.emptyEchoCard}>
          <FrequencyLogo size={54} opacity={0.14} style={styles.emptyLogo} />
          <Text style={styles.emptyText}>No Echoes live right now.</Text>
        </View>
      );
    }

    return <>{liveEchoes.map(renderLiveEchoCard)}</>;
  }

  return (
    <>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 8 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshFrequency}
            tintColor={C.accent}
          />
        }
      >
        <Text style={styles.title}>My Frequency</Text>
        <Text style={styles.subtitle}>Where your voice lives.</Text>

        <View style={styles.profileBlock}>
          <ProfileAvatarStage
            avatarUrl={profile.avatarUrl}
            initial={profile.initial}
            isLive={liveEchoes.length > 0}
            onPress={openAvatarOptions}
            disabled={uploadingAvatar}
            overlay={
              <View style={styles.avatarEditPill}>
                <Text style={styles.avatarEditText}>
                  {uploadingAvatar ? 'Uploading...' : 'Edit'}
                </Text>
              </View>
            }
          />

          <Text
            style={styles.username}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            {profile.username}
          </Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.statsCard}>
          <View style={styles.stat}>
            <Text style={styles.statNumber}>{echoCount}</Text>
            <Text style={styles.statLabel}>Echoes</Text>
          </View>

          <View style={styles.statDivider} />

          <Touchable
            style={styles.stat}
            activeOpacity={0.72}
            onPress={() => openConnections('listening')}
          >
            <Text style={styles.statNumber}>{listeningCount}</Text>
            <Text style={styles.statLabel}>Listening To</Text>
          </Touchable>

          <View style={styles.statDivider} />

          <Touchable
            style={styles.stat}
            activeOpacity={0.72}
            onPress={() => openConnections('tuned-in')}
          >
            <Text style={styles.statNumber}>{tunedInCount}</Text>
            <Text style={styles.statLabel}>Tuned In</Text>
          </Touchable>
        </View>

        <View style={styles.divider} />

        <Pressable
          style={styles.aboutSection}
          onPress={openBioSheet}
          hitSlop={8}
        >
          <Text style={styles.sectionTitle}>About</Text>
          <View style={styles.aboutRow}>
            <Text style={styles.aboutText}>{displayBio}</Text>
          </View>
        </Pressable>

        <View style={styles.divider} />

        <Touchable
          style={styles.archiveButton}
          activeOpacity={0.84}
          onPress={() => router.push('/archives')}
        >
          <View>
            <Text style={styles.archiveButtonText}>Archives</Text>
            <Text style={styles.archiveButtonSubtext}>Private history and final Echo Impact</Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color={C.accentSoft} />
        </Touchable>

        <View style={styles.divider} />

        <View style={styles.echoSection}>
          <Text style={styles.sectionTitle}>Live Echoes</Text>
          {renderProfileLiveEchoes()}
        </View>

        <View style={styles.settingsDivider} />

        <View style={styles.settingsSection}>
          <Text style={styles.sectionTitle}>Settings</Text>
          <View style={styles.settingsBrand}>
            <FrequencyLogo size={44} />
            <Text style={styles.settingsBrandName}>Frequency</Text>
            <Text style={styles.settingsVersion}>Version {appVersion}</Text>
          </View>

          <View style={styles.settingsToggleRow}>
            <View style={styles.settingsToggleText}>
              <Text style={styles.settingsToggleLabel}>Suggest people to Tune Into in my Feed</Text>
              <Text style={styles.settingsToggleSubtext}>An occasional suggestion, once per visit.</Text>
            </View>
            <Switch
              value={feedSuggestionsEnabled}
              onValueChange={handleToggleFeedSuggestions}
              trackColor={{ false: C.card, true: C.accent }}
              thumbColor="#FFFFFF"
              ios_backgroundColor={C.card}
            />
          </View>

          <Touchable
            style={styles.showTutorialsButton}
            activeOpacity={0.78}
            onPress={handleShowTutorialsAgain}
          >
            <Text style={styles.showTutorialsText}>Show tutorials again</Text>
          </Touchable>

          <Touchable
            style={styles.logOutButton}
            activeOpacity={0.78}
            onPress={handleLogOut}
          >
            <Text style={styles.logOutText}>Log Out</Text>
          </Touchable>

          <Touchable
            style={styles.deleteAccountButton}
            activeOpacity={0.78}
            onPress={() => setDeleteAccountSheetOpen(true)}
          >
            <Text style={styles.deleteAccountText}>Delete Account</Text>
          </Touchable>
        </View>
      </ScrollView>

      <EchoActionToast visible={!!infoToastMessage} message={infoToastMessage ?? ''} />

      <EchoActionToast
        visible={!!pendingDelete}
        message="Echo deleted."
        actionLabel="Undo"
        onAction={handleUndoDelete}
        countdownSeconds={undoSecondsLeft}
      />

      <EchoOptionsSheet
        visible={!!optionsEcho}
        title={optionsEcho?.caption?.trim() || 'Untitled Echo'}
        onArchive={() => {
          const echo = optionsEcho;
          setOptionsEcho(null);
          if (echo) handleArchiveEcho(echo);
        }}
        onDelete={() => {
          const echo = optionsEcho;
          setOptionsEcho(null);
          if (echo) confirmDeleteEcho(echo);
        }}
        onClose={() => setOptionsEcho(null)}
      />

      <ConfirmSheet
        visible={!!deleteConfirmEcho}
        title="Delete this Echo?"
        message="Its Ripples will be deleted too."
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          const echo = deleteConfirmEcho;
          setDeleteConfirmEcho(null);
          if (echo) handleDeleteEcho(echo);
        }}
        onClose={() => setDeleteConfirmEcho(null)}
      />

      <ConfirmSheet
        visible={deleteAccountSheetOpen}
        title="Delete your account?"
        message="This permanently deletes your profile, Echoes, Whispers, and Tune Ins. This can't be undone."
        confirmLabel={deletingAccount ? 'Deleting…' : 'Delete Account'}
        danger
        onConfirm={() => {
          if (deletingAccount) return;
          handleDeleteAccount();
        }}
        onClose={() => {
          if (deletingAccount) return;
          setDeleteAccountSheetOpen(false);
        }}
      />

      <Modal
        visible={bioSheetOpen}
        animationType="slide"
        transparent
        onRequestClose={closeBioSheet}
      >
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable style={styles.modalBackdrop} onPress={closeBioSheet} />
          <View style={styles.bioSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Edit About</Text>
            <TextInput
              style={styles.bioInput}
              value={bioDraft}
              onChangeText={(text) => setBioDraft(text.slice(0, BIO_MAX_LENGTH))}
              placeholder="Write a short bio..."
              placeholderTextColor={C.faint}
              multiline
              maxLength={BIO_MAX_LENGTH}
              textAlignVertical="top"
              autoFocus
            />
            <Text style={styles.counter}>{bioDraft.length} / {BIO_MAX_LENGTH}</Text>

            <Touchable
              style={[styles.saveButton, savingBio && styles.disabledButton]}
              activeOpacity={0.86}
              onPress={saveBio}
              disabled={savingBio}
            >
              <Text style={styles.saveButtonText}>{savingBio ? 'Saving...' : 'Save'}</Text>
            </Touchable>

            <Touchable
              style={styles.cancelButton}
              activeOpacity={0.78}
              onPress={closeBioSheet}
              disabled={savingBio}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Touchable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.background,
  },

  content: {
    paddingHorizontal: 26,
    paddingBottom: 120,
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
  },

  // No top margin: the portrait's bloom carries a wide transparent band
  // above the avatar, which is already the breathing room this needs.
  profileBlock: {
    alignItems: 'center',
  },

  avatarEditPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: R.lg,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.divider,
  },

  avatarEditText: {
    color: C.text,
    fontSize: 13,
    fontWeight: '800',
  },

  username: {
    color: C.text,
    fontSize: 33,
    fontWeight: '800',
    letterSpacing: -0.8,
    textAlign: 'center',
  },

  divider: {
    height: 1,
    backgroundColor: C.divider,
    marginVertical: 28,
  },

  sectionTitle: {
    color: C.text,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.4,
  },

  aboutSection: {
    gap: S.md,
  },

  aboutRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  aboutText: {
    flex: 1,
    color: C.text,
    fontSize: 16,
    fontWeight: '500',
    lineHeight: 24,
  },

  archiveButton: {
    minHeight: 76,
    borderRadius: R.lg,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.divider,
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: S.md,
  },

  archiveButtonText: {
    color: C.text,
    fontSize: 19,
    fontWeight: '800',
  },

  archiveButtonSubtext: {
    color: C.muted,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 5,
  },

  statsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: S.xl,
    borderRadius: R.xl,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.divider,
  },

  stat: {
    flex: 1,
    alignItems: 'center',
  },

  statDivider: {
    width: 1,
    height: 34,
    backgroundColor: C.divider,
  },

  statNumber: {
    color: C.text,
    fontSize: 27,
    fontWeight: '700',
    letterSpacing: -0.4,
  },

  // Sentence case, no tracking: uppercase letterspaced labels read as a
  // financial report, not as two people listening to each other.
  statLabel: {
    color: C.muted,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 6,
  },

  echoSection: {
    gap: S.md,
  },

  emptyEchoCard: {
    padding: S.lg,
    borderRadius: R.lg,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.divider,
  },

  emptyLogo: {
    marginBottom: S.md,
  },

  emptyText: {
    color: C.text,
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 25,
  },

  emptySubtext: {
    color: C.muted,
    fontSize: 16,
    lineHeight: 24,
    marginTop: 4,
  },

  echoCard: {
    padding: S.lg,
    borderRadius: R.lg,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.divider,
    gap: S.md,
  },

  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: S.md,
  },

  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: R.md,
    backgroundColor: 'rgba(107,168,130,0.13)',
    borderWidth: 1,
    borderColor: 'rgba(107,168,130,0.28)',
  },

  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: C.accent,
  },

  livePillText: {
    color: C.accentSoft,
    fontSize: 13,
    fontWeight: '800',
  },

  remainingText: {
    color: C.muted,
    fontSize: 13,
    fontWeight: '800',
  },

  echoHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: S.md,
  },

  echoTitleBlock: {
    flex: 1,
  },

  echoTitle: {
    color: C.text,
    fontSize: 19,
    fontWeight: '800',
    lineHeight: 25,
  },

  echoMenuButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.divider,
  },

  waveformThumb: {
    flex: 1,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    overflow: 'hidden',
  },

  echoPlaybackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
  },

  echoPlayButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.accent,
  },

  waveformBar: {
    width: 4,
    borderRadius: 4,
    backgroundColor: C.accent,
    opacity: 0.72,
  },

  echoMetricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.lg,
  },

  echoMetric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  echoMetricNumber: {
    color: C.muted,
    fontSize: 14,
    fontWeight: '600',
  },

  settingsDivider: {
    height: 1,
    backgroundColor: C.divider,
    marginTop: 48,
    marginBottom: 40,
  },

  settingsSection: {
    gap: S.lg,
  },

  settingsBrand: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingVertical: S.sm,
  },

  settingsBrandName: {
    color: C.text,
    fontSize: 17,
    fontWeight: '800',
  },

  settingsVersion: {
    color: C.faint,
    fontSize: 13,
    fontWeight: '700',
  },

  settingsToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: S.md,
  },

  settingsToggleText: {
    flex: 1,
  },

  settingsToggleLabel: {
    color: C.text,
    fontSize: 16,
    fontWeight: '700',
  },

  settingsToggleSubtext: {
    color: C.muted,
    fontSize: 13,
    marginTop: 4,
  },

  // Same weight as Log Out rather than a switch: this is a one-off action,
  // not a setting with an on and an off state.
  showTutorialsButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
  },

  showTutorialsText: {
    color: C.text,
    fontSize: 18,
    fontWeight: '600',
  },

  logOutButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
  },

  logOutText: {
    color: C.text,
    fontSize: 18,
    fontWeight: '600',
  },

  deleteAccountButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    marginTop: S.sm,
  },

  deleteAccountText: {
    color: C.danger,
    fontSize: 14,
    fontWeight: '600',
  },

  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },

  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },

  sheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 3,
    backgroundColor: 'rgba(226,237,232,0.26)',
    marginBottom: 22,
  },

  bioSheet: {
    marginHorizontal: 12,
    marginBottom: 14,
    paddingHorizontal: 28,
    paddingTop: 22,
    paddingBottom: 28,
    borderRadius: 32,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.06)',
    backgroundColor: C.surface,
  },

  sheetTitle: {
    color: C.text,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: S.lg,
  },

  bioInput: {
    minHeight: 118,
    borderRadius: R.lg,
    backgroundColor: C.card,
    color: C.text,
    fontSize: 17,
    lineHeight: 25,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 16,
  },

  counter: {
    alignSelf: 'flex-end',
    color: C.muted,
    fontSize: 13,
    fontWeight: '600',
    marginTop: S.sm,
    marginBottom: S.lg,
  },

  saveButton: {
    height: 54,
    borderRadius: R.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.accent,
  },

  disabledButton: {
    opacity: 0.5,
  },

  saveButtonText: {
    color: '#0B100D',
    fontSize: 16,
    fontWeight: '800',
  },

  cancelButton: {
    height: 52,
    borderRadius: R.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: S.sm,
  },

  cancelButtonText: {
    color: C.text,
    fontSize: 16,
    fontWeight: '700',
  },
});
