import React, { useEffect, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth, API_BASE } from '@/src/auth';
import { theme } from '@/src/theme';
import { goBackOr } from '@/src/goBackOr';

const NAVY = theme.colors.primary;
const GOLD = theme.colors.gold;

export default function IntakeView() {
  const { token: authToken } = useAuth();
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const [intake, setIntake] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  useEffect(() => {
    if (!token || !authToken) return;
    fetch(`${API_BASE}/api/advocate/intake/${token}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(setIntake)
      .catch(() => setIntake(null))
      .finally(() => setLoading(false));
  }, [token, authToken]);

  if (loading) return (
    <SafeAreaView style={s.safe}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={NAVY} size="large" />
      </View>
    </SafeAreaView>
  );

  if (!intake) return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable onPress={() => goBackOr(router, '/intakes')}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={s.headerTitle}>Intake</Text>
      </View>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <Ionicons name="alert-circle-outline" size={44} color="#D1D5DB" />
        <Text style={s.notFoundTitle}>Intake not found</Text>
      </View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable onPress={() => goBackOr(router, '/intakes')} style={{ marginRight: 12 }}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>{intake.client_name || 'Intake'}</Text>
          <Text style={s.headerSub}>{intake.completed_at ? new Date(intake.completed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        {intake.summary ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Summary</Text>
            <Text style={s.summaryText}>{intake.summary}</Text>
          </View>
        ) : null}

        {intake.dhara_analysis ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>DHARA Legal Analysis</Text>
            <Text style={s.analysisText}>{intake.dhara_analysis}</Text>
          </View>
        ) : null}

        {Array.isArray(intake.transcript) && intake.transcript.length > 0 && !intake.answers ? (
          <View style={s.section}>
            <Pressable style={s.accordionHeader} onPress={() => setTranscriptOpen(v => !v)}>
              <Text style={s.sectionTitle}>Full Transcript</Text>
              <Ionicons name={transcriptOpen ? 'chevron-up' : 'chevron-down'} size={18} color={NAVY} />
            </Pressable>
            {transcriptOpen && intake.transcript.map((item: string, i: number) => (
              <View key={i} style={s.transcriptItem}>
                <Text style={s.transcriptLabel}>Step {i + 1}</Text>
                <Text style={s.transcriptText}>{item}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {intake.answers && Object.keys(intake.answers).length > 0 ? (
          <View style={s.section}>
            <Pressable style={s.accordionHeader} onPress={() => setTranscriptOpen(v => !v)}>
              <Text style={s.sectionTitle}>Client Answers</Text>
              <Ionicons name={transcriptOpen ? 'chevron-up' : 'chevron-down'} size={18} color={NAVY} />
            </Pressable>
            {transcriptOpen && Object.entries(intake.answers as Record<string, string>).map(([k, v]) => v ? (
              <View key={k} style={s.transcriptItem}>
                <Text style={s.transcriptLabel}>{k.replace(/_/g, ' ')}</Text>
                <Text style={s.transcriptText}>{v}</Text>
              </View>
            ) : null)}
          </View>
        ) : null}

        <Pressable style={s.exportBtn} onPress={() => alert('PDF export coming in the next update.')}
        >
          <Ionicons name="download-outline" size={18} color={NAVY} />
          <Text style={s.exportBtnText}>Export PDF</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#FDFBF7' },
  header: { backgroundColor: NAVY, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
  headerSub: { fontSize: 12, color: GOLD, marginTop: 1 },
  scroll: { padding: 20, gap: 20, paddingBottom: 40 },
  section: { backgroundColor: '#fff', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#E5E7EB' },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: NAVY, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  summaryText: { fontSize: 15, color: '#1F2937', lineHeight: 24 },
  analysisText: { fontSize: 14, color: '#374151', lineHeight: 22, fontFamily: 'monospace' },
  accordionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  transcriptItem: { borderTopWidth: 1, borderTopColor: '#F3F4F6', paddingTop: 10, marginTop: 8 },
  transcriptLabel: { fontSize: 11, fontWeight: '700', color: '#9CA3AF', marginBottom: 4, textTransform: 'uppercase' },
  transcriptText: { fontSize: 14, color: '#374151', lineHeight: 21 },
  exportBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderColor: NAVY, borderRadius: 12, paddingVertical: 13 },
  exportBtnText: { fontSize: 15, fontWeight: '700', color: NAVY },
  notFoundTitle: { fontSize: 18, fontWeight: '700', color: '#374151', marginTop: 12 },
});
