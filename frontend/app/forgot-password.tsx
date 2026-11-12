import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { crossAlert } from '@/src/utils/crossAlert';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE, useAuth } from '@/src/auth';
import { theme } from '@/src/theme';
import { passwordMeetsRule, PASSWORD_RULE_MSG } from '@/src/passwordRule';
import { PasswordLabelWithRules } from '@/src/components/PasswordLabelWithRules';

/**
 * Password reset in two steps:
 *   1. Enter the account email  → backend emails a 6-digit code
 *   2. Enter the code + a new password → backend verifies and signs you in
 *
 * The old flow accepted email + registered phone and reset the password on the
 * spot, which meant anyone who knew both could take over the account.
 */
export default function ForgotPassword() {
  const router = useRouter();
  const { hydrateSession } = useAuth();
  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const requestCode = async () => {
    setError(null);
    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.detail || 'Could not send the code. Please try again.');
        return;
      }
      setNotice(data?.message || 'Check your email for a 6-digit code.');
      setStep('verify');
    } catch (e: any) {
      setError(e?.message || 'Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const submitNewPassword = async () => {
    setError(null);
    if (code.trim().length < 4) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    if (!passwordMeetsRule(newPassword)) {
      setError(PASSWORD_RULE_MSG);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          code: code.trim(),
          new_password: newPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.detail || 'Reset failed. Please try again.');
        return;
      }
      if (hydrateSession) {
        await hydrateSession(data.token, data.user);
      }
      crossAlert(
        'Password reset',
        'Your password has been updated. You are now signed in.',
        [{ text: 'OK', onPress: () => router.replace('/(tabs)') }],
      );
    } catch (e: any) {
      setError(e?.message || 'Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} testID="forgot-password-screen">
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
      >
        <Pressable onPress={() => router.back()} style={styles.back} testID="fp-back">
          <Ionicons name="chevron-back" size={22} color={theme.colors.onBrandPrimary} />
          <Text style={styles.backText}>Back to sign in</Text>
        </Pressable>

        <Text style={styles.brand}>Dhara</Text>
        <Text style={styles.tag}>Reset your password</Text>

        <View style={styles.card}>
          {step === 'request' ? (
            <>
              <Text style={styles.heading}>Forgot password?</Text>
              <Text style={styles.sub}>
                Enter the email you signed up with. We will send you a 6-digit code to
                confirm it is really you.
              </Text>

              <Text style={styles.label}>Email</Text>
              <TextInput
                testID="fp-email-input"
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={theme.colors.onSurfaceTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
              />

              {error && (
                <Text style={styles.error} testID="fp-error">
                  {error}
                </Text>
              )}

              <Pressable
                testID="fp-send-code-button"
                style={[styles.btn, loading && { opacity: 0.6 }]}
                disabled={loading}
                onPress={requestCode}
              >
                {loading ? (
                  <ActivityIndicator color={theme.colors.onBrandPrimary} />
                ) : (
                  <Text style={styles.btnText}>Send me a code</Text>
                )}
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.heading}>Enter your code</Text>
              <Text style={styles.sub}>
                {notice || 'Check your email for a 6-digit code.'}
              </Text>
              <Text style={styles.sub}>
                Sent to {email.trim().toLowerCase()} · expires in 10 minutes.
              </Text>

              <Text style={styles.label}>6-digit code</Text>
              <TextInput
                testID="fp-code-input"
                style={[styles.input, styles.codeInput]}
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                placeholderTextColor={theme.colors.onSurfaceTertiary}
                keyboardType="number-pad"
                maxLength={6}
              />

              <PasswordLabelWithRules label="New password" password={newPassword} labelStyle={styles.label} />
              <TextInput
                testID="fp-new-password-input"
                style={styles.input}
                value={newPassword}
                onChangeText={setNewPassword}
                placeholder="••••••••"
                placeholderTextColor={theme.colors.onSurfaceTertiary}
                secureTextEntry
              />

              <Text style={styles.label}>Confirm new password</Text>
              <TextInput
                testID="fp-confirm-password-input"
                style={styles.input}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="••••••••"
                placeholderTextColor={theme.colors.onSurfaceTertiary}
                secureTextEntry
              />

              {error && (
                <Text style={styles.error} testID="fp-error">
                  {error}
                </Text>
              )}

              <Pressable
                testID="fp-submit-button"
                style={[styles.btn, loading && { opacity: 0.6 }]}
                disabled={loading}
                onPress={submitNewPassword}
              >
                {loading ? (
                  <ActivityIndicator color={theme.colors.onBrandPrimary} />
                ) : (
                  <Text style={styles.btnText}>Set new password & sign in</Text>
                )}
              </Pressable>

              <Pressable
                testID="fp-resend-button"
                style={styles.secondaryBtn}
                disabled={loading}
                onPress={requestCode}
              >
                <Text style={styles.link}>{'Didn\u2019t get it? Send again'}</Text>
              </Pressable>
            </>
          )}

          <View style={styles.row}>
            <Text style={styles.sub}>Remembered it? </Text>
            <Link href="/login" asChild>
              <Pressable testID="go-to-login">
                <Text style={styles.link}>Back to sign in</Text>
              </Pressable>
            </Link>
          </View>
        </View>

        <Text style={styles.footer}>सत्य • अहिंसा • अधिकार</Text>
        <Text style={styles.copyright}>
          © {new Date().getFullYear()} Callistus Moses · An Msafe product
        </Text>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.brand },
  scroll: { flexGrow: 1, padding: theme.spacing.xl, paddingTop: theme.spacing.lg },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6 },
  backText: { color: theme.colors.onBrandPrimary, fontSize: 14, fontWeight: '600' },
  brand: {
    fontFamily: theme.fonts.display,
    fontSize: 36,
    color: theme.colors.onBrandPrimary,
    textAlign: 'center',
    fontWeight: '700',
    marginTop: theme.spacing.lg,
  },
  tag: { color: theme.colors.brandSecondary, textAlign: 'center', marginTop: 4, fontSize: 14 },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.xl,
    marginTop: theme.spacing.xl,
  },
  heading: {
    fontFamily: theme.fonts.display,
    fontSize: 22,
    color: theme.colors.onSurface,
    fontWeight: '700',
  },
  sub: { color: theme.colors.onSurfaceSecondary, marginTop: 6, lineHeight: 20 },
  label: {
    color: theme.colors.onSurfaceSecondary,
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    fontSize: 16,
    color: theme.colors.onSurface,
    backgroundColor: theme.colors.surfaceSecondary,
  },
  codeInput: { fontSize: 24, letterSpacing: 8, textAlign: 'center', fontWeight: '700' },
  btn: {
    backgroundColor: theme.colors.brand,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    marginTop: theme.spacing.xl,
    minHeight: 52,
  },
  btnText: { color: theme.colors.onBrandPrimary, fontWeight: '700', fontSize: 15 },
  secondaryBtn: { alignItems: 'center', paddingVertical: theme.spacing.md, minHeight: 44 },
  row: { flexDirection: 'row', justifyContent: 'center', marginTop: theme.spacing.lg },
  link: { color: theme.colors.brandSecondary, fontWeight: '700' },
  error: { color: theme.colors.error, marginTop: theme.spacing.md, fontSize: 13 },
  footer: {
    textAlign: 'center',
    color: theme.colors.brandSecondary,
    marginTop: theme.spacing.xxl,
    letterSpacing: 2,
  },
  copyright: {
    textAlign: 'center',
    color: '#8A93A6',
    marginTop: theme.spacing.md,
    fontSize: 11,
    letterSpacing: 0.5,
  },
});
