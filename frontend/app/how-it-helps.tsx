/**
 * "How DHARA helps you" — screen 3 of the v2.2 design manifest (Welcome.dc.html).
 *
 * v2.2.1 Stage 4, Group D: this screen did not exist anywhere in the live
 * app — the real flow went Splash -> Language -> Login/Consent -> Home with
 * nothing in between. Built fresh from the handoff mockup
 * (memory/dhara_redesign/handoff/screens/Welcome.dc.html), per the owner's
 * explicit confirmation to build it now (new functionality, not a revision
 * of something that existed).
 *
 * Deliberately NOT built: the mockup's "Read this page to me" toggle. That
 * is a separate TTS feature, not covered by the manifest's change_summary
 * for this screen ("Copy correction" only) — adding it would be new
 * functionality beyond what was confirmed. Flagged for a separate decision.
 *
 * Copy is taken verbatim from the mockup — it already matches the
 * corrected-wording style in COPY_AND_CAPABILITY_AUDIT.csv (no pricing, no
 * encryption/offline overclaims, no compliance badges); there was no
 * "before" text in this repo to diff against.
 *
 * Only shown to users going through language selection for the first time:
 * language.tsx's "from=home" branch (changing language later, from
 * Settings) still skips straight back/home, same as before this screen
 * existed.
 */
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { goBackOr } from '@/src/goBackOr';
import { focusRingStyle } from '@/src/a11yFocus';

const c = theme.colors;

const FEATURES: {
  icon: keyof typeof Ionicons.glyphMap;
  iconBg: string;
  iconColor: string;
  title: string;
  body: string;
}[] = [
  {
    icon: 'mic-outline', iconBg: '#D4E8D9', iconColor: c.success,
    title: "Speak, don't type",
    body: "Tell DHARA what happened in the language you choose. No legal words needed.",
  },
  {
    icon: 'shield-checkmark-outline', iconBg: '#D4DEF0', iconColor: c.brand,
    title: 'Know your rights',
    body: 'Answers draw on current Indian law (BNS 2023, BNSS, Constitution). DHARA is not a substitute for legal advice.',
  },
  {
    icon: 'flash-outline', iconBg: '#FFE8C6', iconColor: c.darkGold,
    title: 'Take action',
    body: 'File complaints, draft legal notices, scan documents. DHARA guides you step by step.',
  },
  {
    icon: 'shield-half-outline', iconBg: '#F8C8D4', iconColor: c.emergencyRed,
    title: 'Stay safe',
    body: "Women's Shield, emergency SOS, trusted circle and discreet safety tools when you need them most.",
  },
];

export default function HowItHelps() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe} testID="how-it-helps-screen">
      <View style={styles.header}>
        <Pressable
          testID="how-it-helps-back"
          style={(s) => [styles.backBtn, focusRingStyle(s)]}
          onPress={() => goBackOr(router, '/language')}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={20} color={c.brand} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Text style={styles.step}>Step 2 of 3</Text>
      </View>

      <View style={styles.progressRow}>
        <View style={[styles.progressSeg, styles.progressSegDone]} />
        <View style={[styles.progressSeg, styles.progressSegDone]} />
        <View style={styles.progressSeg} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>How DHARA{'\n'}helps you</Text>
        <Text style={styles.sub}>Your personal legal guide, available 24/7.</Text>

        {FEATURES.map((f) => (
          <View key={f.title} style={styles.feat}>
            <View style={[styles.ficon, { backgroundColor: f.iconBg }]}>
              <Ionicons name={f.icon} size={24} color={f.iconColor} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.featTitle}>{f.title}</Text>
              <Text style={styles.featBody}>{f.body}</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          testID="how-it-helps-next"
          style={(s) => [styles.nextBtn, focusRingStyle(s)]}
          onPress={() => router.replace('/login')}
          accessibilityRole="button"
          accessibilityLabel="Next"
        >
          <Text style={styles.nextBtnText}>Next</Text>
          <Ionicons name="arrow-forward" size={18} color={c.brand} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 4, gap: 12 },
  backBtn: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: c.surface,
    borderWidth: 1.5, borderColor: c.border, alignItems: 'center', justifyContent: 'center',
  },
  step: { fontSize: 13, color: c.onSurfaceSecondary, fontFamily: theme.fonts.bodyMedium },
  progressRow: { flexDirection: 'row', gap: 4, paddingHorizontal: 20, paddingTop: 12 },
  progressSeg: { flex: 1, height: 3, borderRadius: 2, backgroundColor: c.border },
  progressSegDone: { backgroundColor: c.gold },
  scroll: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 12 },
  title: { fontFamily: theme.fonts.display, fontSize: 28, color: c.brand, lineHeight: 32 },
  sub: { fontSize: 15, color: c.onSurfaceSecondary, marginTop: 8, lineHeight: 21 },
  feat: {
    flexDirection: 'row', gap: 16, alignItems: 'flex-start',
    paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: c.divider, marginTop: 8,
  },
  ficon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  featTitle: { fontSize: 17, fontWeight: '600', color: c.brand },
  featBody: { fontSize: 14, color: c.onSurfaceSecondary, lineHeight: 20, marginTop: 4 },
  footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32 },
  nextBtn: {
    height: 58, borderRadius: 16, backgroundColor: c.gold,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  nextBtnText: { fontSize: 17, fontWeight: '700', color: c.brand },
});
