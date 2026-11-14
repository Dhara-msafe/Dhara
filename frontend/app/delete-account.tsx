import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE, useAuth } from '@/src/auth';
import { theme } from '@/src/theme';

/**
 * Public, unauthenticated account-deletion page — reachable without signing
 * in, for anyone who has already uninstalled the app but still wants their
 * data erased (Google Play "Account deletion" requirement).
 *
 * Two steps, mirroring /forgot-password's OTP pattern:
 *   1. Enter the account email  → backend emails a 6-digit code
 *   2. Enter the code + confirm → backend verifies and permanently deletes
 *      the account and every row linked to it. No recovery window.
 */
// B-29: raw thrown-error text (e.g. "Network request failed" / "TypeError:
// Failed to fetch") used to reach the user verbatim on a dropped connection.
// Same pattern as forgot-password.tsx's postJson / auth.tsx's _fetchAuth:
// a bounded timeout and a friendly message for anything fetch() itself threw.
const NETWORK_MSG = 'Could not reach DHARA. Check your internet connection and try again.';
async function postJson(path: string, body: unknown): Promise<{ res: Response; data: any }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch {
    throw new Error(NETWORK_MSG);
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => null);
  return { res, data };
}

export default function DeleteAccount() {
  const [step, setStep] = useState<'request' | 'verify' | 'done'>('request');
  const params = useLocalSearchParams<{ email?: string }>();
  const { token, logout, clearSessionExpired } = useAuth();
  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : '');
  const [code, setCode] = useState('');
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const requestCode = async () => {
    setError(null);
    if (!email.trim()) {
      setError('Please enter your account email address.');
      return;
    }
    setLoading(true);
    try {
      const { res, data } = await postJson('/api/account-deletion/request-otp', { email: email.trim().toLowerCase() });
      if (!res.ok) {
        setError(data?.detail || 'Could not send the code. Please try again.');
        return;
      }
      setNotice(data?.message || 'Check your email for a 6-digit code.');
      setStep('verify');
    } catch (e: any) {
      setError(e?.message || NETWORK_MSG);
    } finally {
      setLoading(false);
    }
  };

  const confirmDelete = async () => {
    setError(null);
    if (code.trim().length < 4) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    if (!confirmChecked) {
      setError('Please confirm you understand this cannot be undone.');
      return;
    }
    setLoading(true);
    try {
      const { res, data } = await postJson('/api/account-deletion/verify', { email: email.trim().toLowerCase(), code: code.trim() });
      if (!res.ok) {
        setError(data?.detail || 'Deletion failed. Please try again.');
        return;
      }
      setStep('done');
      // B-91: this screen stays open after deletion (no redirect to /login),
      // but if the user does navigate there afterwards, any other screen's
      // in-flight call on this now-invalid token can race in a 401 and flag
      // sessionExpired, showing "Your session has expired" -- misleading,
      // since the user chose to delete their account. Clear it here too.
      if (token) {
        await logout().catch(() => {});
        clearSessionExpired();
      }
    } catch (e: any) {
      setError(e?.message || NETWORK_MSG);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} testID="delete-account-screen">
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
      >
        <Text style={styles.brand}>Dhara</Text>
        <Text style={styles.tag}>Delete your account</Text>

        <View style={styles.card}>
          {step === 'request' && (
            <>
              <Text style={styles.heading}>Delete your Dhara account</Text>
              <Text style={styles.sub}>
                This permanently deletes your account, chat history, bookmarks, drafts and
                usage data. This cannot be undone. Enter the email on your account and we
                will send you a 6-digit code to confirm it is really you.
              </Text>

              <Text style={styles.label}>Email</Text>
              <TextInput
                testID="da-email-input"
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
                <Text style={styles.error} testID="da-error">
                  {error}
                </Text>
              )}

              <Pressable
                testID="da-send-code-button"
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
          )}

          {step === 'verify' && (
            <>
              <Text style={styles.heading}>Confirm deletion</Text>
              <Text style={styles.sub}>
                {notice || 'Check your email for a 6-digit code.'}
              </Text>
              <Text style={styles.sub}>
                Sent to {email.trim().toLowerCase()} · expires in 10 minutes.
              </Text>

              <Text style={styles.label}>6-digit code</Text>
              <TextInput
                testID="da-code-input"
                style={[styles.input, styles.codeInput]}
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                placeholderTextColor={theme.colors.onSurfaceTertiary}
                keyboardType="number-pad"
                maxLength={6}
              />

              <Pressable
                testID="da-confirm-checkbox"
                style={styles.checkRow}
                onPress={() => setConfirmChecked(!confirmChecked)}
              >
                <View style={[styles.checkbox, confirmChecked && styles.checkboxChecked]}>
                  {confirmChecked && <Ionicons name="checkmark" size={14} color={theme.colors.onBrandPrimary} />}
                </View>
                <Text style={styles.checkLabel}>
                  I understand this permanently deletes my account and all my data, and
                  cannot be undone.
                </Text>
              </Pressable>

              {error && (
                <Text style={styles.error} testID="da-error">
                  {error}
                </Text>
              )}

              <Pressable
                testID="da-delete-button"
                style={[styles.dangerBtn, loading && { opacity: 0.6 }]}
                disabled={loading}
                onPress={confirmDelete}
              >
                {loading ? (
                  <ActivityIndicator color={theme.colors.onBrandPrimary} />
                ) : (
                  <Text style={styles.btnText}>Permanently delete my account</Text>
                )}
              </Pressable>

              <Pressable
                testID="da-resend-button"
                style={styles.secondaryBtn}
                disabled={loading}
                onPress={requestCode}
              >
                <Text style={styles.link}>{'Didn\u2019t get it? Send again'}</Text>
              </Pressable>
            </>
          )}

          {step === 'done' && (
            <>
              <View style={styles.doneIcon}>
                <Ionicons name="checkmark-circle" size={44} color={theme.colors.brand} />
              </View>
              <Text style={styles.heading}>Account deleted</Text>
              <Text style={styles.sub}>
                Your Dhara account and all associated data have been permanently deleted.
                You can close this page.
              </Text>
            </>
          )}

          {step !== 'done' && (
            <View style={styles.row}>
              <Text style={styles.sub}>Changed your mind? </Text>
              <Link href="/login" asChild>
                <Pressable testID="go-to-login">
                  <Text style={styles.link}>Back to sign in</Text>
                </Pressable>
              </Link>
            </View>
          )}
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
  scroll: { flexGrow: 1, padding: theme.spacing.xl, paddingTop: theme.spacing.xxl },
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
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: theme.spacing.lg },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: { backgroundColor: theme.colors.error, borderColor: theme.colors.error },
  checkLabel: { flex: 1, color: theme.colors.onSurfaceSecondary, fontSize: 13, lineHeight: 18 },
  btn: {
    backgroundColor: theme.colors.brand,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    marginTop: theme.spacing.xl,
    minHeight: 52,
  },
  dangerBtn: {
    backgroundColor: theme.colors.error,
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
  doneIcon: { alignItems: 'center', marginBottom: theme.spacing.md },
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
