import { useEffect, useRef, useState } from 'react';
import { useLightStatusBar } from '@/src/ui/kit';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Modal, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth, API_BASE } from '@/src/auth';
import { theme } from '@/src/theme';
import { SosPill112 } from '@/src/ui/kit';
import { passwordMeetsRule, PASSWORD_RULE_MSG } from '@/src/passwordRule';
import { PasswordLabelWithRules } from '@/src/components/PasswordLabelWithRules';

export default function Signup() {
  useLightStatusBar(); // redesign v3: white status-bar icons over the dark header
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
        {/* 27 Nov: SOS 112 at the top, like every other screen (was the floating SOS). */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', minHeight: 48 }}>
          <SosPill112 testID="signup-sos" />
        </View>
        <Text style={styles.brand}>DHARA</Text>
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
              <Text style={styles.rowLead}>Already registered? </Text>
              <Link href="/login" asChild>
                <Pressable testID="go-to-login" accessibilityRole="link" style={{ minHeight: 44, justifyContent: "center" }}><Text style={[styles.link, styles.linkUnderline]}>Sign in</Text></Pressable>
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
  brand: { fontFamily: theme.fonts.brand, letterSpacing: 1.5, fontSize: 36, color: theme.colors.onBrandPrimary, textAlign: 'center', },
  tag: { color: theme.colors.headerTagline, textAlign: 'center', marginTop: 8, fontFamily: 'Inter', fontSize: 13 },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, padding: theme.spacing.xl, marginTop: theme.spacing.xxl },
  heading: { fontFamily: theme.fonts.display, fontSize: 21, color: theme.colors.onSurface, fontWeight: '700' },
  sub: { color: theme.colors.onSurfaceSecondary, marginTop: 4 },
  label: { color: theme.colors.onSurfaceSecondary, marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm, fontFamily: 'InterSemiBold'},
  input: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, padding: theme.spacing.md, fontFamily: 'Inter', fontSize: 14, color: theme.colors.onSurface, backgroundColor: theme.colors.paper },
  pwWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, backgroundColor: theme.colors.paper },
  pwInput: { flex: 1, padding: theme.spacing.md, fontFamily: 'Inter', fontSize: 14, color: theme.colors.onSurface },
  eyeBtn: { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.md, justifyContent: 'center', alignItems: 'center' },
  termsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.sm, marginTop: theme.spacing.lg, padding: theme.spacing.md, backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border },
  checkbox: { width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: theme.colors.brand, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  checkboxOn: { backgroundColor: theme.colors.brand },
  termsText: { flex: 1, color: theme.colors.onSurface, fontFamily: 'Inter', fontSize: 12, lineHeight: 16 },
  termsLink: { color: theme.colors.brandSecondary, fontFamily: 'InterBold', textDecorationLine: 'underline' },
  btn: { backgroundColor: theme.colors.brand, padding: theme.spacing.lg, borderRadius: theme.radius.md, alignItems: 'center', marginTop: theme.spacing.xl, minHeight: 52 },
  btnText: { color: theme.colors.onBrandPrimary, fontFamily: 'InterBold', fontSize: 14 },
  // 22 Nov: same as sign-in and reset: text and link on one line, link underlined.
  row: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: theme.spacing.lg },
  rowLead: { color: theme.colors.onSurfaceSecondary },
  linkUnderline: { textDecorationLine: 'underline' },
  link: { color: theme.colors.brandSecondary, fontFamily: 'InterBold'},
  error: { color: theme.colors.error, marginTop: theme.spacing.md },
  copyright: { textAlign: 'center', color: '#64788A', marginTop: theme.spacing.xl, fontFamily: 'Inter', fontSize: 12, letterSpacing: 0.5 },
  termsSafe: { flex: 1, backgroundColor: theme.colors.surface },
  termsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: theme.spacing.lg, backgroundColor: theme.colors.brand },
  termsHeaderTitle: { color: theme.colors.onBrandPrimary, fontFamily: theme.fonts.display, fontSize: 17, fontWeight: '700' },
  termsBody: { color: theme.colors.onSurface, fontFamily: 'Inter', fontSize: 12, lineHeight: 18 },
  termsFooter: { padding: theme.spacing.lg, borderTopWidth: 1, borderTopColor: theme.colors.divider },
});
