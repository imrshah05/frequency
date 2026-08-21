import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import 'react-native-reanimated';
import type { Session } from '@supabase/supabase-js';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { FrequencyLogoLoader } from '@/components/branding/FrequencyLogo';
import EchoImpactRevealHost from '@/components/EchoImpactRevealHost';
import TutorialWelcomeHost from '@/components/tutorial/TutorialWelcomeHost';
import { FrequencyColors as C } from '@/constants/frequencyTheme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { ensureProfileForUser } from '@/lib/profiles';
import { supabase } from '@/lib/supabase';

SplashScreen.setOptions({
  duration: 850,
  fade: true,
});

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const segments = useSegments();
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function syncProfileForSession(nextSession: Session | null) {
      await ensureProfileForUser(nextSession?.user);
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoadingSession(false);
      void syncProfileForSession(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setLoadingSession(false);
      void syncProfileForSession(nextSession);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (loadingSession) return;

    const isOnLogin = segments[0] === 'login';

    if (!session && !isOnLogin) {
      router.replace('/login');
      return;
    }

    if (session && isOnLogin) {
      router.replace('/(tabs)');
      return;
    }
  }, [loadingSession, router, segments, session]);

  if (loadingSession) {
    return (
      <GestureHandlerRootView style={styles.root}>
        <View style={styles.loadingScreen}>
          <FrequencyLogoLoader size={72} />
        </View>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="record"
            options={{
              headerShown: false,
              presentation: 'modal',
            }}
          />
          <Stack.Screen
            name="resonance"
            options={{
              headerShown: false,
              presentation: 'modal',
            }}
          />
          <Stack.Screen name="frequency/[userId]" options={{ headerShown: false }} />
          <Stack.Screen name="archives" options={{ headerShown: false }} />
          <Stack.Screen name="live-echoes/[userId]" options={{ headerShown: false }} />
          <Stack.Screen name="frequency-connections" options={{ headerShown: false }} />
          <Stack.Screen
            name="mutuals"
            options={{
              headerShown: false,
              presentation: 'modal',
            }}
          />
          <Stack.Screen name="echoes-near-you" options={{ headerShown: false }} />
          <Stack.Screen name="whispers/[threadId]" options={{ headerShown: false }} />
          <Stack.Screen
            name="whispers/new"
            options={{
              headerShown: false,
              presentation: 'modal',
            }}
          />
          <Stack.Screen
            name="whispers/new-group"
            options={{
              headerShown: false,
              presentation: 'modal',
            }}
          />
          <Stack.Screen name="whispers/group/[threadId]/index" options={{ headerShown: false }} />
          <Stack.Screen name="whispers/group/[threadId]/members" options={{ headerShown: false }} />
          <Stack.Screen
            name="whispers/group/[threadId]/add"
            options={{
              headerShown: false,
              presentation: 'modal',
            }}
          />
        </Stack>

        {/*
          Sits outside the navigator, because a sealed Impact can become
          ready while the app is anywhere. It renders nothing until it finds
          something waiting, so an app open with no pending reveal is
          untouched by it.
        */}
        <EchoImpactRevealHost userId={session?.user.id ?? null} />

        {/*
          Above the reveal in the tree so a brand-new account is greeted
          before anything else can take the screen. In practice they cannot
          collide -- an account new enough to see this has no Echo old
          enough to have a sealed Impact -- but the order should not depend
          on that staying true.
        */}
        <TutorialWelcomeHost />

        <StatusBar style="light" />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },

  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.background,
  },
});
