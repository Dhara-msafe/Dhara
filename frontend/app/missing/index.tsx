/**
 * Missing Person — Entry Screen (First Screen)
 * Shows urgent notice + 112 / 1098 tap-to-call buttons.
 * "Prepare Written Complaint" navigates to the interview.
 *
 * DATA POLICY: No answers leave the device. PDF generated on-device only.
 * Route: /missing
 */
import { useEffect } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/auth';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import interviewData from '@/src/content/missing_interview.json';
import { trackEvent } from '@/src/analytics';
import { EmergencyNotActiveNotice } from '@/src/components/dhara/EmergencyNumberStatic';
type Lang = 'en' | 'hi' | 'mr';

const NAVY = theme.colors.primary;
const RED = theme.colors.error;
const BG = theme.colors.background;

function t(obj: Record<string, string> | undefined, lang: Lang): string {
  if (!obj) return '';
  return obj[lang] || obj['en'] || '';
}

export default function MissingEntryScreen() {
  const { language: rawLang } = useAuth();
  const lang: Lang = (['en', 'hi', 'mr'].includes(rawLang.code) ? rawLang.code : 'en') as Lang;
  const router = useRouter();

  useEffect(() => {
    trackEvent('missing_person_flow_started');
  }, []);

  const first = interviewData.entry_screens.first_screen;

  return (
    <SafeAreaView testID="missing-entry-screen" style={s.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={s.scroll}>
        <Pressable testID="missing-entry-back" accessibilityRole="button" accessibilityLabel="Back" style={s.back} onPress={() => router.back()}><Ionicons name="arrow-back" size={24} color={NAVY} /></Pressable>
        {/* Header */}
        <View style={s.header}>
          <Text style={s.title}>{t(first.title, lang)}</Text>
          <View style={s.urgentBadge}>
            <Text style={s.urgentText}>🚨 {t(first.urgent_note, lang)}</Text>
          </View>
        </View>

        {/* Body text */}
        <Text style={s.body}>{t(first.body, lang)}</Text>

        {/* Emergency call buttons */}
        <View style={s.callSection}>
          {first.emergency_numbers.map(num => (
            <View
              key={num.number}
              testID={`missing-call-${num.number}`}
              style={[s.callBtn, num.number === '1098' && s.callBtnSecondary, { opacity: 0.7 }]}
            >
              <Text style={s.callIcon}>📞</Text>
              <View style={s.callInfo}>
                <Text style={s.callNumber}>{num.number}</Text>
                <Text style={s.callLabel}>{t(num.label, lang)}</Text>
              </View>
            </View>
          ))}
        </View>
        <EmergencyNotActiveNotice />

        {/* Divider */}
        <View style={s.divider} />

        {/* Continue to interview */}
        <Pressable
          testID="missing-start-interview"
          style={s.continueBtn}
          onPress={() => router.push('/missing/interview')}
        >
          <Text style={s.continueBtnText}>{t(first.continue_label, lang)}</Text>
        </Pressable>
        <Pressable testID="missing-add-details" accessibilityRole="button" style={s.attachmentBtn} onPress={() => router.push('/missing/attachments')}>
          <Ionicons name="images-outline" size={22} color={NAVY} />
          <View style={s.callInfo}><Text testID="missing-add-details-title" style={s.attachmentTitle}>Add photos & GPS location</Text><Text testID="missing-add-details-subtitle" style={s.attachmentSub}>Optional · include in your complaint PDF</Text></View>
          <Ionicons name="chevron-forward" size={18} color={NAVY} />
        </Pressable>

        <Text style={s.note}>
          {lang === 'hi'
            ? 'आपके उत्तर केवल इस डिवाइस पर सुरक्षित रहेंगे।'
            : lang === 'mr'
            ? 'तुमची उत्तरे फक्त या डिव्हाइसवर सुरक्षित राहतील.'
            : 'Your answers and GPS stay on this device. Optional photos are uploaded privately only with your agreement.'}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  back: { width: 44, height: 44, justifyContent: 'center', marginBottom: 8 },
  attachmentBtn: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 16, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  attachmentTitle: { color: NAVY, fontSize: 15, fontWeight: '700' },
  attachmentSub: { fontSize: 12, color: theme.colors.onSurfaceTertiary, marginTop: 4 },
  safe:          { flex: 1, backgroundColor: BG },
  scroll:        { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40 },

  header:        { marginBottom: 16 },
  title:         { fontSize: 28, fontWeight: '800', color: NAVY, letterSpacing: -0.5, marginBottom: 12 },

  urgentBadge:   {
    backgroundColor: '#FFF0F0', borderRadius: 10, padding: 12,
    borderLeftWidth: 4, borderLeftColor: RED,
  },
  urgentText:    { fontSize: 13, color: RED, lineHeight: 19, fontWeight: '600' },

  body:          { fontSize: 15, color: '#444', lineHeight: 23, marginBottom: 24 },

  callSection:   { gap: 12, marginBottom: 24 },
  callBtn:       {
    backgroundColor: RED, borderRadius: 16, padding: 18,
    flexDirection: 'row', alignItems: 'center', gap: 14,
    shadowColor: RED, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  callBtnSecondary: { backgroundColor: '#E65C00' },
  callIcon:      { fontSize: 28 },
  callInfo:      { flex: 1 },
  callNumber:    { fontSize: 28, fontWeight: '800', color: '#FFF', letterSpacing: 1 },
  callLabel:     { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 2 },

  divider:       { height: 1, backgroundColor: '#E5E7EB', marginBottom: 24 },

  continueBtn:   {
    backgroundColor: NAVY, borderRadius: 14, paddingVertical: 18,
    alignItems: 'center', marginBottom: 14,
    shadowColor: NAVY, shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  continueBtnText: { fontSize: 17, fontWeight: '700', color: '#FFF' },

  note:          { fontSize: 12, color: '#888', textAlign: 'center', lineHeight: 17 },
});
