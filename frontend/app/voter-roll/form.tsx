/**
 * Voter Roll — Form 6 / Form 8 Interview Screen
 * Asks questions one at a time and generates a PDF via the backend.
 *
 * Route: /voter-roll/form?form_type=form6|form8&language=en|hi|mr
 */
import { useState, useCallback } from 'react';
import {
  View, Text, Pressable, TextInput, ScrollView, StyleSheet,
  ActivityIndicator, Platform, Alert,
} from 'react-native';
import { KeyboardSafeView } from '@/src/components/KeyboardSafeView';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth, API_BASE } from '@/src/auth';
import voterForms from '@/src/content/voter_forms.json';
import AsyncStorage from '@react-native-async-storage/async-storage';

type Lang = 'en' | 'hi' | 'mr';

const NAVY = '#1B2B5B';
const GOLD = '#C9973A';
const BG   = '#FAFAF8';

const PDF_DISCLAIMER = 'DHARA has prepared this draft to help you. This document has not been submitted to the Election Commission of India. You must submit it yourself at voters.eci.gov.in or at your local ERO office.';

function t(obj: Record<string, string> | undefined, lang: Lang): string {
  if (!obj) return '';
  return obj[lang] || obj['en'] || '';
}

// ── Analytics stub (wires to PostHog when consent is given) ──────────────────
async function trackEvent(eventName: string) {
  try {
    const prefs = await AsyncStorage.getItem('gk_consent_prefs');
    const parsed = prefs ? JSON.parse(prefs) : {};
    if (!parsed.analytics) return;
    // PostHog can be wired here — send event_name only, no payload
    console.log('[analytics]', eventName);
  } catch { /* silent */ }
}

type FormQuestion = {
  id: string;
  order: number;
  type: string;
  field: string;
  label: Record<string, string>;
  placeholder?: Record<string, string>;
  text?: Record<string, string>;
  options?: Array<{ id: string; text: Record<string, string> }>;
  conditional?: { show_if_field: string; show_if_value: string };
};

