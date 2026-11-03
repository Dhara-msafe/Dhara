/**
 * Voter Roll Tab — Triage screen
 * Asks VT1 → VT2 → VT3 and routes to Form 6, Form 8, Status Check, or Legal Help.
 */
import { useState, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';
import triageData from '@/src/content/voter_triage.json';

import { openExternal } from '@/src/outbound';
type Lang = 'en' | 'hi' | 'mr';
type OutcomeId = 'FORM6' | 'FORM8' | 'STATUS_CHECK' | 'LEGAL_HELP';

const NAVY = theme.colors.primary;
const GOLD = theme.colors.gold;
const BG = theme.colors.background;

function t(obj: Record<string, string>, lang: Lang): string {
  return obj[lang] || obj['en'] || '';
}

export default function VoterRollTab() {
  const { language: rawLang } = useAuth();
  const lang: Lang = (['en', 'hi', 'mr'].includes(rawLang.code) ? rawLang.code : 'en') as Lang;
  const router = useRouter();

  const [currentQId, setCurrentQId] = useState<string | null>(null);  // null = welcome
  const [outcome, setOutcome] = useState<OutcomeId | null>(null);

  const questions = triageData.questions;
  const outcomes  = triageData.outcomes as Record<OutcomeId, { label: Record<string, string>; action: string; url?: string; note?: Record<string, string>; message?: Record<string, string> }>;

  const currentQ = questions.find(q => q.id === currentQId) ?? null;

  // ── Pick an option ─────────────────────────────────────────────────────────
  const pickOption = useCallback((qId: string, optionId: string, next: string) => {
    void optionId; void qId; // stored in triage state
    // 'next' is either a question ID or an outcome key
    const isOutcome = Object.keys(outcomes).includes(next);
    if (isOutcome) {
      setOutcome(next as OutcomeId);
    } else {
      setCurrentQId(next);
    }
  }, [outcomes]);

  const reset = () => {
    setCurrentQId(null);
    setOutcome(null);
  };

  // ── Welcome / intro screen ─────────────────────────────────────────────────
  if (currentQId === null && outcome === null) {
    return (
      <SafeAreaView testID="voter-roll-screen" style={s.safe} edges={['top']}>
        <ScrollView contentContainerStyle={s.scrollContent}>
          {/* Header */}
          <View style={s.header}>
            <Text style={s.headerTitle}>
              {lang === 'hi' ? 'मतदाता सूची' : lang === 'mr' ? 'मतदार यादी' : 'Voter Roll'}
            </Text>
            <Text style={s.headerSub}>
              {lang === 'hi'
                ? 'फॉर्म 6 व फॉर्म 8 ड्राफ्ट सहायता'
                : lang === 'mr'
                ? 'फॉर्म 6 व फॉर्म 8 मसुदा मदत'
                : 'Form 6 & Form 8 Draft Assistance'}
            </Text>
          </View>

          {/* Disclaimer card */}
          <View style={s.disclaimerCard}>
            <Text style={s.disclaimerText}>
              {t(triageData.disclaimer, lang)}
            </Text>
          </View>

          {/* Start button */}
          <Pressable
            testID="voter-begin"
            style={s.primaryBtn}
            onPress={() => setCurrentQId(questions[0]?.id ?? null)}
          >
            <Text style={s.primaryBtnText}>
              {lang === 'hi' ? 'शुरू करें' : lang === 'mr' ? 'सुरू करा' : 'Begin'}
            </Text>
          </Pressable>

          {/* ECI Status check shortcut */}
          <Pressable
            testID="voter-status-shortcut"
            style={s.secondaryBtn}
            onPress={() => openExternal('https://voters.eci.gov.in')}
          >
            <Text style={s.secondaryBtnText}>
              {lang === 'hi'
                ? '🔗 voters.eci.gov.in पर जाएं'
                : lang === 'mr'
                ? '🔗 voters.eci.gov.in वर जा'
                : '🔗 Check status at voters.eci.gov.in'}
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Outcome screen ─────────────────────────────────────────────────────────
  if (outcome !== null) {
    const outcomeData = outcomes[outcome];
    const label = t(outcomeData.label, lang);

    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <ScrollView contentContainerStyle={s.scrollContent}>
          <Pressable testID="voter-outcome-back" onPress={reset} style={s.backBtn}>
            <Text style={s.backText}>← {lang === 'hi' ? 'वापस' : lang === 'mr' ? 'मागे' : 'Back'}</Text>
          </Pressable>

          <View style={s.outcomeCard}>
            <Text testID="voter-outcome" style={s.outcomeLabel}>{label}</Text>

            {/* FORM6 / FORM8 → start interview */}
            {(outcome === 'FORM6' || outcome === 'FORM8') && (
              <>
                <Text style={s.outcomeBody}>
                  {lang === 'hi'
                    ? 'DHARA आपको यह फॉर्म भरने में मार्गदर्शन करेगा। तैयार होने पर जारी रखें।'
                    : lang === 'mr'
                    ? 'DHARA तुम्हाला हा फॉर्म भरण्यासाठी मार्गदर्शन करेल. तयार असाल तेव्हा पुढे जा.'
                    : 'DHARA will guide you through filling this form. Continue when ready.'}
                </Text>
                <Pressable
                  testID="voter-start-form"
                  style={s.primaryBtn}
                  onPress={() =>
                    router.push({
                      pathname: '/voter-roll/form',
                      params: { form_type: outcome === 'FORM6' ? 'form6' : 'form8', language: lang },
                    })
                  }
                >
                  <Text style={s.primaryBtnText}>
                    {lang === 'hi'
                      ? `${label} शुरू करें`
                      : lang === 'mr'
                      ? `${label} सुरू करा`
                      : `Start ${label}`}
                  </Text>
                </Pressable>
              </>
            )}

            {/* STATUS_CHECK → open ECI */}
            {outcome === 'STATUS_CHECK' && outcomeData.note && (
              <>
                <Text style={s.outcomeBody}>{t(outcomeData.note, lang)}</Text>
                <Pressable
                  style={s.primaryBtn}
                  onPress={() => openExternal(outcomeData.url ?? 'https://voters.eci.gov.in')}
                >
                  <Text style={s.primaryBtnText}>
                    {lang === 'hi'
                      ? '🔗 ECI पोर्टल खोलें'
                      : lang === 'mr'
                      ? '🔗 ECI पोर्टल उघडा'
                      : '🔗 Open ECI Portal'}
                  </Text>
                </Pressable>
              </>
            )}

            {/* LEGAL_HELP → show message */}
            {outcome === 'LEGAL_HELP' && outcomeData.message && (
              <Text style={s.outcomeBody}>{t(outcomeData.message, lang)}</Text>
            )}
          </View>

          <Pressable testID="voter-reset" onPress={reset} style={s.secondaryBtn}>
            <Text style={s.secondaryBtnText}>
              {lang === 'hi' ? '↺ फिर से शुरू करें' : lang === 'mr' ? '↺ पुन्हा सुरू करा' : '↺ Start over'}
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Question screen ────────────────────────────────────────────────────────
  if (!currentQ) return null;

  const qIndex  = questions.findIndex(q => q.id === currentQId);
  const progress = ((qIndex) / questions.length) * 100;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.scrollContent}>
        <View style={s.progressRow}>
          <View style={s.progressBar}>
            <View style={[s.progressFill, { width: `${progress}%` as any }]} />
          </View>
          <Text style={s.progressText}>{qIndex + 1} / {questions.length}</Text>
        </View>

        <View style={s.questionCard}>
          <Text testID="voter-question" style={s.questionText}>{t(currentQ.text as Record<string, string>, lang)}</Text>
        </View>

        {currentQ.options?.map(opt => (
          <Pressable
            key={opt.id}
            testID={`voter-option-${opt.id}`}
            style={s.optionBtn}
            onPress={() => pickOption(currentQ.id, opt.id, opt.next)}
          >
            <Text style={s.optionText}>{t(opt.text as Record<string, string>, lang)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: BG },
  scrollContent:   { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 },

  header:          { marginBottom: 20 },
  headerTitle:     { fontSize: 26, fontWeight: '700', color: NAVY, letterSpacing: -0.5 },
  headerSub:       { fontSize: 14, color: '#666', marginTop: 4 },

  disclaimerCard:  {
    backgroundColor: '#FFF8E7',
    borderLeftWidth: 4, borderLeftColor: GOLD,
    borderRadius: 8, padding: 14, marginBottom: 24,
  },
  disclaimerText:  { fontSize: 12, color: '#555', lineHeight: 18 },

  primaryBtn:      {
    backgroundColor: NAVY, borderRadius: 12, paddingVertical: 16,
    alignItems: 'center', marginBottom: 12,
  },
  primaryBtnText:  { color: '#FFF', fontWeight: '700', fontSize: 16 },

  secondaryBtn:    {
    borderWidth: 1.5, borderColor: NAVY, borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', marginBottom: 12,
  },
  secondaryBtnText: { color: NAVY, fontWeight: '600', fontSize: 14 },

  backBtn:          { marginBottom: 16 },
  backText:         { color: NAVY, fontSize: 14, fontWeight: '600' },

  outcomeCard:      {
    backgroundColor: '#FFF', borderRadius: 16,
    padding: 20, marginBottom: 20,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  outcomeLabel:     { fontSize: 20, fontWeight: '700', color: NAVY, marginBottom: 12 },
  outcomeBody:      { fontSize: 14, color: '#444', lineHeight: 22, marginBottom: 20 },

  progressRow:      { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  progressBar:      { flex: 1, height: 4, backgroundColor: '#E5E7EB', borderRadius: 2, marginRight: 10 },
  progressFill:     { height: 4, backgroundColor: NAVY, borderRadius: 2 },
  progressText:     { fontSize: 12, color: '#999', minWidth: 40, textAlign: 'right' },

  questionCard:     {
    backgroundColor: NAVY, borderRadius: 16, padding: 20, marginBottom: 20,
  },
  questionText:     { fontSize: 17, fontWeight: '600', color: '#FFF', lineHeight: 26 },

  optionBtn:        {
    backgroundColor: '#FFF', borderRadius: 12, paddingVertical: 16, paddingHorizontal: 18,
    marginBottom: 12, borderWidth: 1.5, borderColor: '#E5E7EB',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  optionText:       { fontSize: 15, color: '#222', lineHeight: 22 },
});
