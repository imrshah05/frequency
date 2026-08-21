import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Touchable from '@/components/Touchable';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Audio, AVPlaybackStatus } from 'expo-av';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FrequencyLogo, FrequencyLogoLoader } from '@/components/branding/FrequencyLogo';
import FrequencyWaveform from '@/components/FrequencyWaveform';
import ResonanceHalo from '@/components/ResonanceHalo';
import ResonanceOrb from '@/components/ResonanceOrb';
import { useIsFocused } from '@react-navigation/native';
import SpotlightOverlay, { SHEET_HANDOFF_MS } from '@/components/tutorial/SpotlightOverlay';
import TutorialIntroCard from '@/components/tutorial/TutorialIntroCard';
import TutorialTarget from '@/components/tutorial/TutorialTarget';
import { useTutorialMoment } from '@/lib/tutorial/useTutorialMoment';
import {
  FrequencyColors as C,
  FrequencyRadius as R,
  FrequencySpacing as S,
} from '@/constants/frequencyTheme';
import { emotionColor, emotionLabel, sortBlend } from '@/constants/resonanceEmotions';
import {
  fetchAllResonances,
  formatResonanceDate,
  getLocalDateString,
  getResonanceAudioUrl,
  resolveEntryBlend,
  type ResonanceEntry,
} from '@/lib/resonance';
import { computeResonanceCluster } from '@/lib/resonanceLayout';
import { buildResonanceCalendarMonth, type ResonanceCalendarWeek } from '@/lib/resonanceCalendar';
import { error as hapticError, selection, success } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';

const RECORD_RESONANCE_TARGET = 'resonance_record_today';

const RESONANCE_FIELD_STEPS = [
  {
    targetId: RECORD_RESONANCE_TARGET,
    title: 'One a day.',
    body: 'Record how today feels, and it joins the field as its own orb.',
  },
];

const CONTENT_HORIZONTAL_PADDING = 28;
const ENTRANCE_DURATION_MS = 900;
const ENTRANCE_STAGGER_SPREAD = 0.6; // fraction of the timeline used to spread orb start times
const ENTRANCE_ITEM_SPAN = 0.4; // fraction of the timeline each orb takes to settle
const CALENDAR_GRID_GAP = 8;
const CALENDAR_NUMBER_ROW_HEIGHT = 16;
const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']; // Sunday-start, matches the grid

// The Random Throwback "search": wavefronts roll across the field from a
// random edge, each orb lighting up as the front reaches it. An orb's timing
// is a function of its distance from the wave origin rather than per-orb
// noise, so the whole field reads as one deliberate sweep instead of jitter —
// and because the origin is re-rolled on every press, no two searches look
// alike. The second pass runs back the other way.
const SWEEP_DURATION_MS = 1150;
const SWEEP_PASSES = 2;
const SWEEP_WINDOW = 0.32; // fraction of one pass a single orb stays lit
const SWEEP_CENTER_INSET = 0.18; // keeps every orb's window inside its own pass
const SWEEP_DRIFT_FACTOR = 0.42; // orb-size multiplier for the nudge the front gives
const SWEEP_PEAK_SCALE = 1.24;
// The field settles back while the search runs and each orb returns to full
// brightness only as the front reaches it — a light moving across the
// cluster, rather than every orb flashing on its own.
const SWEEP_BASE_OPACITY = 0.46;
const SWEEP_TILT_DEGREES = 1.5; // whole-field tilt, so the cluster leans with the wave

// The winner then leaves the field: it gathers, travels to the centre, grows
// past everything else and blooms a halo while the rest recede.
const REVEAL_ANTICIPATION = 0.16; // progress spent contracting before it surges forward
const REVEAL_ANTICIPATION_MS = 190;
const REVEAL_DURATION_MS = 620;
const REVEAL_TARGET_SIZE = 124; // px the winner grows to, whatever its cluster size
const REVEAL_DIM_OPACITY = 0.06;
const REVEAL_HALO_SIZE = REVEAL_TARGET_SIZE * 2.2;
const HANDOFF_HOLD_MS = 150; // beat of recognition before the sheet takes over
const HANDOFF_FADE_MS = 260;
const RESTORE_DURATION_MS = 320;

const SHEET_ORB_SIZE = 96; // the orb's size at rest
const SHEET_ORB_DURATION_MS = 560;
// Drawn at the size it *enters* at — which is exactly the size the field orb
// grew to, so the hand-off reads as one continuous object — and scaled down
// to rest. Rendering at 96 and scaling up would stretch the rasterised SVG.
const SHEET_ORB_RENDER_SIZE = REVEAL_TARGET_SIZE;
const SHEET_ORB_REST_SCALE = SHEET_ORB_SIZE / SHEET_ORB_RENDER_SIZE;
// Sized off the *entry* size, not the resting size: ResonanceOrb throws a
// glow of size * 0.4 beyond its own edge, so at the moment the orb arrives it
// reaches size * 0.9 from centre. The stage (and the halo filling it) has to
// contain that, or the sheet's scroll view clips the glow into a flat edge.
const SHEET_ORB_STAGE = SHEET_ORB_RENDER_SIZE * 1.9;
// The stage is sized for the glow, but spacing should follow the orb you
// actually see at rest — so the content below reclaims the extra room the
// glow needed underneath. Above the orb that room is kept, as clearance.
const SHEET_CONTENT_LIFT = (SHEET_ORB_SIZE * 1.9 - SHEET_ORB_STAGE) / 2;
const SHEET_CONTENT_DELAY_MS = 150;
const SHEET_CONTENT_DURATION_MS = 420;
const THROWBACK_MESSAGE_MS = 2600;
const THROWBACK_MIN_ELIGIBLE = 2;

function entranceRange(index: number, total: number) {
  const start = total <= 1 ? 0 : (index / (total - 1)) * ENTRANCE_STAGGER_SPREAD;
  const end = Math.min(1, start + ENTRANCE_ITEM_SPAN);
  return [start, end] as const;
}

