/**
 * Generic reusable workflow screen for Visitor Mode.
 * Renders a list of steps with Speak-For-Me per step.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { WorkflowStep } from '@/src/visitor/content';
import { API_BASE, useAuth } from '@/src/auth';

import { openExternal } from '@/src/outbound';
const C = theme.colors;

type Props = {
  headerColor: string;
  headerIcon: string;
  headerTitle: string;
  headerSub: string;
  steps: WorkflowStep[];
  langCode: string;
  footnote?: string;
};

export default function WorkflowScreen({
  headerColor, headerIcon, headerTitle, headerSub,
  steps, langCode, footnote,
}: Props) {
  const { token } = useAuth();
  const [speaking, setSpeaking] = useState<string | null>(null);

  const t = (map: Record<string, string> | undefined) =>
    map ? (map[langCode] || map['en'] || '') : '';

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
      Alert.alert('Speak For Me', step.speak_hi || '', [{ text: 'OK' }]);
    }
  }, [token]);

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.content}>
        <View style={[s.header, { backgroundColor: headerColor }]}>
          <Ionicons name={headerIcon as any} size={36} color="#fff" />
          <View style={s.headerText}>
            <Text style={s.headerTitle}>{headerTitle}</Text>
            <Text style={s.headerSub}>{headerSub}</Text>
          </View>
        </View>

        {steps.map((step, idx) => (
          <View key={step.id} style={s.stepCard}>
            <View style={s.stepNumRow}>
              <View style={[s.stepNum, { backgroundColor: headerColor }]}>
                <Text style={s.stepNumText}>{idx + 1}</Text>
              </View>
              <Text style={s.stepTitle}>{t(step.title)}</Text>
            </View>

            <Text style={s.stepBody}>{t(step.body)}</Text>

            {step.callNumber && (
              <Pressable
                style={[s.actionBtn, { backgroundColor: headerColor }]}
                onPress={() => {
                  const n = step.callNumber!;
                  openExternal(n.startsWith('http') ? n : `tel:${n}`).catch(() => {});
                }}
              >
                <Ionicons
                  name={step.callNumber!.startsWith('http') ? 'globe-outline' : 'call'}
                  size={18} color="#fff"
                />
                <Text style={s.actionBtnText}>{t(step.callLabel!) || step.callNumber}</Text>
              </Pressable>
            )}

            {step.speak_hi && (
              <View>
                <Text style={s.speakLabel}>🎤 SPEAK FOR ME (Hindi):</Text>
                <View style={s.speakBox}>
                  <Text style={s.speakText}>{step.speak_hi}</Text>
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
                    {speaking === step.id ? 'Playing…' : 'Play in Hindi'}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        ))}

        {footnote && <Text style={s.footnote}>{footnote}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: C.background },
  content: { padding: 16, paddingBottom: 40 },
  header:  {
    borderRadius: 16, padding: 18, flexDirection: 'row',
    alignItems: 'center', gap: 14, marginBottom: 16,
  },
  headerText:  { flex: 1 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#fff' },
  headerSub:   { fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 3 },
  stepCard:   {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    marginBottom: 12, borderWidth: 1, borderColor: C.divider,
  },
  stepNumRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  stepNum:    { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
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
  footnote:   { fontSize: 11, color: C.onSurfaceTertiary, textAlign: 'center', lineHeight: 17, marginTop: 4 },
});
