/**
 * Visitor Mode — V4: Emergency Workflow + V3: Speak For Me
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
  ActivityIndicator, Alert, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { loadVisitorSession, VisitorSession } from '@/src/visitor/session';
import { EMERGENCY_STEPS, WorkflowStep } from '@/src/visitor/content';
import { useAuth } from '@/src/auth';
import { speakLangFor, phraseIn, playPhrase } from '@/src/visitor/speakForMe';

const C = theme.colors;

export default function VisitorEmergency() {
  const { token } = useAuth();
  const [session, setSession] = useState<VisitorSession | null>(null);
  const [speaking, setSpeaking] = useState<string | null>(null); // step id being spoken

  useEffect(() => {
    loadVisitorSession().then(s => setSession(s));
  }, []);

  const lc = session?.touristLang.code || 'en';
  const t = (map: Record<string, string> | undefined) => {
    if (!map) return '';
    return map[lc] || map['en'] || '';
  };

  // V3: Speak For Me — speak the phrase to an official in the STATE language
  // (Marathi in Maharashtra, Tamil in Tamil Nadu …), not always Hindi.
  const speakLang = speakLangFor(session?.indianState);
  const [localPhrases, setLocalPhrases] = useState<Record<string, string>>({});
  const phraseFor = (step: WorkflowStep) => localPhrases[step.id] || step.speak_hi || '';

  // Pre-translate every phrase on load so the cards show the state language
  // straight away (not Hindi until tapped).
  useEffect(() => {
    if (!token || speakLang.code === 'hi') return;
    let alive = true;
    EMERGENCY_STEPS.filter(st => st.speak_hi).forEach(st => {
      phraseIn(st.speak_hi!, speakLang, token)
        .then(txt => { if (alive) setLocalPhrases(prev => ({ ...prev, [st.id]: txt })); })
        .catch(() => {});
    });
    return () => { alive = false; };
  }, [token, speakLang.code]);

  const speakForMe = useCallback(async (step: WorkflowStep) => {
    if (!step.speak_hi) return;
    if (!token) {
      Alert.alert('Sign in required', 'Sign in to DHARA to use Speak For Me feature.');
      return;
    }
    setSpeaking(step.id);
    let text = step.speak_hi;
    try {
      text = await phraseIn(step.speak_hi, speakLang, token);
      setLocalPhrases(prev => ({ ...prev, [step.id]: text }));
      await playPhrase(text, speakLang.code, token);
    } catch {
      Alert.alert('Speak For Me', text, [{ text: 'OK' }]);
    } finally {
      setSpeaking(null);
    }
  }, [token, speakLang]);

  if (!session) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={C.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.content}>
        {/* Header card */}
        <View style={s.header}>
          <Ionicons name="alert-circle" size={36} color="#fff" />
          <View style={s.headerText}>
            <Text style={s.headerTitle}>Emergency Help</Text>
            <Text style={s.headerSub}>Follow these steps. Call 112 first.</Text>
          </View>
        </View>

        {/* Steps */}
        {EMERGENCY_STEPS.map((step, idx) => (
          <View key={step.id} style={s.stepCard}>
            <View style={s.stepNumRow}>
              <View style={s.stepNum}><Text style={s.stepNumText}>{idx + 1}</Text></View>
              <Text style={s.stepTitle}>{t(step.title)}</Text>
            </View>

            <Text style={s.stepBody}>{t(step.body)}</Text>

            {/* Call button */}
            {step.callNumber && (
              <Pressable
                style={[s.actionBtn, { backgroundColor: C.error }]}
                onPress={() => {
                  const num = step.callNumber!;
                  const url = num.startsWith('http') ? num : `tel:${num}`;
                  Linking.openURL(url).catch(() => {});
                }}
              >
                <Ionicons name="call" size={18} color="#fff" />
                <Text style={s.actionBtnText}>{t(step.callLabel!) || step.callNumber}</Text>
              </Pressable>
            )}

            {/* Speak For Me */}
            {step.speak_hi && (
              <View>
                <Text style={s.speakLabel}>{`🎙 SPEAK FOR ME (to official in ${speakLang.label}):`}</Text>
                <View style={s.speakBox}>
                  <Text style={s.speakText}>{phraseFor(step)}</Text>
                </View>
                <Pressable
                  style={[s.actionBtn, { backgroundColor: C.primary, marginTop: 8 }]}
                  onPress={() => speakForMe(step)}
                  disabled={speaking === step.id}
                >
                  {speaking === step.id
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Ionicons name="volume-high-outline" size={18} color="#fff" />}
                  <Text style={s.actionBtnText}>
                    {speaking === step.id ? 'Playing…' : `Play in ${speakLang.label}`}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        ))}

        <Text style={s.footnote}>
          DHARA provides general guidance only. Always prioritise your safety.
          Call 112 immediately in life-threatening situations.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: C.background },
  content: { padding: 16, paddingBottom: 40 },

  header:     {
    backgroundColor: C.error, borderRadius: 16, padding: 18,
    flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16,
  },
  headerText:  { flex: 1 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#fff' },
  headerSub:   { fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 3 },

  stepCard:   {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    marginBottom: 12, borderWidth: 1, borderColor: C.divider,
  },
  stepNumRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  stepNum:    {
    width: 28, height: 28, borderRadius: 14, backgroundColor: C.error,
    alignItems: 'center', justifyContent: 'center',
  },
  stepNumText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  stepTitle:   { flex: 1, fontSize: 15, fontWeight: '700', color: C.onSurface },
  stepBody:    { fontSize: 13, color: C.onSurfaceTertiary, lineHeight: 20, marginBottom: 12 },

  actionBtn:     {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: 10, paddingVertical: 12, marginBottom: 8,
  },
  actionBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  speakLabel: { fontSize: 11, fontWeight: '700', color: C.primary, letterSpacing: 0.5, marginBottom: 6 },
  speakBox:   {
    backgroundColor: C.navySoft, borderRadius: 10, padding: 12,
    borderLeftWidth: 3, borderLeftColor: C.primary,
  },
  speakText:  { fontSize: 14, color: C.primary, lineHeight: 22, fontStyle: 'italic' },

  footnote: {
    fontSize: 11, color: C.onSurfaceTertiary, textAlign: 'center',
    lineHeight: 17, marginTop: 8,
  },
});
