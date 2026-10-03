import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { API_BASE } from '@/src/apiBase';

const c = theme.colors;
type Step = { icon: string; title: string; body: string };
type LessonConfig = { intro: string; steps: Step[]; note: string };

export default function PanicLesson() {
  const router = useRouter();
  const [lesson, setLesson] = useState<LessonConfig | null>(null);

  useEffect(() => {
    // A6 — wording comes from the backend (never hard-coded on-device) so it
    // can be corrected centrally without shipping a new app build.
    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    fetch(`${API_BASE}/api/women/panic-lesson?platform=${platform}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setLesson(d))
      .catch(() => setLesson(null));
  }, []);

  return (
    <View style={styles.root}>
      <ScreenHeader title="20-second panic trigger" subtitle="Call 112 even with DHARA closed" />
      {!lesson ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={c.navy} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          <Text style={styles.intro}>{lesson.intro}</Text>
          {lesson.steps.map((s, i) => (
            <View key={i} style={styles.step}>
              <View style={styles.num}><Text style={styles.numTxt}>{i + 1}</Text></View>
              <View style={styles.iconWrap}><Ionicons name={s.icon as any} size={22} color={c.navy} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepTitle}>{s.title}</Text>
                <Text style={styles.stepBody}>{s.body}</Text>
              </View>
            </View>
          ))}
          <View style={styles.note}>
            <Ionicons name="information-circle-outline" size={18} color={c.darkGold} />
            <Text style={styles.noteTxt}>{lesson.note}</Text>
          </View>
          <Pressable style={styles.btn} onPress={() => router.back()}>
            <Text style={styles.btnTxt}>I understand</Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  intro: { fontFamily: theme.fonts.body, fontSize: 15, color: c.muted, lineHeight: 22, marginBottom: 18 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.lines, padding: 16, marginBottom: 12 },
  num: { width: 26, height: 26, borderRadius: 13, backgroundColor: c.gold, alignItems: 'center', justifyContent: 'center' },
  numTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.navy },
  iconWrap: { width: 40, height: 40, borderRadius: 11, backgroundColor: c.navySoft, alignItems: 'center', justifyContent: 'center' },
  stepTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 16, color: c.ink },
  stepBody: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, marginTop: 3, lineHeight: 19 },
  note: { flexDirection: 'row', gap: 10, backgroundColor: c.goldMuted, borderRadius: 12, padding: 14, marginTop: 6 },
  noteTxt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 13, color: c.ink, lineHeight: 19 },
  btn: { backgroundColor: c.navy, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 20 },
  btnTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 16 },
});
