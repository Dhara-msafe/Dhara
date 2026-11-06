import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Image,
  Linking,
  Platform,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE } from '@/src/auth';
import { theme } from '@/src/theme';

/**
 * DHARA Pro — UPI Payment Page (Phase 1, outside the app).
 *
 * Reachable ONLY by a direct link shared outside the app (chat, SMS, email,
 * a website) — nothing inside the shipped mobile app links here. This keeps
 * the live app itself free of any in-app digital-purchase flow, which is a
 * store-compliance requirement (see Batch FREE-V1-001).
 *
 * Flow: show price + UPI QR/link -> user pays in their own UPI app -> user
 * submits their UTR + account email here -> an operator checks it against
 * their own UPI history and confirms -> account flips to Pro (same is_pro
 * mechanism Stripe/Razorpay already use).
 */

type Config = {
  configured: boolean;
  vpa: string | null;
  payee_name: string;
  amount_label: string;
  upi_uri: string | null;
};

export default function PayUpi() {
  const [config, setConfig] = useState<Config | null>(null);
  const [configLoading, setConfigLoading] = useState(true);

  const [email, setEmail] = useState('');
  const [utr, setUtr] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/billing/upi/config`);
        const data = await res.json();
        setConfig(data);
      } catch {
        setConfig({ configured: false, vpa: null, payee_name: 'DHARA', amount_label: '', upi_uri: null });
      } finally {
        setConfigLoading(false);
      }
    })();
  }, []);

  const payWithUpiApp = () => {
    if (!config?.upi_uri) return;
    Linking.openURL(config.upi_uri).catch(() => {
      setError('Could not open a UPI app. Please scan the QR code with any UPI app instead.');
    });
  };

  const submit = async () => {
    setError(null);
    if (!email.trim()) { setError('Please enter the email on your DHARA account.'); return; }
    if (!utr.trim()) { setError('Please enter your UPI payment reference number (UTR).'); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/billing/upi/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), utr: utr.trim(), note: note.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.detail || 'Could not submit. Please check your details and try again.');
        return;
      }
      setDone(true);
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // This page is meant to be opened outside the app, in a phone's browser.
  // If it's somehow reached from inside the native app (it is never linked
  // there), keep it inert rather than showing a payment UI.
  if (Platform.OS !== 'web') {
    return (
      <SafeAreaView style={styles.safe} testID="pay-upi-native-blocked">
        <View style={styles.scroll}>
          <Text style={styles.brand}>Dhara</Text>
          <View style={styles.card}>
            <Ionicons name="globe-outline" size={32} color={theme.colors.brand} />
            <Text style={styles.heading}>Open this link in your browser</Text>
            <Text style={styles.sub}>
              This payment page is only available in a web browser. Please open the link we
              sent you using your phone&apos;s browser (Chrome, Safari, etc.), not inside the app.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} testID="pay-upi-screen">
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
      >
        <Text style={styles.brand}>Dhara</Text>
        <Text style={styles.tag}>Upgrade to Dhara Pro — pay by UPI</Text>

        {configLoading ? (
          <View style={styles.card}>
            <ActivityIndicator color={theme.colors.brand} />
          </View>
        ) : !config?.configured ? (
          <View style={styles.card}>
            <Ionicons name="time-outline" size={32} color={theme.colors.brand} />
            <Text style={styles.heading}>Payments aren&apos;t set up yet</Text>
            <Text style={styles.sub}>Please check back soon, or contact support for help upgrading.</Text>
          </View>
        ) : done ? (
          <View style={styles.card} testID="pay-upi-done">
            <View style={styles.doneIcon}>
              <Ionicons name="checkmark-circle" size={44} color={theme.colors.brand} />
            </View>
            <Text style={styles.heading}>Submitted — we&apos;ll confirm shortly</Text>
            <Text style={styles.sub}>
              We&apos;ve received your payment reference for {email.trim().toLowerCase()}. Once it&apos;s
              checked against our UPI payment history, your DHARA account will show as Pro the
              next time you open the app. You can close this page now.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.card} testID="pay-upi-pay-card">
              <Text style={styles.heading}>DHARA Pro — {config.amount_label}</Text>
              <Text style={styles.sub}>One-time payment · lifetime Pro access</Text>

              <View style={styles.qrWrap}>
                <Image
                  testID="pay-upi-qr"
                  source={{ uri: `${API_BASE}/api/billing/upi/qrcode.png` }}
                  style={styles.qr}
                  resizeMode="contain"
                />
              </View>
              <Text style={styles.qrHint}>Scan with any UPI app — GPay, PhonePe, BharatPe, Paytm & more</Text>

              <Pressable testID="pay-upi-button" style={styles.btn} onPress={payWithUpiApp}>
                <Ionicons name="phone-portrait-outline" size={20} color={theme.colors.onBrandPrimary} />
                <Text style={styles.btnText}>Pay via UPI app</Text>
              </Pressable>

              <View style={styles.vpaRow}>
                <Ionicons name="at-outline" size={14} color={theme.colors.onSurfaceSecondary} />
                <Text style={styles.vpaText}>Paying to: {config.payee_name} ({config.vpa})</Text>
              </View>
            </View>

            <View style={styles.card} testID="pay-upi-form-card">
              <Text style={styles.heading}>After you&apos;ve paid</Text>
              <Text style={styles.sub}>
                Open your UPI app&apos;s payment history, copy the reference number (UTR), and enter it
                below with the email on your DHARA account.
              </Text>

              <Text style={styles.label}>Your DHARA account email</Text>
              <TextInput
                testID="pay-upi-email-input"
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={theme.colors.onSurfaceTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
              />

              <Text style={styles.label}>UPI payment reference (UTR)</Text>
              <TextInput
                testID="pay-upi-utr-input"
                style={styles.input}
                value={utr}
                onChangeText={setUtr}
                placeholder="e.g. 412345678901"
                placeholderTextColor={theme.colors.onSurfaceTertiary}
                autoCapitalize="characters"
                autoCorrect={false}
              />

              <Text style={styles.label}>Anything else? (optional)</Text>
              <TextInput
                testID="pay-upi-note-input"
                style={[styles.input, styles.noteInput]}
                value={note}
                onChangeText={setNote}
                placeholder="e.g. paid via GPay just now"
                placeholderTextColor={theme.colors.onSurfaceTertiary}
                multiline
              />

              {error && (
                <Text style={styles.error} testID="pay-upi-error">{error}</Text>
              )}

              <Pressable
                testID="pay-upi-submit-button"
                style={[styles.btn, submitting && { opacity: 0.6 }]}
                disabled={submitting}
                onPress={submit}
              >
                {submitting ? (
                  <ActivityIndicator color={theme.colors.onBrandPrimary} />
                ) : (
                  <Text style={styles.btnText}>Submit for confirmation</Text>
                )}
              </Pressable>
            </View>
          </>
        )}

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
    alignItems: 'center',
  },
  heading: {
    fontFamily: theme.fonts.display,
    fontSize: 20,
    color: theme.colors.onSurface,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: theme.spacing.sm,
  },
  sub: { color: theme.colors.onSurfaceSecondary, marginTop: 6, lineHeight: 20, textAlign: 'center' },
  qrWrap: {
    marginTop: theme.spacing.lg,
    backgroundColor: theme.colors.surfaceSecondary,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
  },
  qr: { width: 200, height: 200 },
  qrHint: { color: theme.colors.onSurfaceTertiary, fontSize: 12, marginTop: 8, textAlign: 'center' },
  vpaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: theme.spacing.lg },
  vpaText: { color: theme.colors.onSurfaceSecondary, fontSize: 13 },
  label: {
    alignSelf: 'stretch',
    color: theme.colors.onSurfaceSecondary,
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
    fontWeight: '600',
  },
  input: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    fontSize: 16,
    color: theme.colors.onSurface,
    backgroundColor: theme.colors.surfaceSecondary,
    minHeight: 48,
  },
  noteInput: { minHeight: 60, textAlignVertical: 'top' },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: theme.colors.brand,
    paddingVertical: theme.spacing.lg,
    paddingHorizontal: theme.spacing.xl,
    borderRadius: theme.radius.md,
    marginTop: theme.spacing.xl,
    minHeight: 52,
    alignSelf: 'stretch',
  },
  btnText: { color: theme.colors.onBrandPrimary, fontWeight: '700', fontSize: 15 },
  error: { alignSelf: 'stretch', color: theme.colors.error, marginTop: theme.spacing.md, fontSize: 13 },
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
