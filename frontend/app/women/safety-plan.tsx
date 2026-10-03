import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { theme } from '@/src/theme';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { getPlan, savePlan } from '@/src/women/api';

const c = theme.colors;
const QUESTIONS = [
  'Where can you go quickly if you need to leave? (a relative, a friend, a shelter)',
  'Who are the people you trust to call any time?',
  'Where do you keep important documents (ID, bank, children\u2019s papers)?',
  'What is the fastest safe way out of your home?',
  'What will you take with you if you must leave suddenly?',
  'How will you keep some money within reach?',
  'What is a safe word to tell children it is time to go?',
  'Which helpline will you call first — 112, 181 or 1930?',
];

export default function SafetyPlan() {
  const router = useRouter();
  const [ans, setAns] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  useEffect(() => { getPlan().then(setAns); }, []);

  const set = (i: number, v: string) => setAns(p => ({ ...p, [i]: v }));
  const save = async () => { await savePlan(ans); setDone(true); setTimeout(() => router.back(), 1200); };
  const filled = Object.values(ans).filter(v => v && v.trim()).length;

  return (
    <View style={styles.root}>
      <ScreenHeader title="My safety plan" subtitle="Private · stored only on this phone" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }}>
        <View style={styles.progress}>
          <Text style={styles.progressTxt}>{filled} of {QUESTIONS.length} answered</Text>
          <View style={styles.track}><View style={[styles.fill, { width: `${(filled / QUESTIONS.length) * 100}%` }]} /></View>
        </View>
        {QUESTIONS.map((q, i) => (
          <View key={i} style={styles.qCard}>
            <Text style={styles.q}>{i + 1}. {q}</Text>
            <TextInput value={ans[i] || ''} onChangeText={v => set(i, v)} placeholder="Your answer (optional)" placeholderTextColor={c.muted} style={styles.input} multiline />
          </View>
        ))}
        <Pressable style={styles.saveBtn} onPress={save}>
          <Ionicons name={done ? 'checkmark-circle' : 'save-outline'} size={18} color="#fff" />
          <Text style={styles.saveTxt}>{done ? 'Saved privately' : 'Save my plan'}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  progress: { marginBottom: 18 },
  progressTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.muted, marginBottom: 8 },
  track: { height: 8, borderRadius: 4, backgroundColor: c.surfaceTertiary, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: c.gold },
  qCard: { backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.lines, padding: 16, marginBottom: 12 },
  q: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.ink, lineHeight: 22, marginBottom: 10 },
  input: { backgroundColor: c.background, borderWidth: 1, borderColor: c.lines, borderRadius: 10, padding: 12, fontFamily: theme.fonts.body, fontSize: 15, color: c.ink, minHeight: 48, textAlignVertical: 'top' },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.navy, borderRadius: 12, paddingVertical: 16, marginTop: 8 },
  saveTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 16 },
});
