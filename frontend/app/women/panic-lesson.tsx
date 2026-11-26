import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { API_BASE } from '@/src/apiBase';
import { useScreenSpeech } from '@/src/hooks/useScreenSpeech';
// NF-UI-REV-09 (Group H, DHARA UI Revision v2.2.1): presentation-only
// rollback flag + visible keyboard-focus ring + missing a11y labels.
import { UI_REVISION_V1 } from '@/src/designRevision';
import { focusRingStyle } from '@/src/a11yFocus';
// Step S4 (Shield tools, v2.2 design, 23 Nov handover): visual-only reskin
// to the dark "Shield mode" palette. Presentation-only, reversible.
import { UI_V22_S4 } from '@/src/uiV22Flags';
import { shieldColors, shieldGradient } from '@/src/shieldTheme';

const c = theme.colors;
// Per-step accent colours, in order, from the v2.2 design (PanicLesson.dc.html)
const STEP_ACCENTS = [
  { bg: shieldColors.pinkSofter, nc: shieldColors.pink },
  { bg: 'rgba(90,75,158,.15)', nc: shieldColors.lavender },
  { bg: shieldColors.goldBg, nc: shieldColors.gold },
  { bg: shieldColors.pinkSofter, nc: shieldColors.rose },
  { bg: shieldColors.greenBg, nc: shieldColors.green },
];
type Step = { icon: string; title: string; body: string };
type LessonConfig = { intro: string; steps: Step[]; note: string };

export default function PanicLesson() {
  const router = useRouter();
  const [lesson, setLesson] = useState<LessonConfig | null>(null);
  const speech = useScreenSpeech();

  useEffect(() => {
    // A6 — wording comes from the backend (never hard-coded on-device) so it
    // can be corrected centrally without shipping a new app build.
    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    fetch(`${API_BASE}/api/women/panic-lesson?platform=${platform}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setLesson(d))
      .catch(() => setLesson(null));
  }, []);

  // This is a "voice lesson" — narrated on request. Never auto-plays: the
  // existing voice pipeline deliberately never speaks until the user taps
  // Listen (autoplay audio can be unsafe/unwanted in a safety context).
  const listenToLesson = () => {
    if (!lesson) return;
    const full = [lesson.intro, ...lesson.steps.map((s, i) => `${i + 1}. ${s.title}. ${s.body}`), lesson.note].join(' ');
    // B-94/B-79: fixed, canned safety content -- never metered.
    void speech.listen(full, 'fixed_screen');
  };

  const body = (
    <>
      <ScreenHeader title="20-second panic trigger" subtitle="Call 112 even with DHARA closed" />
      {!lesson ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={UI_V22_S4 ? shieldColors.text : c.navy} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <Pressable
            testID="panic-lesson-listen"
            style={(s) => [styles.listenBtn, focusRingStyle(s)]}
            onPress={speech.speaking ? speech.stop : listenToLesson}
            accessibilityRole="button"
            accessibilityLabel={speech.speaking ? 'Stop listening' : 'Listen to this lesson'}
          >
            <Ionicons name={speech.speaking ? 'stop-circle-outline' : 'volume-high-outline'} size={18} color={UI_V22_S4 ? shieldColors.text : c.navy} />
            <Text style={styles.listenTxt}>{speech.speaking ? 'Stop' : 'Listen to this lesson'}</Text>
          </Pressable>
          {!!speech.error && <Text style={styles.speechError}>{speech.error}</Text>}
          <Text style={styles.intro}>{lesson.intro}</Text>
          {lesson.steps.map((s, i) => {
            const accent = STEP_ACCENTS[i % STEP_ACCENTS.length];
            return (
              <View key={i} style={styles.step}>
                <View style={[styles.num, UI_V22_S4 && { backgroundColor: accent.bg }]}>
                  <Text style={[styles.numTxt, UI_V22_S4 && { color: accent.nc }]}>{i + 1}</Text>
                </View>
                <View style={styles.iconWrap}><Ionicons name={s.icon as any} size={22} color={UI_V22_S4 ? shieldColors.text : c.navy} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stepTitle}>{s.title}</Text>
                  <Text style={styles.stepBody}>{s.body}</Text>
                </View>
              </View>
            );
          })}
          <View style={styles.note}>
            <Ionicons name="information-circle-outline" size={18} color={UI_V22_S4 ? shieldColors.tipIcon : c.darkGold} />
            <Text style={styles.noteTxt}>{lesson.note}</Text>
          </View>
          <Pressable style={(s) => [styles.btn, focusRingStyle(s)]} onPress={() => { speech.stop(); router.back(); }} accessibilityRole="button" accessibilityLabel="I understand">
            <Text style={styles.btnTxt}>I understand</Text>
          </Pressable>
        </ScrollView>
      )}
    </>
  );

  if (UI_V22_S4) {
    return (
      <LinearGradient colors={shieldGradient.colors} start={shieldGradient.start} end={shieldGradient.end} style={styles.root}>
        {body}
      </LinearGradient>
    );
  }
  return <View style={styles.root}>{body}</View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: UI_V22_S4 ? 'transparent' : c.background },
  intro: { fontFamily: theme.fonts.body, fontSize: 13, color: UI_V22_S4 ? shieldColors.textMuted : c.muted, lineHeight: 19, marginBottom: 18 },
  listenBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: UI_V22_S4 ? shieldColors.chipBg : c.navySoft,
    borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, alignSelf: 'flex-start', marginBottom: 14,
    minHeight: UI_REVISION_V1 ? 48 : 44,
    ...(UI_V22_S4 ? { borderWidth: 1, borderColor: shieldColors.chipBorder } : null),
  },
  listenTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 13, color: UI_V22_S4 ? shieldColors.text : c.navy },
  speechError: { fontFamily: theme.fonts.body, fontSize: 12, color: c.error, marginBottom: 10 },
  step: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: UI_V22_S4 ? shieldColors.cardBg : c.surface,
    borderRadius: 16, borderWidth: 1,
    borderColor: UI_V22_S4 ? shieldColors.cardBorder : c.lines,
    padding: 16, marginBottom: 12,
  },
  num: { width: UI_V22_S4 ? 36 : 26, height: UI_V22_S4 ? 36 : 26, borderRadius: UI_V22_S4 ? 18 : 13, backgroundColor: c.gold, alignItems: 'center', justifyContent: 'center' },
  numTxt: { fontFamily: theme.fonts.displayBold, fontSize: 14, color: c.navy },
  iconWrap: { width: 40, height: 40, borderRadius: 11, backgroundColor: UI_V22_S4 ? shieldColors.chipBg : c.navySoft, alignItems: 'center', justifyContent: 'center' },
  stepTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: UI_V22_S4 ? shieldColors.text : c.ink },
  stepBody: { fontFamily: theme.fonts.body, fontSize: 12, color: UI_V22_S4 ? shieldColors.textMuted : c.muted, marginTop: 3, lineHeight: 17 },
  note: {
    flexDirection: 'row', gap: 10,
    backgroundColor: UI_V22_S4 ? shieldColors.tipBg : c.goldMuted,
    borderRadius: 14, padding: 14, marginTop: 6,
    ...(UI_V22_S4 ? { borderWidth: 1, borderColor: shieldColors.tipBorder } : null),
  },
  noteTxt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 12, color: UI_V22_S4 ? shieldColors.textMuted : c.ink, lineHeight: 17 },
  btn: {
    backgroundColor: UI_V22_S4 ? shieldColors.lavenderBgDeep : c.navy,
    borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 20,
  },
  btnTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 14 },
});
