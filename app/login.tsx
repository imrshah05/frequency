import { Feather } from '@expo/vector-icons';
import { useRef, useState } from 'react';
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
      // Asked through an RPC rather than by reading profiles. Nobody is signed
      // in at this point and the profiles read policy is authenticated-only, so
      // the select this replaces returned zero rows for every candidate --
      // reporting "available" even for names that were taken. It never errored,
      // because RLS hides rows rather than refusing the query, which is why it
      // went unnoticed until two accounts had been created with no username.
      const { data: isAvailable, error: usernameError } = await supabase.rpc(
        'is_username_available',
        { candidate: usernameValidation.username }
      );

      if (usernameError) {
        setLoading(false);
        void hapticError();
        Alert.alert('Sign Up Error', 'Could not check that username. Please try again.');
        return;
      }

      // Only a definite false stops the signup. This check is advisory --
      // handle_new_user is the authority and now refuses a duplicate outright
      // rather than blanking it -- so an unexpected answer should not block
      // someone whose name is genuinely free.
      if (isAvailable === false) {
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
      <ResolvingWaveform resolving={false} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <FrequencyBrand logoSize={40} style={styles.brandRow} textStyle={styles.brand} />

        <Text style={styles.title}>Find your frequency.</Text>
        <Text style={styles.subtitle}>Some thoughts are better spoken.</Text>

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
