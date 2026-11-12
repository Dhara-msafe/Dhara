import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { theme } from '@/src/theme';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { useAuth } from '@/src/auth';
import { getPlan, savePlan } from '@/src/women/api';
import { getLastLocation, type CachedLocation } from '@/src/safety/locationCache';
import { formatLocationFix } from '@/src/safety/locationPresentation';

// ─── Failsafe setup checklist data ──────────────────────────────────────────────
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
  'Which helpline will you call first \u2014 112, 181 or 1930?',
];

// ─── Plus Code age label helper ──────────────────────────────────────────────────
function _ageLabel(loc: CachedLocation): string {
  if (loc.source === 'demo') return 'Preview location · enable GPS for your real fix';
  const { age } = formatLocationFix(
    { latitude: loc.lat, longitude: loc.lng, accuracyM: loc.accuracyM, capturedAt: loc.capturedAt },
    new Date(),
  );
  const srcLabel = loc.source === 'server' ? 'from journey record' : 'GPS fix';
  return `Updated ${age} · ${srcLabel}`;
}

export default function SafetyPlan() {
  const router = useRouter();
  const [ans, setAns] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);

  // ── F0-B: Plus Code emergency card ─────────────────────────────────────────────────
  const { user } = useAuth() as any;   // cast: user field confirmed in auth context
  const [cachedLoc, setCachedLoc] = useState<CachedLocation | null>(null);
  const [plusCodeCopied, setPlusCodeCopied] = useState(false);

  useEffect(() => {
    const uid: string = user?.id ?? 'anon';
    getLastLocation(uid).then(setCachedLoc).catch(() => {});
  }, [user?.id]);

  const handleCopyPlusCode = useCallback(async () => {
    if (!cachedLoc?.plusCode) return;
    await Clipboard.setStringAsync(cachedLoc.plusCode).catch(() => {});
    setPlusCodeCopied(true);
    setTimeout(() => setPlusCodeCopied(false), 2000);
  }, [cachedLoc]);

  useEffect(() => { getPlan().then(setAns); }, []);

  const set = (i: number, v: string) => setAns(p => ({ ...p, [i]: v }));
  const save = async () => { await savePlan(ans); setDone(true); setTimeout(() => router.back(), 1200); };
  const filled = Object.values(ans).filter(v => v && v.trim()).length;

  return (
    <View style={styles.root}>
      <ScreenHeader title="My safety plan" subtitle="Private · stored only on this phone" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }}>

        {/* ── F0-B: Plus Code emergency card ──
            B-96: cachedLoc.source === 'demo' means locationCache.ts never
            had a real GPS/server fix and returned its fallback Chennai
            fixture -- NOT a usable location. The old "Demo" badge still
            rendered that fabricated Plus Code as if it were shareable
            ("Share this code with emergency services"), which is exactly
            the fix already applied to the emergency-SMS path in
            app/women/head-out/index.tsx's prepareAlertSMS ("Demo fallback
            is intentionally omitted — a fabricated coordinate in an
            emergency SMS could misdirect first responders"). This screen
            never got the same guard. Now: no code, no copy action, no
            "share this" text when there is no real fix -- just a plain
            notice to turn on GPS. */}
        {cachedLoc && cachedLoc.source !== 'demo' && (
          <Pressable
            style={styles.plusCodeCard}
            onPress={handleCopyPlusCode}
            accessibilityRole="button"
            accessibilityLabel={`Emergency Plus Code: ${cachedLoc.plusCode}. Tap to copy.`}
            accessibilityHint="Copies the Plus Code to your clipboard"
          >
            <View style={styles.plusCodeTopRow}>
              <View style={styles.plusCodeIconWrap}>
                <Ionicons name="location" size={18} color={c.navy} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.plusCodeLabelRow}>
                  <Text style={styles.plusCodeLabel}>Emergency Plus Code</Text>
                  <View style={styles.offlineBadge}>
                    <Ionicons name="cloud-offline-outline" size={10} color="#6b7280" />
                    <Text style={styles.offlineBadgeTxt}>Works offline</Text>
                  </View>
                </View>
                <Text style={styles.plusCodeValue} selectable={false}>
                  {cachedLoc.plusCode || '—'}
                </Text>
                <Text style={styles.plusCodeAge}>{_ageLabel(cachedLoc)}</Text>
              </View>
              <View style={styles.plusCodeCopyBtn}>
                <Ionicons
                  name={plusCodeCopied ? 'checkmark-circle' : 'copy-outline'}
                  size={22}
                  color={plusCodeCopied ? c.verifiedGreen : c.navy}
                />
              </View>
            </View>
            <Text style={styles.plusCodeHint}>
              {plusCodeCopied
                ? '✓ Copied to clipboard!'
                : 'Share this code with emergency services — works without signal'}
            </Text>
          </Pressable>
        )}
        {cachedLoc && cachedLoc.source === 'demo' && (
          <View
            style={styles.locationUnavailableCard}
            accessibilityRole="text"
            accessibilityLabel="Location not available. Turn on GPS to get your emergency Plus Code."
          >
            <View style={styles.plusCodeIconWrap}>
              <Ionicons name="location-outline" size={18} color={c.muted} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.locationUnavailableTitle}>Location not available</Text>
              <Text style={styles.locationUnavailableBody}>Turn on GPS to get your emergency Plus Code</Text>
            </View>
          </View>
        )}

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

  // ── F0-B: Plus Code card ──────────────────────────────────────────────────────────────
  plusCodeCard: {
    backgroundColor: c.navySoft,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: c.navy + '33',   // 20 % opacity navy border
    padding: 16,
    marginBottom: 12,
    gap: 8,
  },
  plusCodeTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  plusCodeIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: c.surface,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 2,
  },
  plusCodeLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    marginBottom: 4,
  },
  plusCodeLabel: {
    fontFamily: theme.fonts.bodySemiBold,
    fontSize: 12,
    color: c.navy,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  // B-96: plain notice card shown instead of the Plus Code card when
  // locationCache.ts has no real GPS/server fix (source === 'demo').
  locationUnavailableCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.surface,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: c.border ?? '#e5e7eb',
    padding: 16,
    marginBottom: 12,
    gap: 12,
  },
  locationUnavailableTitle: {
    fontFamily: theme.fonts.bodySemiBold,
    fontSize: 14,
    color: c.navy,
  },
  locationUnavailableBody: {
    fontFamily: theme.fonts.body,
    fontSize: 12,
    color: c.muted,
    marginTop: 2,
  },
  offlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#f3f4f6',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  offlineBadgeTxt: {
    fontFamily: theme.fonts.body,
    fontSize: 10,
    color: '#6b7280',
  },
  plusCodeValue: {
    fontFamily: theme.fonts.displayBold,
    fontSize: 22,
    color: c.navy,
    letterSpacing: 1,
    lineHeight: 28,
    marginBottom: 2,
  },
  plusCodeAge: {
    fontFamily: theme.fonts.body,
    fontSize: 11,
    color: c.muted,
    lineHeight: 15,
  },
  plusCodeCopyBtn: {
    paddingTop: 4,
    flexShrink: 0,
  },
  plusCodeHint: {
    fontFamily: theme.fonts.body,
    fontSize: 12,
    color: c.navy,
    lineHeight: 17,
    opacity: 0.75,
  },

  // ── Failsafe checklist ────────────────────────────────────────────────────────────────
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

  // ── Safety plan questions ───────────────────────────────────────────────────────
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
