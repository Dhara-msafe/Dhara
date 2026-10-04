/**
 * Visitor Mode — V4: Lost Passport Workflow + V3: Speak For Me
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
  ActivityIndicator, Alert, Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { loadVisitorSession, VisitorSession } from '@/src/visitor/session';
import { LOST_PASSPORT_STEPS, EMBASSY_CONTACTS, WorkflowStep } from '@/src/visitor/content';
import { API_BASE, useAuth } from '@/src/auth';

const C = theme.colors;
const EMBASSY_KEY_STORAGE = 'dhara_visitor_embassy_key';

export default function VisitorLostPassport() {
  const { token } = useAuth();
  const [session, setSession] = useState<VisitorSession | null>(null);
  const [speaking, setSpeaking] = useState<string | null>(null);
  // DHARA-B020: never infer embassy from interface language alone — a
  // visitor can speak English without being British. Require an explicit
  // nationality confirmation (or "not sure") before showing any embassy.
  const [confirmedEmbassyKey, setConfirmedEmbassyKey] = useState<string | null>(null);

  useEffect(() => {
    loadVisitorSession().then(s => setSession(s));
    AsyncStorage.getItem(EMBASSY_KEY_STORAGE).then(v => { if (v) setConfirmedEmbassyKey(v); });
  }, []);

  const confirmEmbassy = useCallback((key: string) => {
    setConfirmedEmbassyKey(key);
    AsyncStorage.setItem(EMBASSY_KEY_STORAGE, key).catch(() => {});
  }, []);

  const lc   = session?.touristLang.code || 'en';
  const t    = (map: Record<string, string> | undefined) => map ? (map[lc] || map['en'] || '') : '';
  const suggestedEmb = EMBASSY_CONTACTS[lc] || EMBASSY_CONTACTS['en'];
  const emb  = confirmedEmbassyKey && confirmedEmbassyKey !== 'unknown'
    ? (EMBASSY_CONTACTS[confirmedEmbassyKey] || suggestedEmb)
    : null;

  // V3: Speak For Me
  const speakForMe = useCallback(async (step: WorkflowStep) => {
    if (!step.speak_hi) return;
    if (!token) {
      Alert.alert('Sign in required', 'Sign in to DHARA to use Speak For Me.');
      return;
    }
    setSpeaking(step.id);
    try {
      const res = await fetch(`${API_BASE}/api/voice/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: step.speak_hi, language: 'hi', voice: 'alloy' }),
      });
      if (!res.ok) throw new Error('TTS failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new (window as any).Audio(url);
      audio.onended = () => { setSpeaking(null); URL.revokeObjectURL(url); };
      audio.onerror = () => setSpeaking(null);
      await audio.play();
    } catch {
      setSpeaking(null);
      Alert.alert('Speak For Me', step.speak_hi, [{ text: 'OK' }]);
    }
  }, [token]);

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
        {/* Header */}
        <View style={s.header}>
          <Ionicons name="document-outline" size={36} color="#fff" />
          <View style={s.headerText}>
            <Text style={s.headerTitle}>Lost Passport</Text>
            <Text style={s.headerSub}>{session.indianStateName} · {session.touristLang.label}</Text>
          </View>
        </View>

        {/* Embassy card — DHARA-B020: require explicit nationality confirmation */}
        {!confirmedEmbassyKey ? (
          <View style={s.nationalityCard}>
            <Text style={s.nationalityTitle}>Which embassy should we show you?</Text>
            <Text style={s.nationalitySub}>
              Based on your app language we guessed <Text style={{ fontWeight: '700' }}>{suggestedEmb.name}</Text> — but speaking a language doesn&apos;t always match your citizenship. Please confirm:
            </Text>
            <Pressable style={s.nationalityConfirmBtn} onPress={() => confirmEmbassy(lc)}>
              <Ionicons name="checkmark-circle" size={18} color="#fff" />
              <Text style={s.actionBtnText}>Yes, I&apos;m a citizen of {suggestedEmb.name.replace(/^(The |Embassy of |Embassy |High Commission)/i, '')}</Text>
            </Pressable>
            <Text style={s.nationalitySub}>Or choose your actual country:</Text>
            <View style={s.nationalityList}>
              {Object.entries(EMBASSY_CONTACTS).filter(([key]) => key !== lc && key !== 'hi').map(([key, e]) => (
                <Pressable key={key} style={s.nationalityChip} onPress={() => confirmEmbassy(key)}>
                  <Text style={s.nationalityChipTxt}>{e.name}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable style={s.nationalityUnsureBtn} onPress={() => confirmEmbassy('unknown')}>
              <Text style={s.nationalityUnsureTxt}>Not sure / my country isn&apos;t listed</Text>
            </Pressable>
          </View>
        ) : emb ? (
          <View style={s.embassyCard}>
            <View style={s.embassyRow}>
              <Ionicons name="flag" size={20} color={C.gold} />
              <Text style={s.embassyTitle}>{emb.name}</Text>
              <Pressable onPress={() => setConfirmedEmbassyKey(null)}><Text style={s.embassyChange}>Change</Text></Pressable>
            </View>
            <Text style={s.embassyCity}>{emb.city}</Text>
            <Pressable
              style={s.embassyCall}
              onPress={() => Linking.openURL(`tel:${emb.phone.replace(/[\s-]/g,'')}`).catch(() => {})}
            >
              <Ionicons name="call" size={16} color={C.gold} />
              <Text style={s.embassyPhone}>{emb.phone}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={s.embassyCard}>
            <View style={s.embassyRow}>
              <Ionicons name="help-circle" size={20} color={C.gold} />
              <Text style={s.embassyTitle}>Embassy not confirmed</Text>
              <Pressable onPress={() => setConfirmedEmbassyKey(null)}><Text style={s.embassyChange}>Choose</Text></Pressable>
            </View>
            <Text style={s.embassyCity}>
              Search &quot;[your country] embassy India&quot; online, or call India&apos;s Ministry of External Affairs: +91-11-23388040. For any emergency, call 112.
            </Text>
          </View>
        )}

        {/* Steps */}
        {LOST_PASSPORT_STEPS.map((step, idx) => (
          <View key={step.id} style={s.stepCard}>
            <View style={s.stepNumRow}>
              <View style={s.stepNum}><Text style={s.stepNumText}>{idx + 1}</Text></View>
              <Text style={s.stepTitle}>{t(step.title)}</Text>
            </View>

            <Text style={s.stepBody}>{t(step.body)}</Text>

            {/* Call / URL button */}
            {step.callNumber && (
              <Pressable
                style={[s.actionBtn, { backgroundColor: C.primary }]}
                onPress={() => {
                  const num = step.callNumber!;
                  const url = num.startsWith('http') ? num : `tel:${num}`;
                  Linking.openURL(url).catch(() => {});
                }}
              >
                <Ionicons
                  name={step.callNumber.startsWith('http') ? 'globe-outline' : 'call'}
                  size={18} color="#fff"
                />
                <Text style={s.actionBtnText}>{t(step.callLabel!) || step.callNumber}</Text>
              </Pressable>
            )}

            {/* Speak For Me */}
            {step.speak_hi && (
              <View>
                <Text style={s.speakLabel}>🎙 SPEAK FOR ME (to official in Hindi):</Text>
                <View style={s.speakBox}>
                  <Text style={s.speakText}>{step.speak_hi}</Text>
                </View>
                <Pressable
                  style={[s.actionBtn, { backgroundColor: C.primaryMid, marginTop: 8 }]}
                  onPress={() => speakForMe(step)}
                  disabled={speaking === step.id}
                >
                  {speaking === step.id
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Ionicons name="volume-high-outline" size={18} color="#fff" />}
                  <Text style={s.actionBtnText}>
                    {speaking === step.id ? 'Playing…' : 'Play in Hindi'}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        ))}

        {/* FIR shortcut */}
        <View style={s.firCard}>
          <Ionicons name="information-circle" size={20} color={C.primary} />
          <Text style={s.firText}>
            Need help drafting the police complaint? Use DHARA&apos;s FIR builder — tap <Text style={{ fontWeight: '700' }}>Complaints</Text> tab in the main app.
          </Text>
        </View>

        <Text style={s.footnote}>
          DHARA provides general guidance only. Always contact your embassy first for official assistance.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: C.background },
  content: { padding: 16, paddingBottom: 40 },

  header:     {
    backgroundColor: C.primary, borderRadius: 16, padding: 18,
    flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14,
  },
  headerText:  { flex: 1 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#fff' },
  headerSub:   { fontSize: 12, color: '#C5CEEA', marginTop: 3 },

  embassyCard: {
    backgroundColor: C.primary, borderRadius: 14, padding: 16, marginBottom: 14,
    gap: 6,
  },
  embassyRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  embassyTitle:{ fontSize: 14, fontWeight: '700', color: '#fff', flex: 1 },
  embassyChange:{ fontSize: 12, fontWeight: '700', color: C.gold, textDecorationLine: 'underline' },
  embassyCity: { fontSize: 12, color: '#C5CEEA', marginLeft: 28 },
  embassyCall: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 28, marginTop: 4 },
  embassyPhone:{ fontSize: 15, fontWeight: '700', color: C.gold },

  nationalityCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 14,
    borderWidth: 1, borderColor: C.divider, gap: 10,
  },
  nationalityTitle: { fontSize: 15, fontWeight: '800', color: C.onSurface },
  nationalitySub:   { fontSize: 12, color: C.onSurfaceTertiary, lineHeight: 18 },
  nationalityConfirmBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.primary, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 10,
  },
  nationalityList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  nationalityChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.navySoft },
  nationalityChipTxt: { fontSize: 12, fontWeight: '600', color: C.primary },
  nationalityUnsureBtn: { alignItems: 'center', paddingVertical: 8 },
  nationalityUnsureTxt: { fontSize: 12, color: C.onSurfaceTertiary, textDecorationLine: 'underline' },

  stepCard:   {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    marginBottom: 12, borderWidth: 1, borderColor: C.divider,
  },
  stepNumRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  stepNum:    {
    width: 28, height: 28, borderRadius: 14, backgroundColor: C.primary,
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

  firCard: {
    flexDirection: 'row', gap: 10, backgroundColor: '#EFF6FF',
    borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#BFDBFE',
    alignItems: 'flex-start', marginBottom: 12,
  },
  firText: { flex: 1, fontSize: 13, color: C.primary, lineHeight: 19 },

  footnote: {
    fontSize: 11, color: C.onSurfaceTertiary, textAlign: 'center',
    lineHeight: 17, marginTop: 4,
  },
});
