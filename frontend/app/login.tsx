import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, KeyboardAvoidingView, ScrollView, Platform, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { consentVersionKey, isCurrentConsent } from '@/src/consentStorage';
import { theme } from '@/src/theme';
import { trackEvent } from '@/src/analytics';
// NF-UI-REV-05 (Group F, DHARA UI Revision v2.2.1): presentation-only
// rollback flag + visible keyboard-focus ring. Zero changes to login(),
// loginWithGoogle(), continueAsGuest(), validation, or session handling.
import { UI_REVISION_V1 } from '@/src/designRevision';
import { focusRingStyle } from '@/src/a11yFocus';

export default function Login() {
  const { login, loginWithGoogle, continueAsGuest, sessionExpired, clearSessionExpired, accountDeletedNotice, googleError, clearGoogleError } = useAuth();
  const router = useRouter();
  // returnTo: deep-link callers (e.g. GuardianScreen) pass the screen the user
  // should land on after signing in.  router.replace() removes the login screen
  // from the back-stack so pressing Back doesn't loop through the login screen.
  const { returnTo, accountDeleted } = useLocalSearchParams<{ returnTo?: string; accountDeleted?: string }>();
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

  // B-91: arriving here right after deleting the account can race with some
  // other screen's in-flight request on the now-invalid token, which flags
  // sessionExpired and would otherwise show "Your session has expired" --
  // misleading, since the user chose to delete their account. Clear it on
  // mount as a second guard (settings.tsx already clears it before
  // navigating here) so the deliberate-deletion notice below is always what
  // shows, never the session-expired one.
  // B-91 (17 Nov): the link flag can be lost when another redirect reaches
  // /login first, so the auth-state notice counts too.
  const showAccountDeleted = accountDeleted === '1' || accountDeletedNotice;
  useEffect(() => {
    if (showAccountDeleted) clearSessionExpired();
  }, [showAccountDeleted, sessionExpired, clearSessionExpired]);

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
    // 22 Nov (Vivek): a guest is a new person on this device. If nobody has
    // consented since the last sign-out, show the privacy notice first; it
    // starts the guest session after Accept.
    const given = await AsyncStorage.getItem(consentVersionKey(undefined)).catch(() => null);
    if (!isCurrentConsent(given, undefined)) {
      router.push({ pathname: '/consent', params: { next: 'guest' } } as any);
      return;
    }
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
        <Image source={require('../assets/images/dhara_mark.png')} style={styles.logo} resizeMode="contain" />
        <Text style={styles.tag}>Know your rights. Speak them.</Text>

          <View style={styles.card}>
            {/* 21 Nov (Vivek): neutral greeting for new and returning users, centred. */}
            <Text style={[styles.heading, styles.centred]}>Welcome to Dhara</Text>
            <Text style={[styles.sub, styles.centred]}>Sign in or Create an account</Text>

            {showAccountDeleted ? (
              <View style={styles.accountDeletedBanner} testID="account-deleted-banner">
                <Ionicons name="checkmark-circle-outline" size={18} color={theme.colors.brand} />
                <Text style={styles.accountDeletedText}>
                  Your account has been deleted.
                </Text>
              </View>
            ) : sessionExpired && (
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
              placeholderTextColor={UI_REVISION_V1 ? theme.colors.onSurfaceSecondary : theme.colors.onSurfaceTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              accessibilityLabel="Email address"
            />

            <Text style={styles.label}>Password</Text>
            <View style={styles.pwWrap}>
              <TextInput
                testID="login-password-input"
                style={styles.pwInput}
                value={password}
                onChangeText={setPassword}
                // 21 Nov (Vivek): empty box, no dot placeholder; typed text is still hidden.
                secureTextEntry={!showPassword}
                accessibilityLabel="Password"
              />
              <Pressable
                testID="toggle-password-visibility"
                onPress={() => setShowPassword(v => !v)}
                hitSlop={8}
                style={(s) => [styles.eyeBtn, focusRingStyle(s)]}
                accessibilityRole="button"
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                accessibilityState={{ expanded: showPassword }}
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
                <Pressable onPress={() => router.push('/emergency')} accessibilityRole="button" accessibilityLabel="Emergency helplines" style={(s) => [focusRingStyle(s)]} hitSlop={8}>
                  <Text style={{ color: theme.colors.primary, fontWeight: '600' }}>Emergency helplines</Text>
                </Pressable>
              </View>
            )}

            <Pressable
              testID="login-submit-button"
              style={(s) => [styles.btn, loading && { opacity: 0.6 }, focusRingStyle(s)]}
              disabled={loading}
              onPress={onSubmit}
              accessibilityRole="button"
              accessibilityLabel="Sign in"
              accessibilityState={{ disabled: loading, busy: loading }}
            >
              {loading ? <ActivityIndicator color={theme.colors.onBrandPrimary} /> : <Text style={styles.btnText}>Sign In</Text>}
            </Pressable>

            {/* 21 Nov (Vivek): Forgot password sits right under Sign In. */}
            {/* The wrapper carries the layout: on web, Link asChild drops a
                Pressable's style function, so it was never centred or spaced. */}
            <View style={styles.forgotWrap}>
              <Link href="/forgot-password" asChild>
                <Pressable testID="go-to-forgot-password" style={(s) => [styles.forgotTap, focusRingStyle(s)]} accessibilityRole="link" accessibilityLabel="Forgot password?">
                  <Text style={styles.forgotLink}>Forgot password?</Text>
                </Pressable>
              </Link>
            </View>

            {/* ── Divider ── */}
            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* ── Google Sign-In ── */}
            <Pressable
              testID="google-signin-button"
              style={(s) => [styles.googleBtn, googleLoading && { opacity: 0.6 }, focusRingStyle(s)]}
              disabled={googleLoading}
              onPress={onGoogleSignIn}
              accessibilityRole="button"
              accessibilityLabel="Continue with Google"
              accessibilityState={{ disabled: googleLoading, busy: googleLoading }}
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

            <View style={styles.row}>
              <Text style={styles.rowLead}>New here? </Text>
              <Link href="/signup" asChild>
                <Pressable testID="go-to-signup" style={(s) => [styles.signupLink, focusRingStyle(s)]} accessibilityRole="link" accessibilityLabel="Create an account"><Text style={styles.link}>Create an account</Text></Pressable>
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
              style={(s) => [styles.guestBtn, guestLoading && { opacity: 0.6 }, focusRingStyle(s)]}
              disabled={guestLoading}
              onPress={onGuestContinue}
              accessibilityRole="button"
              accessibilityLabel="Continue as guest"
              accessibilityState={{ disabled: guestLoading, busy: guestLoading }}
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
  // DHARA icon mark — 1024×1024 transparent RGBA PNG; renders directly on navy background
  logo: { width: 160, height: 160, alignSelf: 'center', marginBottom: 8 },
  brand: { fontFamily: theme.fonts.display, fontSize: 36, color: theme.colors.onBrandPrimary, textAlign: 'center', fontWeight: '700' },
  // Tagline: gold-on-navy — 6.29:1 ✅ WCAG AA
  tag: { color: theme.dhara.gold, textAlign: 'center', marginTop: 8, fontSize: 13, fontWeight: '600' },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, padding: theme.spacing.xl, marginTop: theme.spacing.xxl },
  heading: { fontFamily: theme.fonts.display, fontSize: 21, color: theme.colors.onSurface, fontWeight: '700' },
  sub: { color: theme.colors.onSurfaceSecondary, marginTop: 4 },
  centred: { textAlign: 'center' },
  label: { color: theme.colors.onSurfaceSecondary, marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, padding: theme.spacing.md, fontSize: 14, color: theme.colors.onSurface, backgroundColor: theme.colors.surfaceSecondary },
  pwWrap: { flexDirection: 'row', alignItems: 'center', overflow: 'hidden', borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceSecondary },
  // minWidth 0 lets the field shrink, so the eye button stays inside the box.
  pwInput: { flex: 1, minWidth: 0, padding: theme.spacing.md, fontSize: 14, color: theme.colors.onSurface },
  eyeBtn: { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.md, justifyContent: 'center', alignItems: 'center' },
  btn: { backgroundColor: theme.colors.brand, padding: theme.spacing.lg, borderRadius: theme.radius.md, alignItems: 'center', marginTop: theme.spacing.xl, minHeight: 52 },
  btnText: { color: theme.colors.onBrandPrimary, fontWeight: '700', fontSize: 14 },
  // 21 Nov: 16px (spacing.lg) between each element below Sign In.
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginTop: theme.spacing.lg, marginBottom: theme.spacing.lg, gap: 8 },
  dividerLine: { flex: 1, height: 1, backgroundColor: theme.colors.border },
  dividerText: { color: theme.colors.onSurfaceTertiary, fontSize: 12, fontWeight: '500' },
  googleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderWidth: 1.5, borderColor: theme.colors.border, borderRadius: theme.radius.md, padding: theme.spacing.lg, minHeight: 52, backgroundColor: theme.colors.surface },
  googleBtnText: { color: theme.colors.onSurface, fontWeight: '600', fontSize: 13 },
  // 21 Nov: centre the row so the plain text and the link sit on one line.
  row: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: theme.spacing.lg },
  rowLead: { color: theme.colors.onSurfaceSecondary },
  // "Create an account" link: navy-on-cream — 11.92:1 ✅ + underline for link affordance
  link: { color: theme.dhara.textPrimary, fontWeight: '700', textDecorationLine: 'underline' },
  // 21 Nov: centred under Sign In, with a little more space above it.
  forgotWrap: { alignItems: 'center', justifyContent: 'center', marginTop: theme.spacing.lg },
  forgotTap: { padding: 6, minHeight: UI_REVISION_V1 ? 44 : undefined, justifyContent: 'center' },
  // "Forgot password?": navy-on-cream — 11.92:1 ✅ (already had underline)
  forgotLink: { color: theme.dhara.textPrimary, fontWeight: '600', fontSize: 13, textDecorationLine: 'underline' },
  // NF-UI-REV-05: this link had zero padding/touch-target before — under 44px.
  signupLink: { minHeight: UI_REVISION_V1 ? 44 : undefined, justifyContent: 'center', paddingVertical: 6 },
  error: { color: theme.colors.error, marginTop: theme.spacing.md },
  guestCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    marginTop: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  guestHeading: { fontFamily: theme.fonts.display, fontSize: 15, color: theme.colors.onSurface, fontWeight: '700', textAlign: 'center' },
  guestBody: { color: theme.colors.onSurfaceSecondary, fontSize: 12, textAlign: 'center', marginTop: theme.spacing.sm, lineHeight: 16 },
  guestBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderColor: theme.colors.border, borderRadius: theme.radius.md, padding: theme.spacing.md, minHeight: 48, marginTop: theme.spacing.md, backgroundColor: theme.colors.surfaceSecondary },
  guestBtnText: { color: theme.colors.onSurface, fontWeight: '700', fontSize: 13 },
  sessionExpiredBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    backgroundColor: '#FDECEA',
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginTop: theme.spacing.md,
  },
  sessionExpiredText: { color: theme.colors.error, flex: 1, fontSize: 12, fontWeight: '600' },
  accountDeletedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    backgroundColor: '#F0FDF4',
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginTop: theme.spacing.md,
  },
  accountDeletedText: { color: theme.colors.brand, flex: 1, fontSize: 12, fontWeight: '600' },
  // Footer Sanskrit: gold-on-navy — 6.29:1 ✅
  footer: { textAlign: 'center', color: theme.dhara.gold, marginTop: theme.spacing.xxl, letterSpacing: 2 },
  // Copyright: textOnNavyMuted (gold) on navy — 6.29:1 ✅  — NOT a raw gray (#8A93A6 fails)
  copyright: { textAlign: 'center', color: theme.dhara.textOnNavyMuted, marginTop: theme.spacing.md, fontSize: 12, letterSpacing: 0.5 },
});
