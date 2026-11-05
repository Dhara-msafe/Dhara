import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE } from '../auth';
import { theme } from '../theme';
import type { ConsentCopy } from '../consentCopy';

import { openExternal } from '@/src/outbound';
import { EmergencyNumberStatic, EmergencyNotActiveNotice } from '@/src/components/dhara/EmergencyNumberStatic';
type Citation = { label: string; url: string };
type Topic = {
  id: string; title: string; summary: string; law: string; points: string[];
  citations?: Citation[]; verified_at?: string | null; localized?: boolean; fallback_notice?: string | null;
};
const colors = theme.colors;

/** Read-only public help, outside authenticated tabs; no personal information. */
export function ConsentPublicHelp({ mode, onClose, copy, lang }: {
  mode: 'emergency' | 'rights' | null; onClose: () => void; copy: ConsentCopy; lang?: string;
}) {
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setError(null);
    if (mode !== 'rights') return;
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    setTopics(null);
    void fetch(`${API_BASE}/api/reference/topics?lang=${lang || 'en'}`, { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(data => { if (!Array.isArray(data)) throw new Error(); if (active) setTopics(data); })
      .catch(() => { if (active) setError('Could not load rights information. Check your connection and try again.'); })
      .finally(() => clearTimeout(timer));
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [mode, attempt, lang]);

  return (
    <Modal visible={mode !== null} animationType="slide" onRequestClose={onClose} testID="consent-help-modal">
      <SafeAreaView style={styles.safe}>
        <Text testID="consent-help-title" style={styles.title}>{mode === 'rights' ? copy.rights : copy.emergency}</Text>
        <ScrollView testID="consent-help-scroll" contentContainerStyle={styles.content}>
          {error && <Text testID="consent-help-error" accessibilityRole="alert" style={styles.error}>{error}</Text>}
          {mode === 'emergency' ? <>
            <Text testID="consent-helpline-info" style={styles.body}>In immediate danger, call 112. For help for a child, call 1098. No account is needed.</Text>
            {['112', '1098'].map(number => <EmergencyNumberStatic key={number} label={number === '112' ? 'Emergency' : 'Child Helpline'} number={number} testID={`consent-call-${number}`} />)}
            <EmergencyNotActiveNotice />
          </> : topics ? topics.map(topic => (
            <View key={topic.id} testID={`consent-rights-topic-${topic.id}`} style={styles.topicBlock}>
              <Text selectable style={styles.body}>
                {`${topic.title}\n${topic.summary}\n${topic.law}\n\n${topic.points.map(p => `• ${p}`).join('\n\n')}\n`}
              </Text>
              {!topic.localized && !!topic.fallback_notice && (
                <View style={styles.noticeBox} testID={`consent-notice-${topic.id}`}>
                  <Ionicons name="language-outline" size={14} color={colors.onSurfaceSecondary} />
                  <Text style={styles.noticeText}>{topic.fallback_notice}</Text>
                </View>
              )}
              {!!topic.citations?.length && (
                <View style={styles.citeWrap}>
                  <Text style={styles.citeHeading}>Official sources</Text>
                  {topic.citations.map((c, i) => (
                    <Pressable key={i} testID={`consent-citation-${topic.id}-${i}`} onPress={() => openExternal(c.url)} style={styles.citeRow}>
                      <Ionicons name="open-outline" size={13} color={colors.primary} />
                      <Text style={styles.citeText}>{c.label}</Text>
                    </Pressable>
                  ))}
                  {topic.verified_at && <Text style={styles.verifiedText}>Checked against official text: {topic.verified_at}</Text>}
                </View>
              )}
            </View>
          )) : error ? <Pressable testID="consent-help-retry" accessibilityRole="button" style={styles.button} onPress={() => setAttempt(v => v + 1)}><Text style={styles.buttonText}>{copy.retry}</Text></Pressable>
            : <ActivityIndicator testID="consent-help-loading" color={colors.primary} />}
        </ScrollView>
        <Pressable testID="consent-help-back" accessibilityRole="button" style={[styles.button, styles.back]} onPress={onClose}><Text style={styles.buttonText}>{copy.back}</Text></Pressable>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  title: { padding: 20, fontSize: 24, fontWeight: '700', color: colors.primary },
  content: { padding: 20, gap: 16 },
  body: { color: colors.onSurface, fontSize: 16, lineHeight: 26 },
  error: { color: colors.error, fontSize: 16, lineHeight: 24 },
  button: { padding: 16, minHeight: 48, alignItems: 'center', backgroundColor: colors.primary, borderRadius: 12 },
  buttonText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: '700' },
  back: { margin: 16 },
  topicBlock: { marginBottom: 8 },
  noticeBox: { flexDirection: 'row', gap: 8, backgroundColor: colors.surfaceSecondary, borderRadius: 10, padding: 12, marginTop: 8 },
  noticeText: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 18 },
  citeWrap: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.divider },
  citeHeading: { fontSize: 11, fontWeight: '700', color: colors.onSurfaceSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 },
  citeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, minHeight: 28 },
  citeText: { color: colors.primary, fontSize: 14, textDecorationLine: 'underline', flex: 1 },
  verifiedText: { color: colors.onSurfaceSecondary, fontSize: 11, marginTop: 4, fontStyle: 'italic' },
});