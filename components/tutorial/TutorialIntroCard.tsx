import { StyleSheet, Text, View } from 'react-native';

import GlassSheet from '@/components/GlassSheet';
import Touchable from '@/components/Touchable';
import {
  FrequencyColors as C,
  FrequencyRadius as R,
  FrequencySpacing as S,
} from '@/constants/frequencyTheme';
import { light } from '@/lib/haptics';

/**
 * A short note about a screen, the first time someone arrives on it.
 *
 * The counterpart to SpotlightOverlay. A spotlight has to know where a
 * thing is, which rules it out for anything inside a list -- a feed card,
 * a Whisper bubble, a mood orb -- since those may not be mounted yet and
 * move under the finger when they are. This points at nothing and explains
 * the room instead.
 *
 * Built on GlassSheet rather than a new frosted panel, so it is the same
 * material as Search, the Whisper sheets and Echo Impact. Dismissed by
 * tapping the button, tapping the backdrop, or dragging the sheet down.
 */
export default function TutorialIntroCard({
  visible,
  title,
  body,
  actionLabel = 'Got it',
  onDismiss,
  inline = false,
}: {
  visible: boolean;
  title: string;
  body: string;
  actionLabel?: string;
  onDismiss: () => void;
  /**
   * Set on screens that are themselves presented modally (the Resonance
   * check-in). Renders the sheet as an in-screen overlay rather than a
   * nested Modal -- see the note on GlassSheet's `inline`.
   */
  inline?: boolean;
}) {
  function dismiss() {
    void light();
    onDismiss();
  }

  return (
    <GlassSheet visible={visible} onClose={dismiss} swipeToDismiss inline={inline}>
      {/*
        No entrance animation of its own. GlassSheet already slides the
        whole sheet in, and this renders inside that sheet's <Modal>, where
        Reanimated's animated styles do not run -- a Reanimated entrance
        here left the copy and the button stuck at opacity 0 on a sheet
        that was otherwise visible. See the note in SpotlightOverlay.
      */}
      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>

        <Touchable style={styles.button} activeOpacity={0.86} onPress={dismiss}>
          <Text style={styles.buttonText}>{actionLabel}</Text>
        </Touchable>
      </View>
    </GlassSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: S.sm,
  },

  // The sheet header scale, 26/800/-0.4 -- same as every other sheet in
  // the app rather than a third size for this one.
  title: {
    color: C.text,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.4,
  },

  body: {
    color: C.muted,
    fontSize: 17,
    lineHeight: 25,
  },

  button: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.accent,
    borderRadius: R.md,
    paddingVertical: 17,
    marginTop: S.lg,
  },

  buttonText: {
    color: '#0B100D',
    fontSize: 17,
    fontWeight: '700',
  },
});
