import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Modal, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth, API_BASE } from '@/src/auth';
import { theme } from '@/src/theme';
import { passwordMeetsRule, PASSWORD_RULE_MSG } from '@/src/passwordRule';
import { PasswordLabelWithRules } from '@/src/components/PasswordLabelWithRules';

export default function Signup() {
  const { register } = useAuth();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [terms, setTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTerms, setShowTerms] = useState(false);
  const [termsText, setTermsText] = useState('');
  const [termsVersion, setTermsVersion] = useState('1.0');
  // W1-J02: a second tap before the first request returns must not send a
  // second registration (state updates are async, so `disabled` is too late).
  const submitting = useRef(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/legal/terms`).then(r => r.json()).then(d => {
      setTermsText(d.text);
      setTermsVersion(d.version);
    }).catch(() => {});
  }, []);

  const onSubmit = async () => {
    if (submitting.current) return;
    setError(null);
    if (!name.trim()) { setError('Please enter your name'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Please enter a valid email address'); return; }
    if (!phone.trim() || phone.replace(/\D/g, '').length < 6) { setError('Please enter a valid phone number'); return; }
    if (!passwordMeetsRule(password)) { setError(PASSWORD_RULE_MSG); return; }
    if (!terms) { setError('You must accept the Terms & Conditions to continue'); return; }
    submitting.current = true;
    setLoading(true);
    try {
      await register(email.trim(), password, name.trim(), phone.trim(), true, termsVersion);
      router.replace('/state?onboarding=1');
    } catch (e: any) {
      setError(e?.message || 'Registration failed');
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} testID="signup-screen">
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
        <Text style={styles.brand}>Dhara</Text>
          <Text style={styles.tag}>Empowerment through knowledge</Text>

          <View style={styles.card}>
            <Text style={styles.heading}>Create your account</Text>
            <Text style={styles.sub}>Free during community launch. No fear, just facts.</Text>

            <Text style={styles.label}>Full name</Text>
            <TextInput testID="signup-name-input" style={styles.input} value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor={theme.colors.onSurfaceTertiary} />

            <Text style={styles.label}>Email</Text>
            <TextInput testID="signup-email-input" style={styles.input} value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor={theme.colors.onSurfaceTertiary} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" />

            <Text style={styles.label}>Phone number</Text>
            <TextInput testID="signup-phone-input" style={styles.input} value={phone} onChangeText={setPhone} placeholder="+91 98xxxxxxxx" placeholderTextColor={theme.colors.onSurfaceTertiary} keyboardType="phone-pad" />

            <PasswordLabelWithRules label="Password" password={password} labelStyle={styles.label} />
            <View style={styles.pwWrap}>
              <TextInput
                testID="signup-password-input"
                style={styles.pwInput}
                value={password}
                onChangeText={setPassword}
                placeholder="8+ characters, A-Z, 0-9 and a symbol"
                placeholderTextColor={theme.colors.onSurfaceTertiary}
                secureTextEntry={!showPassword}
              />
              <Pressable
                testID="toggle-signup-password"
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

            <Pressable testID="terms-checkbox" style={styles.termsRow} onPress={() => setTerms(t => !t)}>
              <View style={[styles.checkbox, terms && styles.checkboxOn]}>
                {terms && <Ionicons name="checkmark" size={16} color={theme.colors.onBrandPrimary} />}
              </View>
              <Text style={styles.termsText}>
                I have read, understood, and accept the{' '}
                <Text testID="open-terms-link" style={styles.termsLink} onPress={(e) => { e.stopPropagation?.(); setShowTerms(true); }}>Terms & Conditions</Text>
                {' '}including the legal disclaimer and data collection notice. I understand Dhara is NOT a lawyer and provides legal information only.
              </Text>
            </Pressable>

            {error && <Text style={styles.error} testID="signup-error">{error}</Text>}

            <Pressable testID="signup-submit-button" style={[styles.btn, loading && { opacity: 0.6 }]} disabled={loading} onPress={onSubmit}>
              {loading ? <ActivityIndicator color={theme.colors.onBrandPrimary} /> : <Text style={styles.btnText}>Create account</Text>}
            </Pressable>

            <View style={styles.row}>
              <Text style={styles.sub}>Already registered? </Text>
              <Link href="/login" asChild>
                <Pressable testID="go-to-login"><Text style={styles.link}>Sign in</Text></Pressable>
              </Link>
            </View>
          </View>
          <Text testID="signup-copyright" style={styles.copyright}>© {new Date().getFullYear()} Callistus Moses · An Msafe product</Text>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={showTerms} animationType="slide" onRequestClose={() => setShowTerms(false)} testID="terms-modal">
        <SafeAreaView style={styles.termsSafe} edges={['top', 'bottom']}>
          <View style={styles.termsHeader}>
            <Text style={styles.termsHeaderTitle}>Terms & Conditions</Text>
            <Pressable testID="close-terms" onPress={() => setShowTerms(false)} hitSlop={10}>
              <Ionicons name="close" size={28} color={theme.colors.onBrandPrimary} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: theme.spacing.lg }}>
            <Text style={styles.termsBody}>{termsText}</Text>
          </ScrollView>
          <View style={styles.termsFooter}>
            <Pressable testID="accept-terms-in-modal" style={styles.btn} onPress={() => { setTerms(true); setShowTerms(false); }}>
              <Text style={styles.btnText}>I Agree & Continue</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.brand },
  scroll: { flexGrow: 1, padding: theme.spacing.xl, justifyContent: 'center' },
  brand: { fontFamily: theme.fonts.display, fontSize: 44, color: theme.colors.onBrandPrimary, textAlign: 'center', fontWeight: '700' },
  tag: { color: theme.colors.brandSecondary, textAlign: 'center', marginTop: 8, fontSize: 15 },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, padding: theme.spacing.xl, marginTop: theme.spacing.xxl },
  heading: { fontFamily: theme.fonts.display, fontSize: 24, color: theme.colors.onSurface, fontWeight: '700' },
  sub: { color: theme.colors.onSurfaceSecondary, marginTop: 4 },
  label: { color: theme.colors.onSurfaceSecondary, marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, padding: theme.spacing.md, fontSize: 16, color: theme.colors.onSurface, backgroundColor: theme.colors.surfaceSecondary },
  pwWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceSecondary },
  pwInput: { flex: 1, padding: theme.spacing.md, fontSize: 16, color: theme.colors.onSurface },
  eyeBtn: { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.md, justifyContent: 'center', alignItems: 'center' },
  termsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.sm, marginTop: theme.spacing.lg, padding: theme.spacing.md, backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border },
  checkbox: { width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: theme.colors.brand, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  checkboxOn: { backgroundColor: theme.colors.brand },
  termsText: { flex: 1, color: theme.colors.onSurface, fontSize: 12, lineHeight: 18 },
  termsLink: { color: theme.colors.brandSecondary, fontWeight: '700', textDecorationLine: 'underline' },
  btn: { backgroundColor: theme.colors.brand, padding: theme.spacing.lg, borderRadius: theme.radius.md, alignItems: 'center', marginTop: theme.spacing.xl, minHeight: 52 },
  btnText: { color: theme.colors.onBrandPrimary, fontWeight: '700', fontSize: 16 },
  row: { flexDirection: 'row', justifyContent: 'center', marginTop: theme.spacing.lg },
  link: { color: theme.colors.brandSecondary, fontWeight: '700' },
  error: { color: theme.colors.error, marginTop: theme.spacing.md },
  copyright: { textAlign: 'center', color: '#8A93A6', marginTop: theme.spacing.xl, fontSize: 11, letterSpacing: 0.5 },
  termsSafe: { flex: 1, backgroundColor: theme.colors.surface },
  termsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: theme.spacing.lg, backgroundColor: theme.colors.brand },
  termsHeaderTitle: { color: theme.colors.onBrandPrimary, fontFamily: theme.fonts.display, fontSize: 20, fontWeight: '700' },
  termsBody: { color: theme.colors.onSurface, fontSize: 13, lineHeight: 20 },
  termsFooter: { padding: theme.spacing.lg, borderTopWidth: 1, borderTopColor: theme.colors.divider },
});
