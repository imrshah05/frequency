import { useEffect, useRef, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Touchable from './Touchable';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import Avatar from '@/components/Avatar';
import { FrequencyColors as C, FrequencySpacing as S } from '@/constants/frequencyTheme';

// Diameter of the soft bloom behind the portrait. Wider than the outer ring
// so the gradient reaches zero before its own edge -- otherwise the disc
// terminates in a visible circle instead of fading into the background.
const GLOW_SIZE = 300;
const AVATAR_SIZE = 144;

// The stage is sized to the bloom, so it carries a band of fully transparent
// gradient below the portrait. That band is real layout space but nothing the
// eye can see, which pushed whatever follows -- the username -- far further
// from the portrait than it looked like it should be. It gets reclaimed with
// a negative margin, leaving one deliberate gap measured from the last thing
// actually visible.
const DEAD_BAND = (GLOW_SIZE - AVATAR_SIZE) / 2;

/**
 * The visible gap under the portrait, which is what the username sits on.
 * Kept tight on purpose: the name reads as part of the portrait, and the
 * screen opens a wider gap below it to separate the hero from the rest.
 */
const PROFILE_HERO_GAP = S.lg;

// How far the overlay hangs past the portrait: the drop below it, plus the
// height of the tallest thing any screen puts there (the ~30pt "Edit" pill on
// My Frequency). Only an approximation is needed -- it decides how much of an
// invisible band to remove, not where anything is drawn.
const OVERLAY_DROP = 16;
const OVERLAY_REACH = OVERLAY_DROP + 30;

// Several profile screens can sit in the stack at once (profile -> tap a
// suggestion -> another profile), so gradient def ids must be unique per
// mount or the second instance reuses the first one's gradient.
let glowInstanceCounter = 0;

type ProfileAvatarStageProps = {
  avatarUrl: string | null;
  initial: string;
  /** Drives the accent ring and the breathing halo. */
  isLive: boolean;
  onPress?: () => void;
  disabled?: boolean;
  /** Centered just below the portrait, e.g. the owner's "Edit" pill. */
  overlay?: ReactNode;
};

/**
 * The portrait hero shared by "My Frequency" and someone else's profile, so
 * both screens read as the same place. Owns only the presentation -- what a
 * tap means, and whether an overlay hangs off the portrait, stays with the
 * screen.
 */
export default function ProfileAvatarStage({
  avatarUrl,
  initial,
  isLive,
  onPress,
  disabled,
  overlay,
}: ProfileAvatarStageProps) {
  const breath = useSharedValue(0);
  const glowId = useRef(`profile-glow-${glowInstanceCounter++}`).current;

  // Halo breathes only while this person has a Live Echo -- a slow multi-second
  // sine loop, so it reads as alive rather than animated. Otherwise it rests.
  useEffect(() => {
    if (isLive) {
      breath.value = withRepeat(
        withTiming(1, { duration: 2800, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
      return;
    }

    breath.value = withTiming(0, { duration: 420 });
  }, [isLive, breath]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.5 + breath.value * 0.5,
    transform: [{ scale: 1 + breath.value * 0.035 }],
  }));

  return (
    <View
      style={[
        styles.stage,
        {
          marginBottom: -(
            DEAD_BAND -
            (overlay ? OVERLAY_REACH : 0) -
            PROFILE_HERO_GAP
          ),
        },
      ]}
    >
      <Animated.View pointerEvents="none" style={[styles.glow, haloStyle]}>
        <Svg width={GLOW_SIZE} height={GLOW_SIZE}>
          <Defs>
            <RadialGradient id={glowId} cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={C.accent} stopOpacity={0.3} />
              <Stop offset="42%" stopColor={C.accent} stopOpacity={0.14} />
              <Stop offset="72%" stopColor={C.accent} stopOpacity={0.04} />
              <Stop offset="100%" stopColor={C.accent} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle
            cx={GLOW_SIZE / 2}
            cy={GLOW_SIZE / 2}
            r={GLOW_SIZE / 2}
            fill={`url(#${glowId})`}
          />
        </Svg>
      </Animated.View>

      <View>
        <Touchable
          style={isLive ? styles.liveAvatarRing : undefined}
          activeOpacity={onPress ? 0.84 : 1}
          disabled={disabled || !onPress}
          onPress={onPress}
        >
          <Avatar
            avatarUrl={avatarUrl}
            initial={initial}
            size={AVATAR_SIZE}
            textSize={56}
          />
        </Touchable>

        {!!overlay && (
          <Touchable
            style={styles.overlay}
            activeOpacity={onPress ? 0.84 : 1}
            disabled={disabled || !onPress}
            onPress={onPress}
          >
            {overlay}
          </Touchable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Sized to the bloom rather than to the rings: Android clips children
  // that overflow their parent, which would slice the gradient off with a
  // hard edge. The cost is the invisible band below the portrait, which the
  // negative marginBottom applied at the call site takes back out of flow.
  stage: {
    width: GLOW_SIZE,
    height: GLOW_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },

  glow: {
    position: 'absolute',
    width: GLOW_SIZE,
    height: GLOW_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },

  liveAvatarRing: {
    padding: 5,
    borderRadius: 84,
    borderWidth: 2,
    borderColor: C.accent,
    backgroundColor: 'rgba(107,168,130,0.1)',
  },

  overlay: {
    position: 'absolute',
    bottom: -OVERLAY_DROP,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
});
