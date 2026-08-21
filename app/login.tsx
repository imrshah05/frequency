import { Feather } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Touchable from '@/components/Touchable';
import { FrequencyBrand, FrequencyLogoLoader } from '@/components/branding/FrequencyLogo';
import ResolvingWaveform from '@/components/tutorial/ResolvingWaveform';
import SpringIn from '@/components/SpringIn';
import { hasSeenWelcome, markWelcomeSeen } from '@/lib/tutorial/welcome';
import {
  FrequencyColors as C,
  FrequencyRadius as R,
  FrequencySpacing as S,
} from '@/constants/frequencyTheme';
import { supabase } from '@/lib/supabase';
import { router } from 'expo-router';
import { ensureProfileForUser, validateUsername } from '@/lib/profiles';
import { error as hapticError, success } from '@/lib/haptics';

type AuthMode = 'login' | 'signup';

/**
 * Fades its children in on the welcome launch, and does nothing on every
 * launch after it.
 *
 * The plain-children branch is the point: a returning visitor should find the
 * auth screen already there, not watch it assemble itself every time. Only
 * the first launch is a moment.
 */
function WelcomeIntro({
  active,
  delay,
  children,
}: {
  active: boolean;
  delay: number;
  children: React.ReactNode;
}) {
  if (!active) return <>{children}</>;
  return <SpringIn delay={delay}>{children}</SpringIn>;
}