type SweepVector = {
  phase: number; // 0 = nearest the wave origin, 1 = furthest from it
  driftX: number;
  driftY: number;
};

// One orb's response to the whole sweep, as a single interpolation: a 0→1→0
// pulse inside each pass, positioned by the orb's distance from the origin.
// Each pass owns its own slice of the timeline and every window is inset
// within its slice, so the stops are always strictly increasing.
function buildSweepPulse(phase: number) {
  const passSpan = 1 / SWEEP_PASSES;
  const half = (SWEEP_WINDOW / 2) * passSpan;
  const input: number[] = [-1];
  const output: number[] = [0];

  for (let pass = 0; pass < SWEEP_PASSES; pass++) {
    // Odd passes run the wave back the other way across the field.
    const localPhase = pass % 2 === 0 ? phase : 1 - phase;
    const center =
      pass * passSpan + (SWEEP_CENTER_INSET + localPhase * (1 - SWEEP_CENTER_INSET * 2)) * passSpan;

    input.push(center - half, center, center + half);
    output.push(0, 1, 0);
  }

  input.push(2);
  output.push(0);
  return { inputRange: input, outputRange: output };
}

function formatTime(totalSeconds: number) {
  const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : 0;
  const mins = Math.floor(safeSeconds / 60);
  const secs = Math.floor(safeSeconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export default function ResonanceFieldScreen() {
  const insets = useSafeAreaInsets();
  const windowWidth = useWindowDimensions().width;
  const [entries, setEntries] = useState<ResonanceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activePage, setActivePage] = useState(0);
  const [viewedMonth, setViewedMonth] = useState(() => {
    const today = new Date();
    return { year: today.getFullYear(), month: today.getMonth() };
  });
  const [selectedEntry, setSelectedEntry] = useState<ResonanceEntry | null>(null);
  const [playbackLoading, setPlaybackLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionSeconds, setPositionSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [jostling, setJostling] = useState(false);
  const [revealedPointId, setRevealedPointId] = useState<string | null>(null);
  const [throwbackMessage, setThrowbackMessage] = useState<string | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const seekingRef = useRef(false);
  const pendingSeekFractionRef = useRef<number | null>(null);
  const entranceProgress = useRef(new Animated.Value(0)).current;
  const sweepProgress = useRef(new Animated.Value(0)).current;
  const revealProgress = useRef(new Animated.Value(0)).current;
  // Fades the enlarged winner out under the arriving sheet — kept separate
  // from revealProgress so the orb can stay grown while it disappears.
  const handoffProgress = useRef(new Animated.Value(0)).current;
  const sheetOrbProgress = useRef(new Animated.Value(0)).current;
  const sheetContentProgress = useRef(new Animated.Value(0)).current;
  const sweepVectorsRef = useRef<Map<string, SweepVector>>(new Map());
  // Mirrors revealedPointId: the throwback's own animation callbacks close
  // over the render that started the sequence, where the state is still null.
  const revealedPointIdRef = useRef<string | null>(null);
  const throwbackMessageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const entriesById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  const entriesByDate = useMemo(
    () => new Map(entries.map((entry) => [entry.entry_date, entry])),
    [entries]
  );
  const availableWidth = windowWidth - CONTENT_HORIZONTAL_PADDING * 2;
  const cluster = useMemo(
    () => computeResonanceCluster(entries.map((entry) => entry.id), availableWidth),
    [entries, availableWidth]
  );

  const calendarWeeks: ResonanceCalendarWeek[] = useMemo(
    () => buildResonanceCalendarMonth(viewedMonth.year, viewedMonth.month),
    [viewedMonth]
  );

  const todayLogged = useMemo(
    () => entries.some((entry) => entry.entry_date === getLocalDateString()),
    [entries]
  );

  const showRecordPill = !loading && !todayLogged;

  // Waits for the load, so the copy can say whether there is a calendar to
  // swipe to and the spotlight knows whether its button exists.
  const isFieldFocused = useIsFocused();
  const { active: tutorialActive, finish: finishTutorial } = useTutorialMoment('resonance_field', {
    enabled: isFieldFocused && !loading,
  });
  const [tutorialIntroDone, setTutorialIntroDone] = useState(false);

  function dismissTutorialIntro() {
    // Nothing to spotlight if today is already recorded -- the card was the
    // whole moment, so it ends here rather than waiting on a button that
    // will not appear.
    if (!showRecordPill) {
      finishTutorial();
      return;
    }

    // Let the card finish sliding out before the spotlight's own modal
    // opens behind it.
    setTimeout(() => setTutorialIntroDone(true), SHEET_HANDOFF_MS);
  }

  const calendarCellSize = (availableWidth - CALENDAR_GRID_GAP * 6) / 7;
  const calendarOrbSize = calendarCellSize * 0.68;
  const calendarCellHeight = calendarCellSize + CALENDAR_NUMBER_ROW_HEIGHT;

  const monthLabelText = new Date(viewedMonth.year, viewedMonth.month, 1).toLocaleDateString(
    undefined,
    { month: 'long', year: 'numeric' }
  );

  // Orbs settle into place each time the cluster loads (or reloads) —
  // one shared driver value, staggered per-orb via entranceRange(), rather
  // than a separate Animated.Value per orb.
  useEffect(() => {
    if (cluster.points.length === 0) return;

    entranceProgress.setValue(0);
    Animated.timing(entranceProgress, {
      toValue: 1,
      duration: ENTRANCE_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [entries, entranceProgress]);

  const selectedEntryId = selectedEntry?.id ?? null;

  // The orb opens up into the sheet rather than just appearing: it arrives
  // over-sized (matching the size a throwback winner grew to in the field),
  // settles down while its halo blooms out behind it, and only then does the
  // rest of the entry unfold underneath.
  useEffect(() => {
    if (!selectedEntryId) return;

    sheetOrbProgress.setValue(0);
    sheetContentProgress.setValue(0);

    Animated.parallel([
      Animated.timing(sheetOrbProgress, {
        toValue: 1,
        duration: SHEET_ORB_DURATION_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(sheetContentProgress, {
        toValue: 1,
        delay: SHEET_CONTENT_DELAY_MS,
        duration: SHEET_CONTENT_DURATION_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [selectedEntryId, sheetOrbProgress, sheetContentProgress]);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();

    if (!userData.user) {
      setLoading(false);
      router.replace('/login');
      return;
    }

    const rows = await fetchAllResonances(userData.user.id);
    setEntries(rows);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadEntries();
    }, [loadEntries])
  );

  useEffect(() => {
    return () => {
      void unloadSound();
      if (throwbackMessageTimeoutRef.current) clearTimeout(throwbackMessageTimeoutRef.current);
    };
  }, []);

  async function unloadSound() {
    if (soundRef.current) {
      try {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
      } catch {
        // Playback cleanup should never surface an error to the user.
      }
      soundRef.current = null;
    }
  }

  async function refreshEntries() {
    setRefreshing(true);
    try {
      await loadEntries();
    } finally {
      setRefreshing(false);
    }
  }

  async function openEntry(entry: ResonanceEntry) {
    setSelectedEntry(entry);
    setPlaybackLoading(true);
    setIsPlaying(false);
    setPositionSeconds(0);
    setDurationSeconds(0);

    const signedUrl = await getResonanceAudioUrl(entry.audio_path);

    if (!signedUrl) {
      setPlaybackLoading(false);
      void hapticError();
      Alert.alert('Playback Error', 'Could not load this recording.');
      restoreField();
      setSelectedEntry(null);
      return;
    }

    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync({ uri: signedUrl });
      soundRef.current = sound;
      await sound.setProgressUpdateIntervalAsync(100);

      sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
        if (!status.isLoaded) return;

        if (!seekingRef.current) {
          setPositionSeconds(status.positionMillis / 1000);
        }
        if (status.durationMillis) setDurationSeconds(status.durationMillis / 1000);

        if (status.didJustFinish) {
          setIsPlaying(false);
          setPositionSeconds(0);
        }
      });

      await sound.playAsync();
      setIsPlaying(true);
      setPlaybackLoading(false);
    } catch (error: any) {
      setPlaybackLoading(false);
      void hapticError();
      Alert.alert('Playback Error', error.message);
      restoreField();
      setSelectedEntry(null);
    }
  }

  async function togglePlayback() {
    const sound = soundRef.current;
    if (!sound) return;

    if (isPlaying) {
      await sound.pauseAsync();
      setIsPlaying(false);
    } else {
      await sound.playAsync();
      setIsPlaying(true);
    }
  }

  async function seekEntry(fraction: number) {
    const sound = soundRef.current;
    if (!sound || durationSeconds <= 0) return;

    const clamped = Math.max(0, Math.min(1, fraction));
    setPositionSeconds(clamped * durationSeconds);

    if (seekingRef.current) {
      pendingSeekFractionRef.current = clamped;
      return;
    }

    seekingRef.current = true;
    try {
      await sound.setPositionAsync(clamped * durationSeconds * 1000);
    } catch {
      // A superseded seek rejects with "Seeking interrupted" — safe to ignore.
    } finally {
      seekingRef.current = false;
      const pending = pendingSeekFractionRef.current;
      pendingSeekFractionRef.current = null;
      if (pending != null) {
        void seekEntry(pending);
      }
    }
  }

  async function closeEntry() {
    await unloadSound();
    seekingRef.current = false;
    pendingSeekFractionRef.current = null;
    restoreField();
    setSelectedEntry(null);
    setIsPlaying(false);
    setPlaybackLoading(false);
    setPositionSeconds(0);
    setDurationSeconds(0);
  }

  // The field stays in its revealed state (winner gone, everyone else dimmed)
  // for as long as the sheet is up, then re-forms as the sheet leaves —
  // rather than snapping back the instant the sheet opens.
  function restoreField() {
    if (!revealedPointIdRef.current) return;
    revealedPointIdRef.current = null;

    Animated.parallel([
      Animated.timing(revealProgress, {
        toValue: 0,
        duration: RESTORE_DURATION_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(handoffProgress, {
        toValue: 0,
        duration: RESTORE_DURATION_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => {
      setRevealedPointId(null);
      setJostling(false);
      sweepProgress.setValue(0);
    });
  }

  function startRandomThrowback() {
    if (jostling) return;

    const todayKey = getLocalDateString();
    const eligible = entries.filter((entry) => entry.entry_date !== todayKey);

    if (eligible.length < THROWBACK_MIN_ELIGIBLE) {
      void hapticError();
      setThrowbackMessage("Keep going — throwbacks unlock once you've got a few entries.");

      if (throwbackMessageTimeoutRef.current) clearTimeout(throwbackMessageTimeoutRef.current);
      throwbackMessageTimeoutRef.current = setTimeout(() => setThrowbackMessage(null), THROWBACK_MESSAGE_MS);
      return;
    }

    void selection();
    setThrowbackMessage(null);

    // The wave enters from a random point outside the cluster, so the sweep
    // crosses the field from a different direction on every press. Each orb's
    // place in the wave is just its distance from that origin.
    const originAngle = Math.random() * Math.PI * 2;
    const originRadius = Math.max(cluster.canvasSize * 0.62, 120);
    const originX = Math.cos(originAngle) * originRadius;
    const originY = Math.sin(originAngle) * originRadius;

    const distances = cluster.points.map((point) => ({
      point,
      dx: point.x - originX,
      dy: point.y - originY,
      distance: Math.hypot(point.x - originX, point.y - originY),
    }));

    const nearest = Math.min(...distances.map((item) => item.distance));
    const furthest = Math.max(...distances.map((item) => item.distance));
    const spread = Math.max(1, furthest - nearest);

    const vectors = new Map<string, SweepVector>();
    distances.forEach(({ point, dx, dy, distance }) => {
      // The nudge points the way the wave is travelling at that orb, so the
      // field is pushed along by the front rather than scattering.
      const length = Math.max(1, Math.hypot(dx, dy));
      const magnitude = point.size * SWEEP_DRIFT_FACTOR;

      vectors.set(point.id, {
        phase: (distance - nearest) / spread,
        driftX: (dx / length) * magnitude,
        driftY: (dy / length) * magnitude,
      });
    });
    sweepVectorsRef.current = vectors;

    setJostling(true);
    sweepProgress.setValue(0);

    // Linear: a wavefront that eases would visibly slow down mid-field.
    Animated.timing(sweepProgress, {
      toValue: 1,
      duration: SWEEP_DURATION_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;

      const winner = eligible[Math.floor(Math.random() * eligible.length)];

      void success();
      revealedPointIdRef.current = winner.id;
      setRevealedPointId(winner.id);
      revealProgress.setValue(0);
      handoffProgress.setValue(0);

      Animated.sequence([
        // A short gather before the surge — the orb draws in on itself, which
        // is what makes the move forward read as physical rather than a zoom.
        Animated.timing(revealProgress, {
          toValue: REVEAL_ANTICIPATION,
          duration: REVEAL_ANTICIPATION_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(revealProgress, {
          toValue: 1,
          duration: REVEAL_DURATION_MS,
          easing: Easing.bezier(0.16, 0.84, 0.24, 1),
          useNativeDriver: true,
        }),
        // A beat at full size before the sheet takes over. Held on the same
        // native value rather than Animated.delay, which runs on the JS
        // thread and would stall exactly when the app is busiest.
        Animated.timing(revealProgress, {
          toValue: 1,
          duration: HANDOFF_HOLD_MS,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]).start(({ finished: revealFinished }) => {
        if (!revealFinished) return;

        // The sheet takes over while the field orb dissolves under it, so the
        // two never read as separate objects.
        void openEntry(winner);
        Animated.timing(handoffProgress, {
          toValue: 1,
          duration: HANDOFF_FADE_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }).start();
      });
    });
  }

  function handlePagerScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const page = Math.round(event.nativeEvent.contentOffset.x / windowWidth);
    setActivePage(page);
  }

  function goToPreviousMonth() {
    setViewedMonth((current) =>
      current.month === 0
        ? { year: current.year - 1, month: 11 }
        : { year: current.year, month: current.month - 1 }
    );
  }

  function goToNextMonth() {
    setViewedMonth((current) =>
      current.month === 11
        ? { year: current.year + 1, month: 0 }
        : { year: current.year, month: current.month + 1 }
    );
  }

  const selectedBlend = selectedEntry ? sortBlend(resolveEntryBlend(selectedEntry)) : null;
  const selectedDominantColor = selectedBlend?.length
    ? emotionColor(selectedBlend[0].emotion)
    : C.muted;

  // The throwback winner, lifted out of the cluster onto its own layer.
  const revealedPoint = revealedPointId
    ? (cluster.points.find((point) => point.id === revealedPointId) ?? null)
    : null;
  const revealedEntry = revealedPointId ? entriesById.get(revealedPointId) : null;
  const revealedBlend = revealedEntry ? sortBlend(resolveEntryBlend(revealedEntry)) : null;
  const revealedColor = revealedBlend?.length ? emotionColor(revealedBlend[0].emotion) : C.accent;
  // Kept inside the canvas so a small cluster's halo can't be clipped by the
  // scroll view it sits in. It fades to transparent either way.
  const revealHaloSize = Math.min(REVEAL_HALO_SIZE, cluster.canvasSize);

  if (loading && !refreshing) {
    return (
      <View style={styles.centered}>
        <FrequencyLogoLoader size={58} label="Opening your Field..." />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View
        style={[
          styles.header,
          { paddingTop: Math.max(insets.top + 6, 18) },
        ]}
      >
        <View style={styles.titleRow}>
          <Text style={styles.title}>Resonance Field</Text>
        </View>
        <Text style={styles.subtitle}>Your private mood history.</Text>

        {/*
          The tutorial wrapper has to hug the pill, not stretch: it is what
          gets measured, and a full-width wrapper would cut a full-width
          strip out of the dim instead of lighting the button.
        */}
        {showRecordPill && (
          <TutorialTarget id={RECORD_RESONANCE_TARGET} style={styles.recordTodayTarget}>
            <Touchable
              style={styles.recordTodayPill}
              activeOpacity={0.84}
              onPress={() => {
                void selection();
                router.push('/resonance');
              }}
            >
              <Ionicons name="mic-outline" size={14} color={C.accent} />
              <Text style={styles.recordTodayPillText}>Record today&apos;s Resonance</Text>
            </Touchable>
          </TutorialTarget>
        )}

        {entries.length > 0 && (
          <View style={styles.pageDots}>
            <View style={[styles.pageDot, activePage === 0 && styles.pageDotActive]} />
            <View style={[styles.pageDot, activePage === 1 && styles.pageDotActive]} />
          </View>
        )}
      </View>

      {entries.length === 0 ? (
        <View style={styles.emptyCardWrap}>
          <View style={styles.emptyCard}>
            <FrequencyLogo size={58} opacity={0.14} style={styles.emptyLogo} />
            <Text style={styles.emptyTitle}>No orbs to show yet.</Text>
            <Text style={styles.emptyText}>
              Your daily Resonance entries will appear here once you start recording.
            </Text>
          </View>
        </View>
      ) : (
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={handlePagerScroll}
          scrollEventThrottle={16}
          style={styles.pager}
        >
          <View style={{ width: windowWidth, flex: 1 }}>
            <ScrollView
              contentContainerStyle={[
                styles.pagePadding,
                { paddingBottom: insets.bottom + 72 },
              ]}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={refreshEntries} tintColor={C.accent} />
              }
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.clusterWrap}>
                <Animated.View
                  style={{
                    width: cluster.canvasSize,
                    height: cluster.canvasSize,
                    // The field leans with the wave and eases back — one shared
                    // motion under the per-orb pulses, so the sweep reads as
                    // something happening to the cluster, not to each orb.
                    transform: [
                      {
                        rotate: sweepProgress.interpolate({
                          inputRange: [0, 0.3, 0.7, 1],
                          outputRange: [
                            '0deg',
                            `${SWEEP_TILT_DEGREES}deg`,
                            `${-SWEEP_TILT_DEGREES}deg`,
                            '0deg',
                          ],
                        }),
                      },
                    ],
                  }}
                >
                  {/* Blooms behind the winner as it arrives at the centre. */}
                  {revealedPointId !== null && (
                    <Animated.View
                      pointerEvents="none"
                      style={[
                        styles.revealHalo,
                        {
                          width: revealHaloSize,
                          height: revealHaloSize,
                          left: cluster.canvasSize / 2 - revealHaloSize / 2,
                          top: cluster.canvasSize / 2 - revealHaloSize / 2,
                          opacity: Animated.multiply(
                            revealProgress.interpolate({
                              inputRange: [REVEAL_ANTICIPATION, 1],
                              outputRange: [0, 1],
                              extrapolate: 'clamp',
                            }),
                            handoffProgress.interpolate({
                              inputRange: [0, 1],
                              outputRange: [1, 0],
                            })
                          ),
                          transform: [
                            {
                              scale: revealProgress.interpolate({
                                inputRange: [REVEAL_ANTICIPATION, 1],
                                outputRange: [0.55, 1],
                                extrapolate: 'clamp',
                              }),
                            },
                          ],
                        },
                      ]}
                    >
                      <ResonanceHalo color={revealedColor} size={revealHaloSize} />
                    </Animated.View>
                  )}

                  {/* The winner travels on its own layer, drawn at the size it
                      ends up rather than the size it started. Scaling a small
                      orb up would just stretch the bitmap the SVG was already
                      rasterised into, which is what made it look blurred — so
                      it renders full-size and is scaled *down* to match its
                      place in the cluster, then released to 1:1. */}
                  {revealedPoint && revealedBlend && (
                    <Animated.View
                      pointerEvents="none"
                      style={[
                        styles.revealOrb,
                        {
                          width: REVEAL_TARGET_SIZE,
                          height: REVEAL_TARGET_SIZE,
                          left: cluster.canvasSize / 2 - REVEAL_TARGET_SIZE / 2,
                          top: cluster.canvasSize / 2 - REVEAL_TARGET_SIZE / 2,
                          opacity: Animated.multiply(
                            handoffProgress.interpolate({
                              inputRange: [0, 1],
                              outputRange: [1, 0],
                            }),
                            revealProgress.interpolate({
                              inputRange: [0, 1],
                              outputRange: [revealedPoint.opacity, 1],
                            })
                          ),
                          transform: [
                            {
                              translateX: revealProgress.interpolate({
                                inputRange: [0, REVEAL_ANTICIPATION, 1],
                                outputRange: [revealedPoint.x, revealedPoint.x, 0],
                              }),
                            },
                            {
                              translateY: revealProgress.interpolate({
                                inputRange: [0, REVEAL_ANTICIPATION, 1],
                                outputRange: [revealedPoint.y, revealedPoint.y, 0],
                              }),
                            },
                            {
                              scale: revealProgress.interpolate({
                                inputRange: [0, REVEAL_ANTICIPATION, 1],
                                outputRange: [
                                  revealedPoint.size / REVEAL_TARGET_SIZE,
                                  (revealedPoint.size / REVEAL_TARGET_SIZE) * 0.84,
                                  1,
                                ],
                              }),
                            },
                          ],
                        },
                      ]}
                    >
                      <ResonanceOrb
                        blend={revealedBlend}
                        size={REVEAL_TARGET_SIZE}
                        ripple={false}
                      />
                    </Animated.View>
                  )}

                  {cluster.points.map((point, index) => {
                    const entry = entriesById.get(point.id);
                    if (!entry) return null;

                    const entryBlend = resolveEntryBlend(entry);
                    const half = point.size / 2;
                    const [entranceStart, entranceEnd] = entranceRange(index, cluster.points.length);
                    // Only while a search is actually running — otherwise the
                    // last search's vectors would keep shaping an idle field.
                    const sweepVector = jostling ? sweepVectorsRef.current.get(point.id) : undefined;
                    const isRevealed = revealedPointId === point.id;
                    const isDimmedByReveal = revealedPointId !== null && !isRevealed;

                    // 0 → 1 → 0 as each wavefront reaches this orb.
                    const sweepPulse = sweepVector
                      ? sweepProgress.interpolate({
                          ...buildSweepPulse(sweepVector.phase),
                          extrapolate: 'clamp',
                        })
                      : null;

                    // Settle-back that fades in and out with the search itself,
                    // so entering and leaving the sweep never pops.
                    const sweepOpacity = sweepPulse
                      ? Animated.subtract(
                          1,
                          Animated.multiply(
                            Animated.multiply(
                              sweepProgress.interpolate({
                                inputRange: [0, 0.12, 0.88, 1],
                                outputRange: [0, 1, 1, 0],
                                extrapolate: 'clamp',
                              }),
                              Animated.subtract(1, sweepPulse)
                            ),
                            1 - SWEEP_BASE_OPACITY
                          )
                        )
                      : null;

                    return (
                      <Touchable
                        key={point.id}
                        activeOpacity={0.82}
                        hitSlop={10}
                        disabled={jostling || revealedPointId !== null}
                        onPress={() => openEntry(entry)}
                        style={[
                          styles.clusterOrb,
                          {
                            left: cluster.canvasSize / 2 + point.x - half,
                            top: cluster.canvasSize / 2 + point.y - half,
                            width: point.size,
                            height: point.size,
                          },
                        ]}
                      >
                        {/* Position: the nudge from the passing wavefront. */}
                        <Animated.View
                          style={{
                            transform: [
                              {
                                translateX: sweepPulse
                                  ? Animated.multiply(sweepPulse, sweepVector!.driftX)
                                  : 0,
                              },
                              {
                                translateY: sweepPulse
                                  ? Animated.multiply(sweepPulse, sweepVector!.driftY)
                                  : 0,
                              },
                            ],
                          }}
                        >
                          <Animated.View
                            style={{
                              opacity: entranceProgress.interpolate({
                                inputRange: [entranceStart, entranceEnd],
                                outputRange: [0, point.opacity],
                                extrapolate: 'clamp',
                              }),
                              transform: [
                                {
                                  scale: entranceProgress.interpolate({
                                    inputRange: [entranceStart, entranceEnd],
                                    outputRange: [0.3, 1],
                                    extrapolate: 'clamp',
                                  }),
                                },
                              ],
                            }}
                          >
                            {/* Presence: lit by the passing wavefront, then
                                faded back so the winner stands alone. The
                                winner itself hands off to the full-resolution
                                layer below and goes fully transparent here. */}
                            <Animated.View
                              style={{
                                opacity: isRevealed
                                  ? 0
                                  : isDimmedByReveal
                                    ? revealProgress.interpolate({
                                        inputRange: [0, REVEAL_ANTICIPATION, 1],
                                        outputRange: [1, 1, REVEAL_DIM_OPACITY],
                                      })
                                    : (sweepOpacity ?? 1),
                                transform: [
                                  {
                                    scale: sweepPulse
                                      ? sweepPulse.interpolate({
                                          inputRange: [0, 1],
                                          outputRange: [1, SWEEP_PEAK_SCALE],
                                        })
                                      : 1,
                                  },
                                ],
                              }}
                            >
                              <ResonanceOrb blend={entryBlend} size={point.size} ripple={false} />
                            </Animated.View>
                          </Animated.View>
                        </Animated.View>
                      </Touchable>
                    );
                  })}
                </Animated.View>
              </View>

              <View style={styles.throwbackWrap}>
                <Touchable
                  style={[styles.throwbackButton, jostling && styles.throwbackButtonBusy]}
                  activeOpacity={0.82}
                  disabled={jostling}
                  onPress={startRandomThrowback}
                >
                  <Ionicons name="sparkles-outline" size={17} color={C.accent} />
                  <Text style={styles.throwbackButtonText}>
                    {jostling ? 'Finding one…' : 'Random Throwback'}
                  </Text>
                </Touchable>

                {throwbackMessage && (
                  <Text style={styles.throwbackMessage}>{throwbackMessage}</Text>
                )}
              </View>
            </ScrollView>
          </View>

          <View style={{ width: windowWidth, flex: 1 }}>
            <View style={styles.calendarHeadingArea}>
              <View style={styles.calendarMonthNavRow}>
                <Touchable
                  style={styles.monthNavButton}
                  activeOpacity={0.82}
                  hitSlop={8}
                  onPress={goToPreviousMonth}
                >
                  <Ionicons name="chevron-back" size={16} color={C.muted} />
                </Touchable>

                <Text style={styles.calendarMonthLabel}>{monthLabelText}</Text>

                <Touchable
                  style={styles.monthNavButton}
                  activeOpacity={0.82}
                  hitSlop={8}
                  onPress={goToNextMonth}
                >
                  <Ionicons name="chevron-forward" size={16} color={C.muted} />
                </Touchable>
              </View>

              <View style={[styles.calendarWeekRow, { gap: CALENDAR_GRID_GAP, marginBottom: 0 }]}>
                {WEEKDAY_LABELS.map((label, index) => (
                  <View key={index} style={{ width: calendarCellSize, alignItems: 'center' }}>
                    <Text style={styles.calendarWeekdayLabel}>{label}</Text>
                  </View>
                ))}
              </View>
            </View>

            <ScrollView
              contentContainerStyle={[
                styles.pagePadding,
                { paddingBottom: insets.bottom + 72 },
              ]}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={refreshEntries} tintColor={C.accent} />
              }
              showsVerticalScrollIndicator={false}
            >
              {calendarWeeks.map((week, weekIndex) => (
                <View key={weekIndex} style={[styles.calendarWeekRow, { gap: CALENDAR_GRID_GAP }]}>
                  {week.map((day, dayIndex) => {
                    if (!day) {
                      return (
                        <View
                          key={dayIndex}
                          style={[
                            styles.calendarCell,
                            { width: calendarCellSize, height: calendarCellHeight },
                          ]}
                        />
                      );
                    }

                    const entry = entriesByDate.get(day.dateKey);

                    return (
                      <Touchable
                        key={day.dateKey}
                        activeOpacity={entry ? 0.82 : 1}
                        disabled={!entry}
                        onPress={entry ? () => openEntry(entry) : undefined}
                        style={[
                          styles.calendarCell,
                          { width: calendarCellSize, height: calendarCellHeight },
                        ]}
                      >
                        <View style={[styles.calendarOrbSlot, { height: calendarCellSize }]}>
                          {entry && (
                            <ResonanceOrb
                              blend={resolveEntryBlend(entry)}
                              size={calendarOrbSize}
                              ripple={false}
                            />
                          )}
                        </View>
                        <Text style={entry ? styles.calendarDateNumber : styles.calendarDateNumberEmpty}>
                          {day.date.getDate()}
                        </Text>
                      </Touchable>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          </View>
        </ScrollView>
      )}

      <Modal
        visible={!!selectedEntry}
        transparent
        animationType="slide"
        onRequestClose={closeEntry}
      >
        <View style={styles.modalRoot}>
          <Touchable activeOpacity={1} style={styles.modalBackdrop} onPress={closeEntry} />

          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 18) }]}>
            <View style={styles.sheetHandle} />

            <Touchable
              style={styles.closeButton}
              activeOpacity={0.8}
              hitSlop={8}
              onPress={closeEntry}
            >
              <Ionicons name="close" size={18} color={C.muted} />
            </Touchable>

            <ScrollView
              showsVerticalScrollIndicator={false}
              bounces={false}
              contentContainerStyle={styles.sheetScrollContent}
            >
              {/* The orb is the hero of the whole feature — it leads the
                  sheet rather than being swapped out for a text summary. */}
              <View style={styles.sheetOrbStage}>
                {/* The halo opens outward behind the orb as it lands, which is
                    what makes the arrival read as the entry unfolding rather
                    than a card appearing. */}
                <Animated.View
                  pointerEvents="none"
                  style={[
                    StyleSheet.absoluteFillObject,
                    {
                      opacity: sheetOrbProgress.interpolate({
                        inputRange: [0, 0.45, 1],
                        outputRange: [0, 0.25, 1],
                      }),
                      transform: [
                        {
                          scale: sheetOrbProgress.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.62, 1],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <ResonanceHalo color={selectedDominantColor} size={SHEET_ORB_STAGE} />
                </Animated.View>

                <Animated.View
                  style={{
                    opacity: sheetOrbProgress.interpolate({
                      inputRange: [0, 0.35, 1],
                      outputRange: [0, 1, 1],
                    }),
                    transform: [
                      {
                        scale: sheetOrbProgress.interpolate({
                          inputRange: [0, 1],
                          outputRange: [1, SHEET_ORB_REST_SCALE],
                        }),
                      },
                    ],
                  }}
                >
                  {selectedBlend && (
                    <ResonanceOrb blend={selectedBlend} size={SHEET_ORB_RENDER_SIZE} />
                  )}
                </Animated.View>
              </View>

              {/* Everything under the orb unfolds a beat later, so the orb
                  arrives first and the entry opens up around it. */}
              <Animated.View
                style={[
                  styles.sheetContent,
                  {
                    opacity: sheetContentProgress,
                    transform: [
                      {
                        translateY: sheetContentProgress.interpolate({
                          inputRange: [0, 1],
                          outputRange: [16, 0],
                        }),
                      },
                    ],
                  },
                ]}
              >
                {selectedEntry && (
                  <Text style={styles.sheetDate}>{formatResonanceDate(selectedEntry.entry_date)}</Text>
                )}

                {/* The legend, not a second chart — the orb already shows the
                    proportions, so these only name the colours in it. */}
                {selectedBlend && selectedBlend.length > 1 && (
                  <View style={styles.legend}>
                    {selectedBlend.map((item) => (
                      <View key={item.emotion} style={styles.legendChip}>
                        <View
                          style={[styles.legendDot, { backgroundColor: emotionColor(item.emotion) }]}
                        />
                        <Text style={styles.legendLabel}>{emotionLabel(item.emotion)}</Text>
                        <Text style={styles.legendPercent}>{item.percentage}%</Text>
                      </View>
                    ))}
                  </View>
                )}

                {playbackLoading ? (
                  <View style={styles.playbackLoading}>
                    <ActivityIndicator color={C.accent} />
                  </View>
                ) : (
                  <View style={styles.playbackBlock}>
                    <View style={styles.playbackRow}>
                      <Touchable
                        style={styles.playButton}
                        activeOpacity={0.84}
                        onPress={togglePlayback}
                      >
                        <Ionicons name={isPlaying ? 'pause' : 'play'} size={22} color="#0B100D" />
                      </Touchable>

                      <View style={styles.playbackWaveformWrap}>
                        <FrequencyWaveform
                          active
                          progress={durationSeconds > 0 ? positionSeconds / durationSeconds : 0}
                          waveform={selectedEntry?.waveform}
                          onSeek={(fraction) => {
                            void seekEntry(fraction);
                          }}
                        />
                      </View>
                    </View>

                    <Text style={styles.playbackTime}>
                      {formatTime(positionSeconds)} / {formatTime(durationSeconds)}
                    </Text>
                  </View>
                )}

                {/* Same tactile paper-and-tape note as Whispers captions —
                    a written aside pinned to the recording, not a form field. */}
                {selectedEntry?.sticky_note && (
                  <View style={styles.stickyNoteWrap}>
                    <View style={styles.stickyNote}>
                      <View style={styles.tape} />
                      <Text style={styles.stickyNoteText}>{selectedEntry.sticky_note}</Text>
                    </View>
                  </View>
                )}
              </Animated.View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <TutorialIntroCard
        visible={tutorialActive && !tutorialIntroDone}
        title="Your Resonance Field."
        body={
          entries.length > 0
            ? 'Every orb is one day’s mood, kept private to you — never shared, never on your profile. Swipe across for the same days as a calendar.'
            : 'Each day you record how you feel becomes an orb here, kept private to you — never shared, never on your profile.'
        }
        onDismiss={dismissTutorialIntro}
      />

      <SpotlightOverlay
        visible={tutorialActive && tutorialIntroDone && showRecordPill}
        steps={RESONANCE_FIELD_STEPS}
        onFinish={finishTutorial}
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

  header: {
    paddingHorizontal: CONTENT_HORIZONTAL_PADDING,
  },

  pager: {
    flex: 1,
  },

  pagePadding: {
    paddingHorizontal: CONTENT_HORIZONTAL_PADDING,
    paddingTop: S.sm,
  },

  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
  },

  title: {
    color: C.text,
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: -1.1,
  },

  subtitle: {
    color: C.muted,
    fontSize: 18,
    marginTop: 8,
  },

  recordTodayTarget: {
    alignSelf: 'flex-start',
  },

  recordTodayPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: S.md,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.accent,
    backgroundColor: 'rgba(107,168,130,0.1)',
  },

  recordTodayPillText: {
    color: C.accent,
    fontSize: 13,
    fontWeight: '800',
  },

  pageDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: S.lg,
    marginBottom: S.sm,
  },

  pageDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.divider,
  },

  pageDotActive: {
    width: 16,
    backgroundColor: C.accent,
  },

  emptyCardWrap: {
    paddingHorizontal: CONTENT_HORIZONTAL_PADDING,
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

  clusterWrap: {
    alignItems: 'center',
    marginTop: S.sm,
  },

  clusterOrb: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },

  revealOrb: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 4,
    elevation: 4,
  },

  revealHalo: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    elevation: 2,
  },

  throwbackWrap: {
    alignItems: 'center',
    marginTop: S.xl,
  },

  throwbackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.accent,
    backgroundColor: 'rgba(107,168,130,0.1)',
    // A quiet ambient glow at rest, same soft-shadow language as the sticky
    // note elsewhere in this sheet — just tinted with the accent instead of
    // black, so the pill reads as lit rather than merely outlined.
    shadowColor: C.accent,
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
  },

  throwbackButtonBusy: {
    opacity: 0.6,
  },

  throwbackButtonText: {
    color: C.accent,
    fontSize: 15,
    fontWeight: '800',
  },

  throwbackMessage: {
    color: C.muted,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 12,
    textAlign: 'center',
    paddingHorizontal: S.lg,
  },

  calendarHeadingArea: {
    paddingHorizontal: CONTENT_HORIZONTAL_PADDING,
    paddingTop: S.sm,
  },

  calendarMonthNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: S.sm,
    marginBottom: S.md,
  },

  monthNavButton: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },

  calendarMonthLabel: {
    color: C.muted,
    fontSize: 15,
    fontWeight: '700',
    minWidth: 120,
    textAlign: 'center',
  },

  calendarWeekdayLabel: {
    color: C.faint,
    fontSize: 12,
    fontWeight: '700',
  },

  calendarWeekRow: {
    flexDirection: 'row',
    marginBottom: CALENDAR_GRID_GAP,
  },

  calendarCell: {
    alignItems: 'center',
  },

  calendarOrbSlot: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },

  calendarDateNumber: {
    color: C.muted,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },

  calendarDateNumberEmpty: {
    color: C.faint,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
    opacity: 0.7,
  },

  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },

  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },

  sheet: {
    marginHorizontal: 12,
    marginBottom: 14,
    paddingHorizontal: 24,
    paddingTop: 14,
    maxHeight: '88%',
    borderRadius: 32,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.07)',
    backgroundColor: C.surface,
  },

  sheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 3,
    backgroundColor: 'rgba(226,237,232,0.26)',
  },

  sheetScrollContent: {
    alignItems: 'center',
    paddingBottom: S.sm,
  },

  // Floats over the content so the orb stays optically centred in the sheet
  // rather than being pushed off-axis by a header row.
  closeButton: {
    position: 'absolute',
    top: 12,
    right: 16,
    zIndex: 2,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.card,
  },

  // No negative margin: pulling the stage up past the scroll view's top edge
  // is what cut the glow off straight. It needs clearance, not tightening.
  sheetOrbStage: {
    width: SHEET_ORB_STAGE,
    height: SHEET_ORB_STAGE,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: S.xs,
  },

  // Stretches so the playback row inside it still spans the sheet, and keeps
  // the centring the scroll content container was providing.
  // Full width explicitly: this wrapper only exists to animate the unfold, so
  // it must not become a narrower box that its children then measure against.
  sheetContent: {
    width: '100%',
    alignItems: 'center',
    marginTop: SHEET_CONTENT_LIFT,
  },

  sheetDate: {
    color: C.muted,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 6,
  },

  // Same reason as the note: the chips need the full width to wrap against.
  legend: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 7,
    marginTop: S.md,
  },

  legendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 9,
    paddingRight: 11,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: C.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.divider,
  },

  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  legendLabel: {
    color: C.text,
    fontSize: 13,
    fontWeight: '700',
  },

  legendPercent: {
    color: C.muted,
    fontSize: 13,
    fontWeight: '600',
  },

  playbackLoading: {
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },

  playbackBlock: {
    alignSelf: 'stretch',
    marginTop: S.lg,
  },

  playbackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
  },

  // Stays Frequency green rather than taking the entry's colour: it is app
  // chrome, and near-black-on-colour would lose contrast against the darker
  // emotions (Longing, Gloom, Anger). The waveform carries the colour instead.
  playButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.accent,
  },

  playbackWaveformWrap: {
    flex: 1,
    overflow: 'hidden',
  },

  playbackTime: {
    color: C.muted,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: S.xs,
  },

  // Spans the sheet so the note measures its text against the full width and
  // only wraps at its own maxWidth, rather than being squeezed by the wrapper.
  stickyNoteWrap: {
    alignSelf: 'stretch',
    alignItems: 'center',
    marginTop: S.lg,
    marginBottom: S.xs,
  },

  stickyNote: {
    maxWidth: 260,
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderRadius: 6,
    backgroundColor: '#EDF8E9',
    borderWidth: 1,
    borderColor: 'rgba(17,22,20,0.1)',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    transform: [{ rotate: '-1.4deg' }],
  },

  tape: {
    position: 'absolute',
    top: -8,
    left: -6,
    width: 42,
    height: 13,
    borderRadius: 3,
    backgroundColor: 'rgba(107,168,130,0.56)',
    transform: [{ rotate: '-9deg' }],
  },

  stickyNoteText: {
    color: '#18211B',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
  },
});
