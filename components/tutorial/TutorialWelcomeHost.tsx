import { Modal, StyleSheet, View } from 'react-native';

import TutorialWelcome from '@/components/tutorial/TutorialWelcome';
import { useTutorialMoment } from '@/lib/tutorial/useTutorialMoment';

/**
 * Shows the welcome screen once, on first launch.
 *
 * Mounted at the root alongside EchoImpactRevealHost, outside the
 * navigator, for the same reason: this takes over the whole app rather
 * than living inside a screen. It never blocks startup -- until the
 * progress read lands it renders nothing at all, so an app open for
 * somebody who has already seen it is byte-for-byte the old behaviour.
 *
 * All of the "has this been seen, and should it run now" logic lives in
 * useTutorialMoment, shared with every contextual moment.
 */
export default function TutorialWelcomeHost() {
  // Mounted at the root, so "Show tutorials again" brings this back
  // immediately rather than on the next launch -- clearing progress is
  // meant to start the whole experience over from here.
  const { active, finish } = useTutorialMoment('welcome');

  return (
    <Modal visible={active} animationType="fade" statusBarTranslucent onRequestClose={finish}>
      <View style={styles.root}>
        <TutorialWelcome onDismiss={finish} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
});