export default function VoterFormScreen() {
  const params         = useLocalSearchParams<{ form_type: string; language: string }>();
  const formType       = (params.form_type === 'form8' ? 'form8' : 'form6') as 'form6' | 'form8';
  const { token, language: rawLang } = useAuth();
  const lang: Lang     = (['en', 'hi', 'mr'].includes(params.language ?? '') ? params.language : ['en', 'hi', 'mr'].includes(rawLang.code) ? rawLang.code : 'en') as Lang;
  const router         = useRouter();

  const formData = formType === 'form6' ? voterForms.form6 : voterForms.form8;
  const allQ     = formData.questions as unknown as FormQuestion[];

  const [answers,   setAnswers]   = useState<Record<string, string>>({});
  const [qIdx,      setQIdx]      = useState(0);
  const [inputVal,  setInputVal]  = useState('');
  const [phase,     setPhase]     = useState<'gate' | 'interview' | 'generating' | 'done'>(!token ? 'gate' : 'interview');
  const [pdfUri,    setPdfUri]    = useState<string | null>(null);
  const [pdfName,   setPdfName]   = useState('');
  const [errorMsg,  setErrorMsg]  = useState('');

  // ── Visible questions (filter out conditional) ────────────────────────────
  const visibleQ = allQ.filter(q => {
    if (!q.conditional) return true;
    const { show_if_field, show_if_value } = q.conditional;
    return answers[show_if_field] === show_if_value;
  });

  const currentQ = visibleQ[qIdx] ?? null;
  const progress  = visibleQ.length > 0 ? (qIdx / visibleQ.length) * 100 : 0;

  // ── Submit an answer ──────────────────────────────────────────────────────
  const submitAnswer = useCallback((field: string, value: string) => {
    if (!value.trim()) return;
    const updated = { ...answers, [field]: value.trim() };
    setAnswers(updated);
    setInputVal('');

    if (qIdx + 1 >= visibleQ.length) {
      // All questions done — generate PDF
      generatePdf(updated);
    } else {
      setQIdx(i => i + 1);
    }
  }, [answers, qIdx, visibleQ]);

  // ── Generate PDF via backend ──────────────────────────────────────────────
  const generatePdf = async (finalAnswers: Record<string, string>) => {
    setPhase('generating');
    setErrorMsg('');
    try {
      const applicant = finalAnswers['applicant_name_en'] || 'Applicant';
      const body = { form_type: formType, answers: finalAnswers, language: lang };

      const resp = await fetch(`${API_BASE}/api/voter/pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) throw new Error(`Server error ${resp.status}`);

      // Build filename from Content-Disposition or generate one
      const cd = resp.headers.get('Content-Disposition') || '';
      const match = cd.match(/filename="([^"]+)"/);
      const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
      const nameSlug = applicant.replace(/\s+/g, '_').slice(0, 20);
      const prefix = formType === 'form6' ? 'DHARA_Form6' : 'DHARA_Form8';
      const filename = match?.[1] || `${prefix}_${nameSlug}_${ts}.pdf`;
      setPdfName(filename);

      if (Platform.OS === 'web') {
        // Web: create blob URL and trigger download
        const blob = await resp.blob();
        const url  = URL.createObjectURL(blob);
        setPdfUri(url);
        // Auto-trigger download
        try {
          const a   = document.createElement('a');
          a.href     = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        } catch { /* fallback: show download button */ }
      } else {
        // Native: save to cache dir then share
        const FileSystem = await import('expo-file-system/legacy');
        const buf    = await resp.arrayBuffer();
        const bytes  = new Uint8Array(buf);
        let binary   = '';
        bytes.forEach(b => { binary += String.fromCharCode(b); });
        const b64    = btoa(binary);
        const path   = `${FileSystem.cacheDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(path, b64, { encoding: FileSystem.EncodingType.Base64 });
        setPdfUri(path);
      }

      await trackEvent(formType === 'form6' ? 'voter_form6_completed' : 'voter_form8_completed');
      setPhase('done');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unknown error');
      setPhase('interview'); // allow retry
    }
  };

  // ── Share / re-download ───────────────────────────────────────────────────
  const shareOrOpen = async () => {
    if (!pdfUri) return;
    if (Platform.OS === 'web') {
      window.open(pdfUri, '_blank');
    } else {
      try {
        const Sharing = await import('expo-sharing');
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(pdfUri, { mimeType: 'application/pdf', dialogTitle: pdfName });
        }
      } catch {
        Alert.alert('Share unavailable', 'PDF saved to: ' + pdfUri);
      }
    }
  };

  // ── Registration gate ─────────────────────────────────────────────────────
  if (phase === 'gate') {
    return (
      <SafeAreaView style={st.safe} edges={['top']}>
        <Pressable onPress={() => router.back()} style={st.backBtn}>
          <Text style={st.backText}>← {lang === 'hi' ? 'वापस' : lang === 'mr' ? 'मागे' : 'Back'}</Text>
        </Pressable>
        <View style={st.gateCard}>
          <Text style={st.gateTitle}>
            {lang === 'hi' ? 'खाता आवश्यक है' : lang === 'mr' ? 'खाते आवश्यक आहे' : 'Account Required'}
          </Text>
          <Text style={st.gateBody}>
            {lang === 'hi'
              ? 'फॉर्म भरने के लिए कृपया पहले साइन इन करें।'
              : lang === 'mr'
              ? 'फॉर्म भरण्यासाठी कृपया आधी साइन इन करा.'
              : 'Please sign in to prepare your voter form application.'}
          </Text>
          <Pressable style={st.primaryBtn} onPress={() => router.replace('/login')}>
            <Text style={st.primaryBtnText}>
              {lang === 'hi' ? 'साइन इन करें' : lang === 'mr' ? 'साइन इन करा' : 'Sign In'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ── Generating PDF ────────────────────────────────────────────────────────
  if (phase === 'generating') {
    return (
      <SafeAreaView style={st.safe} edges={['top']}>
        <View style={st.centred}>
          <ActivityIndicator size="large" color={NAVY} />
          <Text style={st.genText}>
            {lang === 'hi'
              ? 'PDF तैयार हो रहा है...'
              : lang === 'mr'
              ? 'PDF तयार होत आहे...'
              : 'Preparing your PDF…'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Done — PDF ready ──────────────────────────────────────────────────────
  if (phase === 'done') {
    const output = formData.output as {
      checklist_items: Record<string, string[]>;
      submission_note: Record<string, string>;
    };
    const checklist = output.checklist_items[lang] || output.checklist_items['en'];
    const subNote   = t(output.submission_note as Record<string, string>, lang);
    const label = lang === 'hi' ? 'सफल!' : lang === 'mr' ? 'यशस्वी!' : 'Done!';
    const dlLabel = lang === 'hi' ? 'PDF डाउनलोड / शेयर करें' : lang === 'mr' ? 'PDF डाउनलोड / शेअर करा' : 'Download / Share PDF';

    return (
      <SafeAreaView style={st.safe} edges={['top']}>
        <ScrollView contentContainerStyle={st.scrollContent}>
          <View style={st.successBanner}>
            <Text style={st.successEmoji}>✅</Text>
            <Text style={st.successTitle}>{label}</Text>
            <Text style={st.successSub}>{pdfName}</Text>
          </View>

          {pdfUri && (
            <Pressable style={st.primaryBtn} onPress={shareOrOpen}>
              <Text style={st.primaryBtnText}>⬇ {dlLabel}</Text>
            </Pressable>
          )}

          {/* Disclaimer */}
          <View style={st.disclaimerCard}>
            <Text style={st.disclaimerText}>{PDF_DISCLAIMER}</Text>
          </View>

          {/* Checklist */}
          <Text style={st.sectionTitle}>
            {lang === 'hi' ? 'संलग्न दस्तावेज़' : lang === 'mr' ? 'जोडावयाचे दस्तऐवज' : 'Documents to Attach'}
          </Text>
          {checklist.map((item, i) => (
            <View key={i} style={st.checkRow}>
              <Text style={st.checkBox}>☐</Text>
              <Text style={st.checkLabel}>{item}</Text>
            </View>
          ))}

          {/* Submission note */}
          <View style={st.noteCard}>
            <Text style={st.noteText}>{subNote}</Text>
          </View>

          <Pressable style={st.secondaryBtn} onPress={() => router.replace('/(tabs)/voter-roll')}>
            <Text style={st.secondaryBtnText}>
              {lang === 'hi' ? '↺ शुरू से शुरू करें' : lang === 'mr' ? '↺ सुरुवातीपासून सुरू करा' : '↺ Start Over'}
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Interview ─────────────────────────────────────────────────────────────
  if (!currentQ) return null;

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <KeyboardSafeView
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={80}
      >
        <ScrollView contentContainerStyle={st.scrollContent} keyboardShouldPersistTaps="handled">
          {/* Header */}
          <View style={st.interviewHeader}>
            <Pressable onPress={() => router.back()} style={st.backBtn}>
              <Text style={st.backText}>←</Text>
            </Pressable>
            <Text style={st.formTitle}>{t(formData.title as Record<string, string>, lang)}</Text>
          </View>

          {/* Progress */}
          <View style={st.progressRow}>
            <View style={st.progressBar}>
              <View style={[st.progressFill, { width: `${progress}%` as any }]} />
            </View>
            <Text style={st.progressText}>{qIdx + 1}/{visibleQ.length}</Text>
          </View>

          {/* Error */}
          {errorMsg ? (
            <View style={st.errorCard}>
              <Text style={st.errorText}>⚠ {errorMsg}</Text>
              <Pressable onPress={() => setErrorMsg('')}>
                <Text style={st.retryText}>
                  {lang === 'hi' ? 'फिर से प्रयास' : lang === 'mr' ? 'पुन्हा प्रयत्न' : 'Try again'}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {/* Question bubble */}
          <View style={st.questionBubble}>
            <Text style={st.questionText}>{t(currentQ.label, lang)}</Text>
          </View>

          {/* Declaration type */}
          {currentQ.type === 'declaration' && currentQ.text && (
            <>
              <Text style={st.declarationText}>{t(currentQ.text, lang)}</Text>
              <Pressable style={st.primaryBtn} onPress={() => submitAnswer(currentQ.field, 'confirmed')}>
                <Text style={st.primaryBtnText}>
                  {lang === 'hi' ? '✓ मैं सहमत हूँ' : lang === 'mr' ? '✓ मी सहमत आहे' : '✓ I Agree & Confirm'}
                </Text>
              </Pressable>
            </>
          )}

          {/* Single choice type */}
          {currentQ.type === 'single_choice' && currentQ.options && (
            <View style={{ marginTop: 12 }}>
              {currentQ.options.map(opt => (
                <Pressable
                  key={opt.id}
                  style={[st.optionBtn, answers[currentQ.field] === opt.id && st.optionSelected]}
                  onPress={() => submitAnswer(currentQ.field, opt.id)}
                >
                  <Text style={[st.optionText, answers[currentQ.field] === opt.id && st.optionTextSelected]}>
                    {t(opt.text, lang)}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {/* Text input type */}
          {currentQ.type === 'text' && (
            <View style={st.inputRow}>
              <TextInput
                style={st.textInput}
                placeholder={t(currentQ.placeholder || {}, lang) || '…'}
                placeholderTextColor="#AAA"
                value={inputVal}
                onChangeText={setInputVal}
                multiline={currentQ.field === 'new_address' || currentQ.field === 'correction_details'}
                numberOfLines={currentQ.field === 'new_address' ? 3 : 1}
                returnKeyType="next"
                onSubmitEditing={() => submitAnswer(currentQ.field, inputVal)}
              />
              <Pressable
                style={[st.nextBtn, !inputVal.trim() && st.nextBtnDisabled]}
                onPress={() => submitAnswer(currentQ.field, inputVal)}
                disabled={!inputVal.trim()}
              >
                <Text style={st.nextBtnText}>→</Text>
              </Pressable>
            </View>
          )}

          {/* Skip optional */}
          {currentQ.field === 'mobile_number' && (
            <Pressable onPress={() => submitAnswer(currentQ.field, '—')} style={st.skipBtn}>
              <Text style={st.skipText}>
                {lang === 'hi' ? 'छोड़ें' : lang === 'mr' ? 'वगळा' : 'Skip'}
              </Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardSafeView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: BG },
  scrollContent:   { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 60 },
  centred:         { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },

  backBtn:          { marginBottom: 8 },
  backText:         { color: NAVY, fontSize: 14, fontWeight: '600' },

  interviewHeader:  { marginBottom: 16 },
  formTitle:        { fontSize: 16, fontWeight: '700', color: NAVY, marginTop: 4, lineHeight: 22 },

  progressRow:      { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  progressBar:      { flex: 1, height: 4, backgroundColor: '#E5E7EB', borderRadius: 2, marginRight: 10 },
  progressFill:     { height: 4, backgroundColor: GOLD, borderRadius: 2 },
  progressText:     { fontSize: 12, color: '#999', minWidth: 38, textAlign: 'right' },

  questionBubble:   {
    backgroundColor: NAVY, borderRadius: 16, padding: 18, marginBottom: 16,
  },
  questionText:     { fontSize: 17, fontWeight: '600', color: '#FFF', lineHeight: 26 },

  declarationText:  {
    fontSize: 13, color: '#555', lineHeight: 20, marginBottom: 16,
    backgroundColor: '#FFF', borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: '#E5E7EB',
  },

  optionBtn:        {
    backgroundColor: '#FFF', borderRadius: 12, paddingVertical: 16, paddingHorizontal: 18,
    marginBottom: 10, borderWidth: 1.5, borderColor: '#E5E7EB',
  },
  optionSelected:   { borderColor: NAVY, backgroundColor: '#EEF0FA' },
  optionText:       { fontSize: 15, color: '#222', lineHeight: 22 },
  optionTextSelected: { color: NAVY, fontWeight: '600' },

  inputRow:         { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  textInput:        {
    flex: 1, backgroundColor: '#FFF', borderWidth: 1.5, borderColor: '#DDD',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 15, color: '#111',
  },
  nextBtn:          {
    backgroundColor: NAVY, borderRadius: 12, width: 52, height: 52,
    alignItems: 'center', justifyContent: 'center',
  },
  nextBtnDisabled:  { backgroundColor: '#CCC' },
  nextBtnText:      { color: '#FFF', fontSize: 20, fontWeight: '700' },

  skipBtn:          { alignItems: 'center', paddingVertical: 10 },
  skipText:         { color: '#999', fontSize: 14 },

  errorCard:        {
    backgroundColor: '#FFF0F0', borderRadius: 10, padding: 12, marginBottom: 12,
    borderLeftWidth: 3, borderLeftColor: '#CC0000',
  },
  errorText:        { color: '#CC0000', fontSize: 13 },
  retryText:        { color: NAVY, fontSize: 13, fontWeight: '600', marginTop: 6 },

  genText:          { color: NAVY, fontSize: 16, fontWeight: '600' },

  successBanner:    {
    backgroundColor: NAVY, borderRadius: 16, padding: 24, alignItems: 'center', marginBottom: 20,
  },
  successEmoji:     { fontSize: 36, marginBottom: 8 },
  successTitle:     { fontSize: 22, fontWeight: '700', color: '#FFF' },
  successSub:       { fontSize: 12, color: '#C5CEEA', marginTop: 6, textAlign: 'center' },

  primaryBtn:       {
    backgroundColor: NAVY, borderRadius: 12, paddingVertical: 16,
    alignItems: 'center', marginBottom: 12,
  },
  primaryBtnText:   { color: '#FFF', fontWeight: '700', fontSize: 16 },

  secondaryBtn:     {
    borderWidth: 1.5, borderColor: NAVY, borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', marginBottom: 12,
  },
  secondaryBtnText: { color: NAVY, fontWeight: '600', fontSize: 14 },

  disclaimerCard:   {
    backgroundColor: '#FFF8E7', borderLeftWidth: 4, borderLeftColor: GOLD,
    borderRadius: 8, padding: 14, marginBottom: 20,
  },
  disclaimerText:   { fontSize: 12, color: '#555', lineHeight: 18 },

  sectionTitle:     { fontSize: 14, fontWeight: '700', color: NAVY, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },

  checkRow:         { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  checkBox:         { fontSize: 16, color: NAVY, marginRight: 10, marginTop: 1 },
  checkLabel:       { flex: 1, fontSize: 14, color: '#333', lineHeight: 20 },

  noteCard:         {
    backgroundColor: '#F0F4FF', borderRadius: 10, padding: 14, marginBottom: 20,
  },
  noteText:         { fontSize: 13, color: '#334', lineHeight: 20 },

  gateCard:         {
    margin: 20, backgroundColor: '#FFF', borderRadius: 16, padding: 24,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  gateTitle:        { fontSize: 20, fontWeight: '700', color: NAVY, marginBottom: 12 },
  gateBody:         { fontSize: 15, color: '#555', lineHeight: 22, marginBottom: 24 },
});