export default function LoginScreen() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [focusedField, setFocusedField] = useState<'username' | 'email' | 'password' | null>(null);
  const [loading, setLoading] = useState(false);
  const buttonScale = useRef(new Animated.Value(1)).current;
  const usernameInputRef = useRef<TextInput>(null);
  const emailInputRef = useRef<TextInput>(null);
  const passwordInputRef = useRef<TextInput>(null);

  /**
   * The welcome moment: the waveform resolving out of static as the copy
   * arrives. Three states, not two -- 'checking' matters, because rendering
   * the resting screen for a frame and then starting the animation would show
   * the ending before the beginning.
   *
   * Device-local rather than a tutorial_progress row: nobody is signed in on
   * this screen, so there is no auth.uid() to scope one to. See
   * lib/tutorial/welcome.ts.
   */
  const [welcomePhase, setWelcomePhase] = useState<'checking' | 'resolving' | 'rested'>(
    'checking'
  );

  useEffect(() => {
    let active = true;

    void hasSeenWelcome().then((seen) => {
      if (!active) return;
      setWelcomePhase(seen ? 'rested' : 'resolving');
    });

    return () => {
      active = false;
    };
  }, []);

  const handleWelcomeResolved = useCallback(() => {
    setWelcomePhase('rested');
    void markWelcomeSeen();
  }, []);

  const welcomeResolving = welcomePhase === 'resolving';
  const isSignUp = mode === 'signup';

  function animateButton(toValue: number) {
    Animated.spring(buttonScale, {
      toValue,
      useNativeDriver: true,
      speed: 32,
      bounciness: 4,
    }).start();
  }

  async function handleSubmit() {
    if (!email.trim() || !password) {
      Alert.alert('Missing details', 'Enter your email and password.');
      return;
    }

    const usernameValidation = validateUsername(username);

    if (isSignUp && usernameValidation.error) {
      void hapticError();
      Alert.alert('Username needed', usernameValidation.error);
      return;
    }

    setLoading(true);

    if (isSignUp) {
      const { data: existingUsername, error: usernameError } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', usernameValidation.username)
        .maybeSingle();

      if (usernameError) {
        setLoading(false);
        void hapticError();
        Alert.alert('Sign Up Error', 'Could not check that username. Please try again.');
        return;
      }

      if (existingUsername) {
        setLoading(false);
        void hapticError();
        Alert.alert('Username taken', 'That username is already taken.');
        return;
      }
    }

    const { data, error } = isSignUp
      ? await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              username: usernameValidation.username,
            },
          },
        })
      : await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

    setLoading(false);

    if (error) {
      void hapticError();
      if (isSignUp && __DEV__) {
        console.warn('[auth] Sign up failed.', error);
      }

      Alert.alert(
        isSignUp ? 'Sign Up Error' : 'Log In Error',
        isSignUp
          ? 'Account creation couldn’t be completed. Please try again.'
          : error.message
      );
      return;
    }

    if (isSignUp) {
      void success();

      if (!data.session) {
        Alert.alert(
          'Check your email',
          'Confirm your email, then log in to start using Frequency.'
        );
        setMode('login');
        return;
      }

      await ensureProfileForUser(data.session.user, usernameValidation.username);
    } else {
      await ensureProfileForUser(data.session?.user);
    }

    router.replace('/(tabs)');
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {welcomePhase !== 'checking' && (
        <ResolvingWaveform
          resolving={welcomePhase === 'resolving'}
          onResolved={handleWelcomeResolved}
        />
      )}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/*
          Staggered to land with the waveform, not after it: the copy arrives
          while the bars are still settling, so the two read as one moment
          rather than an animation followed by some text. The form comes last
          and is the cue that the screen is ready to be used.
        */}
        <WelcomeIntro active={welcomeResolving} delay={0}>
          <FrequencyBrand logoSize={40} style={styles.brandRow} textStyle={styles.brand} />
        </WelcomeIntro>

        <WelcomeIntro active={welcomeResolving} delay={420}>
          <Text style={styles.title}>Find your frequency.</Text>
        </WelcomeIntro>

        <WelcomeIntro active={welcomeResolving} delay={760}>
          <Text style={styles.subtitle}>Some thoughts are better spoken.</Text>
        </WelcomeIntro>

        <WelcomeIntro active={welcomeResolving} delay={1080}>
          <View style={styles.form}>
          {isSignUp && (
            <View
              style={[
                styles.inputShell,
                focusedField === 'username' && styles.inputShellFocused,
              ]}
              onTouchEnd={() => usernameInputRef.current?.focus()}
            >
              <View pointerEvents="none">
                <Feather name="user" size={18} color={focusedField === 'username' ? C.accent : C.muted} />
              </View>
              <TextInput
                ref={usernameInputRef}
                style={styles.input}
                value={username}
                onChangeText={(value) => setUsername(value.trimStart().toLowerCase())}
                editable
                placeholder="Username"
                placeholderTextColor="#7F8F88"
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="username"
                onFocus={() => setFocusedField('username')}
                onBlur={() => setFocusedField(null)}
              />
            </View>
          )}

          <View
            style={[
              styles.inputShell,
              focusedField === 'email' && styles.inputShellFocused,
            ]}
            onTouchEnd={() => emailInputRef.current?.focus()}
          >
            <View pointerEvents="none">
              <Feather name="mail" size={18} color={focusedField === 'email' ? C.accent : C.muted} />
            </View>
            <TextInput
              ref={emailInputRef}
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              editable
              placeholder="Email"
              placeholderTextColor="#7F8F88"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              onFocus={() => setFocusedField('email')}
              onBlur={() => setFocusedField(null)}
            />
          </View>

          <View
            style={[
              styles.inputShell,
              focusedField === 'password' && styles.inputShellFocused,
            ]}
            onTouchEnd={() => passwordInputRef.current?.focus()}
          >
            <View pointerEvents="none">
              <Feather name="lock" size={18} color={focusedField === 'password' ? C.accent : C.muted} />
            </View>
            <TextInput
              ref={passwordInputRef}
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              editable
              placeholder="Password"
              placeholderTextColor="#7F8F88"
              secureTextEntry
              textContentType="password"
              onFocus={() => setFocusedField('password')}
              onBlur={() => setFocusedField(null)}
            />
          </View>

          <Animated.View style={{ transform: [{ scale: buttonScale }] }}>
            <Pressable
              style={({ pressed }) => [
                styles.button,
                pressed && styles.buttonPressed,
                loading && styles.buttonDisabled,
              ]}
              onPressIn={() => animateButton(0.985)}
              onPressOut={() => animateButton(1)}
              android_ripple={{ color: 'rgba(11, 16, 13, 0.12)' }}
              accessibilityRole="button"
              accessibilityState={{ disabled: loading }}
              accessibilityLabel={isSignUp ? 'Create Account' : 'Log In'}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading ? (
                <FrequencyLogoLoader size={28} />
              ) : (
                <Text style={styles.buttonText}>
                  {isSignUp ? 'Create Account' : 'Log In'}
                </Text>
              )}
            </Pressable>
          </Animated.View>

          <Touchable
            style={styles.secondaryButton}
            activeOpacity={0.78}
            onPress={() => setMode(isSignUp ? 'login' : 'signup')}
            disabled={loading}
          >
            <Text style={styles.secondaryText}>
              {isSignUp ? 'Welcome back. ' : 'New here. '}
              <Text style={styles.secondaryTextStrong}>
                {isSignUp ? 'Log in →' : 'Create account →'}
              </Text>
            </Text>
          </Touchable>
          </View>
        </WelcomeIntro>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.background,
  },

  scroll: {
    zIndex: 1,
    elevation: 1,
  },

  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingTop: 72,
    paddingBottom: 48,
  },

  brandRow: {
    alignSelf: 'flex-start',
    marginBottom: S.xl,
  },

  brand: {
    color: C.accent,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.4,
  },

  title: {
    color: C.text,
    fontSize: 50,
    fontWeight: '900',
    lineHeight: 55,
  },

  subtitle: {
    color: C.accentSoft,
    fontSize: 18,
    marginTop: 10,
    lineHeight: 26,
  },

  form: {
    gap: S.md,
    marginTop: 56,
    zIndex: 2,
    elevation: 2,
  },

  inputShell: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: 'rgba(145, 161, 154, 0.22)',
    backgroundColor: 'rgba(26, 34, 29, 0.86)',
    paddingHorizontal: 18,
  },

  inputShellFocused: {
    borderColor: 'rgba(107, 168, 130, 0.78)',
    backgroundColor: 'rgba(32, 42, 36, 0.94)',
    shadowColor: C.accent,
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },

  input: {
    flex: 1,
    height: '100%',
    color: C.text,
    fontSize: 17,
    paddingVertical: 0,
    zIndex: 3,
    elevation: 3,
  },

  button: {
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: R.lg,
    backgroundColor: C.accent,
    marginTop: S.sm,
    shadowColor: C.accent,
    shadowOpacity: 0.34,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
    overflow: 'hidden',
  },

  buttonPressed: {
    backgroundColor: C.accentSoft,
  },

  buttonDisabled: {
    opacity: 0.72,
  },

  buttonText: {
    color: '#0B100D',
    fontSize: 17,
    fontWeight: '800',
  },

  secondaryButton: {
    alignItems: 'center',
    paddingVertical: 14,
  },

  secondaryText: {
    color: C.muted,
    fontSize: 16,
    fontWeight: '600',
  },

  secondaryTextStrong: {
    color: C.accentSoft,
    fontWeight: '900',
  },
});
