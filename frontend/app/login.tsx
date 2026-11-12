import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, KeyboardAvoidingView, ScrollView, Platform, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';
import { trackEvent } from '@/src/analytics';

export default function Login() {
  const { login, loginWithGoogle, continueAsGuest, sessionExpired, clearSessionExpired, googleError, clearGoogleError } = useAuth();
  const router = useRouter();
  // returnTo: deep-link callers (e.g. GuardianScreen) pass the screen the user
  // should land on after signing in.  router.replace() removes the login screen
  // from the back-stack so pressing Back doesn't loop through the login screen.
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const _postLoginNav = () => router.replace((returnTo as any) || '/(tabs)/home');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minorBlocked, setMinorBlocked] = useState(false);
  // W1-J04: show why a Google sign-in on the web did not complete.
  useEffect(() => {
    if (!googleError) return;
    setError(googleError.message);
    setMinorBlocked(googleError.minor);
    clearGoogleError();
  }, [googleError, clearGoogleError]);

  const onSubmit = async () => {
    setError(null);
    // W1-J03: check the form first. An empty or malformed entry used to reach
    // the server, show a technical validation message, and (empty password)
    // count as a failed attempt towards the 5-try lock.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Please enter a valid email address.'); return; }
    if (!password) { setError('Please enter your password.'); return; }
    clearSessionExpired();
    setLoading(true);
    try {
      await login(email.trim(), password);
      _postLoginNav();
    } catch (e: any) {
      setMinorBlocked(e?.code === 'minor_blocked');
      setError(e?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const onGoogleSignIn = async () => {
    setError(null);
    clearSessionExpired();
    setGoogleLoading(true);
    try {
      // W1-J04: only move on when sign-in finished; cancelling the Google
      // chooser now simply stays on this screen.
      if (await loginWithGoogle()) _postLoginNav();
    } catch (e: any) {
      setMinorBlocked(e?.code === 'minor_blocked');
      setError(e?.message || 'Google sign-in failed');
    } finally {
      setGoogleLoading(false);
    }
  };

  const onGuestContinue = async () => {
    setError(null);
    clearSessionExpired();
    setGuestLoading(true);
    try {
      await continueAsGuest();
      trackEvent('guest_started');
      _postLoginNav();
    } catch (e: any) {
      setError(e?.message || 'Could not start guest session');
    } finally {
      setGuestLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} testID="login-screen">
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
        <Image source={require('../assets/images/dhara_logo_full.png')} style={styles.logo} resizeMode="contain" />
        <Text style={styles.tag}>Know your rights. Speak them.</Text>

          <View style={styles.card}>
            <Text style={styles.heading}>Welcome back</Text>
            <Text style={styles.sub}>Sign in to continue</Text>

            {sessionExpired && (
              <View style={styles.sessionExpiredBanner} testID="session-expired-banner">
                <Ionicons name="alert-circle-outline" size={18} color={theme.colors.error} />
                <Text style={styles.sessionExpiredText}>
                  Your session has expired — please sign in again.
                </Text>
              </View>
            )}

            <Text style={styles.label}>Email</Text>
            <TextInput
              testID="login-email-input"
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={theme.colors.onSurfaceTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
            />

            <Text style={styles.label}>Password</Text>
            <View style={styles.pwWrap}>
              <TextInput
                testID="login-password-input"
                style={styles.pwInput}
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor={theme.colors.onSurfaceTertiary}
                secureTextEntry={!showPassword}
              />
              <Pressable
                testID="toggle-password-visibility"
                onPress={() => setShowPassword(v => !v)}
                hitSlop={8}
                style={styles.eyeBtn}
              >
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color={theme.colors.onSurfaceTertiary}
                />
              </Pressable>
            </View>

            {error && <Text style={styles.error} testID="login-error">{error}</Text>}
            {minorBlocked && (
              <View testID="login-minor-help" style={{ flexDirection: 'row', gap: 16, marginTop: 8 }}>
                <Pressable onPress={() => router.push('/emergency')} accessibilityRole="button" accessibilityLabel="Emergency helplines">
                  <Text style={{ color: theme.colors.primary, fontWeight: '600' }}>Emergency helplines</Text>
                </Pressable>
              </View>
            )}

            <Pressable testID="login-submit-button" style={[styles.btn, loading && { opacity: 0.6 }]} disabled={loading} onPress={onSubmit}>
              {loading ? <ActivityIndicator color={theme.colors.onBrandPrimary} /> : <Text style={styles.btnText}>Sign In</Text>}
            </Pressable>

            {/* ── Divider ── */}
            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* ── Google Sign-In ── */}
            <Pressable
              testID="google-signin-button"
              style={[styles.googleBtn, googleLoading && { opacity: 0.6 }]}
              disabled={googleLoading}
              onPress={onGoogleSignIn}
            >
              {googleLoading ? (
                <ActivityIndicator color={theme.colors.onSurface} size="small" />
              ) : (
                <>
                  <Ionicons name="logo-google" size={20} color="#DB4437" />
                  <Text style={styles.googleBtnText}>Continue with Google</Text>
                </>
              )}
            </Pressable>

            <Link href="/forgot-password" asChild>
              <Pressable testID="go-to-forgot-password" style={styles.forgotWrap}>
                <Text style={styles.forgotLink}>Forgot password?</Text>
              </Pressable>
            </Link>

            <View style={styles.row}>
              <Text style={styles.sub}>New here? </Text>
              <Link href="/signup" asChild>
                <Pressable testID="go-to-signup"><Text style={styles.link}>Create an account</Text></Pressable>
              </Link>
            </View>
          </View>

          {/* ── Guest Mode ── */}
          <View style={styles.guestCard} testID="guest-mode-card">
            <Text style={styles.guestHeading}>Try DHARA without signing up</Text>
            <Text style={styles.guestBody}>
              Ask up to 5 legal questions as a guest. Create a free account anytime to save your conversations and documents.
            </Text>
            <Pressable
              testID="continue-as-guest-button"
              style={[styles.guestBtn, guestLoading && { opacity: 0.6 }]}
              disabled={guestLoading}
              onPress={onGuestContinue}
            >
              {guestLoading ? (
                <ActivityIndicator color={theme.colors.onSurface} size="small" />
              ) : (
                <>
                  <Ionicons name="person-outline" size={18} color={theme.colors.onSurface} />
                  <Text style={styles.guestBtnText}>Continue as Guest</Text>
                </>
              )}
            </Pressable>
          </View>

          <Text style={styles.footer}>सत्य • अहिंसा • अधिकार</Text>
          <Text testID="login-copyright" style={styles.copyright}>© {new Date().getFullYear()} Callistus Moses · An Msafe product</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.dhara.navy },
  scroll: { flexGrow: 1, padding: theme.spacing.xl, justifyContent: 'center' },
  // Full DHARA logo — wider than tall, no borderRadius needed
  logo: { width: 200, height: 200, alignSelf: 'center', marginBottom: 8 },
  brand: { fontFamily: theme.fonts.display, fontSize: 44, color: theme.colors.onBrandPrimary, textAlign: 'center', fontWeight: '700' },
  // Tagline: gold-on-navy — 6.29:1 ✅ WCAG AA
  tag: { color: theme.dhara.gold, textAlign: 'center', marginTop: 8, fontSize: 15, fontWeight: '600' },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, padding: theme.spacing.xl, marginTop: theme.spacing.xxl },
  heading: { fontFamily: theme.fonts.display, fontSize: 24, color: theme.colors.onSurface, fontWeight: '700' },
  sub: { color: theme.colors.onSurfaceSecondary, marginTop: 4 },
  label: { color: theme.colors.onSurfaceSecondary, marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, padding: theme.spacing.md, fontSize: 16, color: theme.colors.onSurface, backgroundColor: theme.colors.surfaceSecondary },
  pwWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceSecondary },
  pwInput: { flex: 1, padding: theme.spacing.md, fontSize: 16, color: theme.colors.onSurface },
  eyeBtn: { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.md, justifyContent: 'center', alignItems: 'center' },
  btn: { backgroundColor: theme.colors.brand, padding: theme.spacing.lg, borderRadius: theme.radius.md, alignItems: 'center', marginTop: theme.spacing.xl, minHeight: 52 },
  btnText: { color: theme.colors.onBrandPrimary, fontWeight: '700', fontSize: 16 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginTop: theme.spacing.lg, gap: 8 },
  dividerLine: { flex: 1, height: 1, backgroundColor: theme.colors.border },
  dividerText: { color: theme.colors.onSurfaceTertiary, fontSize: 13, fontWeight: '500' },
  googleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderWidth: 1.5, borderColor: theme.colors.border, borderRadius: theme.radius.md, padding: theme.spacing.lg, minHeight: 52, backgroundColor: theme.colors.surface },
  googleBtnText: { color: theme.colors.onSurface, fontWeight: '600', fontSize: 15 },
  row: { flexDirection: 'row', justifyContent: 'center', marginTop: theme.spacing.lg },
  // "Create an account" link: navy-on-cream — 11.92:1 ✅ + underline for link affordance
  link: { color: theme.dhara.textPrimary, fontWeight: '700', textDecorationLine: 'underline' },
  forgotWrap: { alignItems: 'center', marginTop: theme.spacing.md, padding: 6 },
  // "Forgot password?": navy-on-cream — 11.92:1 ✅ (already had underline)
  forgotLink: { color: theme.dhara.textPrimary, fontWeight: '600', fontSize: 14, textDecorationLine: 'underline' },
  error: { color: theme.colors.error, marginTop: theme.spacing.md },
  guestCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    marginTop: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  guestHeading: { fontFamily: theme.fonts.display, fontSize: 17, color: theme.colors.onSurface, fontWeight: '700', textAlign: 'center' },
  guestBody: { color: theme.colors.onSurfaceSecondary, fontSize: 13, textAlign: 'center', marginTop: theme.spacing.sm, lineHeight: 18 },
  guestBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderColor: theme.colors.border, borderRadius: theme.radius.md, padding: theme.spacing.md, minHeight: 48, marginTop: theme.spacing.md, backgroundColor: theme.colors.surfaceSecondary },
  guestBtnText: { color: theme.colors.onSurface, fontWeight: '700', fontSize: 15 },
  sessionExpiredBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    backgroundColor: '#FDECEA',
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginTop: theme.spacing.md,
  },
  sessionExpiredText: { color: theme.colors.error, flex: 1, fontSize: 13, fontWeight: '600' },
  // Footer Sanskrit: gold-on-navy — 6.29:1 ✅
  footer: { textAlign: 'center', color: theme.dhara.gold, marginTop: theme.spacing.xxl, letterSpacing: 2 },
  // Copyright: textOnNavyMuted (gold) on navy — 6.29:1 ✅  — NOT a raw gray (#8A93A6 fails)
  copyright: { textAlign: 'center', color: theme.dhara.textOnNavyMuted, marginTop: theme.spacing.md, fontSize: 11, letterSpacing: 0.5 },
});
