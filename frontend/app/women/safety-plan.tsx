import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { theme } from '@/src/theme';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { getPlan, savePlan } from '@/src/women/api';

// ─── Failsafe setup checklist data ─────────────────────────────────────────
const FAILSAFE_ITEMS = [
  {
    icon: 'person-outline' as const,
    title: 'Emergency contacts and phone information',
    body: 'Add trusted contacts in your phone\'s Contacts app and fill in your phone\'s emergency information screen (blood type, medical notes, ICE contacts). Lock-screen emergency information may be visible to others before the phone is unlocked.',
  },
  {
    icon: 'call-outline' as const,
    title: 'Learn your phone\'s Emergency SOS shortcut',
    body: 'On iPhone: press and hold the side button and a volume button. On Android: press the power button five times, or use the Emergency SOS option in Quick Settings. The exact shortcut varies by device — check your settings before you need it.',
  },
  {
    icon: 'shield-checkmark-outline' as const,
    title: 'Safety Check (Android Personal Safety app, where supported)',
    body: 'Some Android devices include a Safety Check feature in the Personal Safety app (Settings › Safety & emergency). It lets a chosen contact know you are safe after a set time. Availability varies by manufacturer and region.',
  },
  {
    icon: 'chatbubble-outline' as const,
    title: 'Check In via Messages (iPhone, where supported)',
    body: 'iPhone\'s Check In (Messages › + › Check In) can automatically notify a contact if you do not arrive at a destination. It is a separate Apple feature, independent of DHARA.',
  },
  {
    icon: 'location-outline' as const,
    title: 'Find Hub or Find My — family access requires its own setup',
    body: 'Android\'s Find Hub and iPhone\'s Find My can share your device location with specific people. Each person must accept a separate sharing invitation from you inside that app. Having a DHARA Guardian link does not grant access to Find Hub or Find My.',
  },
  {
    icon: 'card-outline' as const,
    title: 'Keep a minimal emergency card',
    body: 'Carry a small card (or add one to Apple or Google Wallet) with your chosen contact name and number, your doctor\'s number, and any critical medical information. This works when your phone has no battery or signal.',
  },
  {
    icon: 'alert-circle-outline' as const,
    title: 'Emergency Location Service concerns emergency services only',
    body: 'Android\'s Emergency Location Service (Settings › Safety & emergency) sends your location to emergency services when you call 112. It is distinct from DHARA\'s family sharing and does not share your location with friends or family.',
  },
] as const;

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
  const [checklistOpen, setChecklistOpen] = useState(false);

  useEffect(() => { getPlan().then(setAns); }, []);

  const set = (i: number, v: string) => setAns(p => ({ ...p, [i]: v }));
  const save = async () => { await savePlan(ans); setDone(true); setTimeout(() => router.back(), 1200); };
  const filled = Object.values(ans).filter(v => v && v.trim()).length;

  return (
    <View style={styles.root}>
      <ScreenHeader title="My safety plan" subtitle="Private · stored only on this phone" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }}>

        {/* ── Failsafe setup checklist ── */}
        <Pressable
          style={styles.checklistHeader}
          onPress={() => setChecklistOpen(o => !o)}
          accessibilityRole="button"
          accessibilityState={{ expanded: checklistOpen }}
          accessibilityLabel="Before you head out — phone safety setup"
          accessibilityHint={checklistOpen ? 'Collapse section' : 'Expand to see phone-level safety steps'}
        >
          <Ionicons name="shield-outline" size={20} color={c.navy} style={{ marginRight: 10 }} />
          <Text style={styles.checklistTitle}>Before you head out — phone safety setup</Text>
          <Ionicons
            name={checklistOpen ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={c.muted}
            style={{ marginLeft: 'auto' }}
          />
        </Pressable>

        {checklistOpen && (
          <View style={styles.checklistBody}>
            {FAILSAFE_ITEMS.map((item, idx) => (
              <View key={idx} style={styles.checklistItem}>
                <View style={styles.checklistIconWrap}>
                  <Ionicons name={item.icon} size={18} color={c.navy} />
                </View>
                <View style={styles.checklistText}>
                  <Text style={styles.checklistItemTitle}>{item.title}</Text>
                  <Text style={styles.checklistItemBody}>{item.body}</Text>
                </View>
              </View>
            ))}
            <Text style={styles.checklistFooter}>
              These features are provided by your phone and may vary by device and region. DHARA does not activate or control them.
            </Text>
          </View>
        )}

        {/* ── Progress + questions ── */}
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
  // ── Failsafe checklist ──────────────────────────────────────────────────
  checklistHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.lines,
    padding: 16,
    marginBottom: 4,
    minHeight: 56,
  },
  checklistTitle: {
    fontFamily: theme.fonts.bodyBold,
    fontSize: 14,
    color: c.navy,
    flex: 1,
    lineHeight: 20,
  },
  checklistBody: {
    backgroundColor: c.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.lines,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    marginBottom: 16,
  },
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: c.lines,
    gap: 12,
  },
  checklistIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: c.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    flexShrink: 0,
  },
  checklistText: { flex: 1 },
  checklistItemTitle: {
    fontFamily: theme.fonts.bodyBold,
    fontSize: 13,
    color: c.ink,
    lineHeight: 18,
    marginBottom: 4,
  },
  checklistItemBody: {
    fontFamily: theme.fonts.body,
    fontSize: 13,
    color: c.muted,
    lineHeight: 19,
  },
  checklistFooter: {
    fontFamily: theme.fonts.body,
    fontSize: 12,
    color: c.muted,
    lineHeight: 17,
    marginTop: 12,
    fontStyle: 'italic',
  },
  // ── Safety plan questions ───────────────────────────────────────────────
  progress: { marginBottom: 18, marginTop: 4 },
  progressTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.muted, marginBottom: 8 },
  track: { height: 8, borderRadius: 4, backgroundColor: c.surfaceTertiary, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: c.gold },
  qCard: { backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.lines, padding: 16, marginBottom: 12 },
  q: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.ink, lineHeight: 22, marginBottom: 10 },
  input: { backgroundColor: c.background, borderWidth: 1, borderColor: c.lines, borderRadius: 10, padding: 12, fontFamily: theme.fonts.body, fontSize: 15, color: c.ink, minHeight: 48, textAlignVertical: 'top' },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.navy, borderRadius: 12, paddingVertical: 16, marginTop: 8 },
  saveTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 16 },
});
