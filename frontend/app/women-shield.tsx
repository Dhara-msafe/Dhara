import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Switch, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { tr } from '@/src/ui18n';
import { SosPill, Divider } from '@/src/components/dhara/SosPill';
import { fetchFlags, fetchHelplines, safetyRoute, setCheckin as persistCheckin, getCheckin, getCircle, type Helpline } from '@/src/women/api';
import { loadVisibleRecordings, releaseRecordings } from '@/src/women/evidenceStore'; // Fix (S1-2): count only visible (non-segment) items
import { enterWomensShield, leaveWomensShield } from '@/src/voice/speechGate';
import { activateCover } from '@/src/women/coverState';

import { openExternal } from '@/src/outbound';
const PRIVACY_COVER_ENABLED = process.env.EXPO_PUBLIC_PRIVACY_COVER_V1 === 'true';

const HEAD_OUT_ENABLED = process.env.EXPO_PUBLIC_SAFETY_SESSION_V1 === 'true';
const CAMPUS_ENABLED   = process.env.EXPO_PUBLIC_CAMPUS_LAYER === 'true';

const c = theme.colors;
const PANIC_LESSON_SEEN_KEY = 'ws_panic_lesson_seen';

const RIGHTS: { key: string; icon: any; scenario: string }[] = [
  { key: 'ws.r.police', icon: 'ribbon-outline', scenario: 'police_wont_file' },
  { key: 'ws.r.violence', icon: 'home-outline', scenario: 'violence_at_home' },
  { key: 'ws.r.thrown', icon: 'exit-outline', scenario: 'thrown_out_of_home' },
  { key: 'ws.r.dowry', icon: 'card-outline', scenario: 'dowry_demands' },
  { key: 'ws.r.work', icon: 'briefcase-outline', scenario: 'harassment_at_work' },
  { key: 'ws.r.stalking', icon: 'eye-off-outline', scenario: 'stalking_online_abuse' },
  { key: 'ws.r.photos', icon: 'image-outline', scenario: 'private_photos_leaked' },
  { key: 'ws.r.assault', icon: 'heart-outline', scenario: 'after_assault' },
  { key: 'ws.r.arrested', icon: 'shield-outline', scenario: 'woman_arrested' },
  { key: 'ws.r.children', icon: 'people-outline', scenario: 'children_safety' },
];

const HELPLINES = [
  { num: '112', key: 'hl.emergency' },
  { num: '181', key: 'hl.women' },
  { num: '14490', key: 'hl.ncw' },
  { num: '1930', key: 'hl.cyber' },
  { num: '15100', key: 'hl.legalaid' },
  { num: '14416', key: 'hl.talk' },
];

export default function WomenShield() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { language, user } = useAuth();
  const lang = language.code;
  // D1 — prefsLoading=true until AsyncStorage resolves; prevents sensitive-content
  // flash on mount and ensures cross-account state is wiped before new pref loads.
  const [prefsLoading, setPrefsLoading] = useState(true);
  const [discreet, setDiscreet] = useState(false);
  const [checkin, setCheckin] = useState(true);
  const [helplines, setHelplines] = useState<Helpline[]>([]);
  const [circleCount, setCircleCount] = useState(0);
  const [lockerCount, setLockerCount] = useState(0);

  useEffect(() => {
    (async () => {
      const [f, h, ci] = await Promise.all([fetchFlags(), fetchHelplines(), getCheckin()]);
      void f; // flags loaded for future feature gates
      if (h.length) setHelplines(h);
      setCheckin(ci);
    })();
  }, []);

  // A6 — show the 20-second panic-trigger lesson proactively the FIRST time
  // a citizen opens Women's Shield (not buried behind a button she might
  // never tap), then never again automatically — she can always re-open it
  // from "Learn the 20-second panic trigger" below.
  useEffect(() => {
    (async () => {
      const seen = await AsyncStorage.getItem(PANIC_LESSON_SEEN_KEY).catch(() => null);
      if (!seen) {
        await AsyncStorage.setItem(PANIC_LESSON_SEEN_KEY, '1').catch(() => {});
        router.push('/women/panic-lesson');
      }
    })();
  }, [router]);

  // Truth-bind the summary counts to real saved state every time this screen
  // gains focus (not just on first mount) — so adding a contact or evidence
  // item and coming back here shows the updated number, not a stale one.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      const scope = user?.id || 'device';
      // Talk to DHARA — entering the Shield forces Quiet on (no spoken replies here).
      void enterWomensShield();
      (async () => {
        const [circle, items] = await Promise.all([getCircle(), loadVisibleRecordings(scope)]);
        if (!alive) { releaseRecordings(items); return; }
        setCircleCount(circle.length);
        setLockerCount(items.length);
        releaseRecordings(items);
      })();
      return () => { alive = false; leaveWomensShield(); };
    }, [user?.id])
  );

  const onCheckin = async (v: boolean) => { setCheckin(v); await persistCheckin(v); };

  // D1 — account-scoped discreet preference.
  // Key is per-user so logout/account-switch wipes the value automatically.
  // Guests (no user.id) get session-only behaviour — pref resets on mount.
  useEffect(() => {
    let alive = true;
    setPrefsLoading(true);
    setDiscreet(false); // safe default; cleared immediately before new pref loads
    const key = user?.id ? `ws_discreet_${user.id}` : null;
    (async () => {
      const saved = key ? await AsyncStorage.getItem(key).catch(() => null) : null;
      if (alive) { setDiscreet(saved === '1'); setPrefsLoading(false); }
    })();
    return () => { alive = false; };
  }, [user?.id]);

  const handleDiscreet = async (v: boolean) => {
    setDiscreet(v);
    const key = user?.id ? `ws_discreet_${user.id}` : null;
    if (key) await AsyncStorage.setItem(key, v ? '1' : '0').catch(() => {});
    // Masking does NOT touch any active recording, journey, Head Out timer or
    // SOS session. Those lifecycle owners are fully independent of this flag.
  };

  const openScenario = async (scenarioKey: string) => {
    await safetyRoute({ scenario_key: scenarioKey, lang });
    router.push({ pathname: '/action-plan', params: { scenario: scenarioKey } });
  };

  // Prefer the verified service directory; fall back to the static labels.
  const SHORT: Record<string, string> = { '112': tr('hl.emergency', lang), '181': tr('hl.women', lang), '14490': tr('hl.ncw', lang), '1930': tr('hl.cyber', lang), '15100': tr('hl.legalaid', lang), '14416': tr('hl.talk', lang), '1098': 'Childline' };
  const shownHelplines = helplines.length
    ? helplines.map(h => ({ num: h.number, label: SHORT[h.number] || h.name, verified: h.verified }))
    : HELPLINES.map(h => ({ num: h.num, label: tr(h.key, lang), verified: false }));

  // Privacy cover — visible "Hide" action (amendment: manual trigger)
  const activatePrivacyCover = useCallback(async () => {
    const scope = user?.id || 'device';
    if (user?.id) await AsyncStorage.setItem(`ws_discreet_${user.id}`, '1').catch(() => {});
    await activateCover(scope);
  }, [user?.id]);

  // DHARA-P0-3 (B025): leave this screen instantly for a neutral page.
  const NEUTRAL_URL = 'https://www.google.com/search?q=weather';
  const quickExit = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.replace(NEUTRAL_URL);
      return;
    }
    // Leave this screen first so reopening the app never lands back here,
    // then open the neutral page once the navigation has committed.
    router.replace('/(tabs)/home');
    setTimeout(() => { openExternal(NEUTRAL_URL).catch(() => {}); }, 300);
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <View style={styles.topRow}>
            <Pressable onPress={() => router.back()} style={styles.backBtn} testID="ws-back" accessibilityRole="button" accessibilityLabel="Go back">
              <Ionicons name="chevron-back" size={24} color="#fff" />
            </Pressable>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {/* Privacy Cover — visible manual Hide action (PRIVACY_COVER_V1 gate) */}
              {PRIVACY_COVER_ENABLED && (
                <Pressable onPress={activatePrivacyCover} style={styles.hideBtn} testID="ws-hide-btn" accessibilityRole="button" accessibilityLabel="Hide sensitive content">
                  <Ionicons name="eye-off-outline" size={15} color="#fff" />
                  <Text style={styles.hideBtnTxt}>Hide</Text>
                </Pressable>
              )}
              {/* DHARA-P0-3 (B025): one-tap safe exit to a neutral page */}
              <Pressable onPress={quickExit} style={styles.quickExit} testID="ws-quick-exit" accessibilityRole="button" accessibilityLabel={tr('ws.quickexit', lang)}>
                <Ionicons name="exit-outline" size={16} color={c.navy} />
                <Text style={styles.quickExitTxt}>{tr('ws.quickexit', lang)}</Text>
              </Pressable>
              <SosPill />
            </View>
          </View>
          <View style={styles.titleRow}>
            <View style={styles.shieldBox}><Ionicons name="shield-half" size={28} color={c.navy} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{tr('ws.title', lang)}</Text>
              <Text style={styles.subtitle}>{tr('ws.subtitle', lang)}</Text>
            </View>
          </View>
          <View style={styles.discreet}>
            <Ionicons name="eye-off-outline" size={22} color="#fff" />
            <View style={{ flex: 1 }}>
              <Text style={styles.discreetTitle}>{discreet ? tr('ws.discreet', lang) : tr('ws.discreet.off', lang)}</Text>
              <Text style={styles.discreetSub}>{tr('ws.discreet.sub', lang)}</Text>
            </View>
            <Switch value={discreet} onValueChange={handleDiscreet} trackColor={{ true: c.gold, false: '#334' }} thumbColor="#fff" />
          </View>
        </View>

        {/* D1 — neutral cover while prefs loading or discreet is active.
            Sensitive headings, contacts, tools and evidence are absent from
            the render tree (not merely hidden) when discreet=true.           */}
        {(!prefsLoading && discreet) && (
          <View testID="ws-discreet-cover" style={styles.discreetCover}>
            <Ionicons name="lock-closed" size={44} color={c.muted} style={{ marginBottom: 14 }} />
            <Text style={styles.discreetCoverTitle}>Sensitive screen hidden.</Text>
            <Text style={styles.discreetCoverNote}>
              {'This hides this screen. It does not change phone notifications or erase browsing history.'}
            </Text>
            <Pressable
              style={styles.revealBtn}
              onPress={() => handleDiscreet(false)}
              accessibilityRole="button"
              accessibilityLabel="Show sensitive content again"
              testID="ws-show-again"
            >
              <Text style={styles.revealBtnTxt}>Show again</Text>
            </Pressable>
          </View>
        )}

        {/* Sensitive content — removed from the tree while discreet is on */}
        {(!prefsLoading && !discreet) && <>

        {/* Know your rights */}
        <View style={styles.section}>
          <Text style={styles.h2}>{tr('ws.rights', lang)}</Text>
          <Text style={styles.h2sub}>{tr('ws.rights.sub', lang)}</Text>
          <View style={styles.grid}>
            {RIGHTS.map(r => (
              <Pressable key={r.key} style={styles.rightCard} onPress={() => openScenario(r.scenario)} testID={`ws-${r.key}`} accessibilityRole="button" accessibilityLabel={r.label}>
                <View style={styles.rightIcon}><Ionicons name={r.icon} size={18} color={c.darkGold} /></View>
                <Text style={styles.rightTxt} numberOfLines={2}>{tr(r.key, lang)}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Safety tools */}
        <View style={styles.section}>
          <Text style={styles.h2}>{tr('ws.tools', lang)}</Text>
          <View style={styles.toolCard}>
            <ToolRow icon="people-outline" title={tr('ws.circle', lang)} sub={circleCount > 0 ? tr('ws.circle.sub.count', lang).replace('{n}', String(circleCount)) : tr('ws.circle.sub.empty', lang)} action={tr('ws.manage', lang)} onPress={() => router.push('/women/trusted-circle')} />
            <Divider />
            <View style={styles.toolRow}>
              <View style={styles.toolIcon}><Ionicons name="navigate-outline" size={20} color={c.navy} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.toolTitle}>{tr('ws.checkin', lang)}</Text>
              </View>
              <Switch value={checkin} onValueChange={onCheckin} trackColor={{ true: c.navy, false: c.surfaceTertiary }} thumbColor="#fff" />
            </View>
            <Divider />
            <ToolRow icon="lock-closed-outline" title={tr('ws.locker', lang)} sub={tr('ws.locker.sub.count', lang).replace('{n}', String(lockerCount))} action={tr('ws.open', lang)} onPress={() => router.push('/women/evidence-locker')} />
            <Divider />
            <ToolRow icon="mic-outline" title={tr('ws.code', lang)} sub={tr('ws.code.sub', lang)} action={tr('ws.setup', lang)} onPress={() => router.push('/women/code-phrase')} />
            {HEAD_OUT_ENABLED && <>
              <Divider />
              <ToolRow icon="navigate-outline" title="Head out safely" sub="Set a check-in timer before you leave" action="Set timer" onPress={() => router.push('/women/head-out')} />
            </>}
            {HEAD_OUT_ENABLED && (process.env.EXPO_PUBLIC_GUARDIAN_SHARE === 'true') && <>
              <Divider />
              <ToolRow icon="people-circle-outline" title="Guardian Journey" sub="Notify someone about your live journey" action="Share" onPress={() => router.push('/women/guardian-share')} />
            </>}
          </View>
          <Pressable style={styles.lessonRow} onPress={() => router.push('/women/panic-lesson')}>
            <Ionicons name="school-outline" size={18} color={c.darkGold} />
            <Text style={styles.lessonTxt}>Learn the 20-second panic trigger for 112</Text>
            <Ionicons name="chevron-forward" size={18} color={c.onSurfaceTertiary} />
          </Pressable>
        </View>

        {/* Campus safety — S4 Campus Pilot Layer */}
        {CAMPUS_ENABLED && (
          <View style={styles.section}>
            <Text style={styles.h2}>Campus safety</Text>
            <Text style={styles.h2sub}>Resources for students and campus communities</Text>
            <View style={styles.toolCard}>
              <ToolRow icon="school-outline" title="Anti-Ragging helpline" sub="National helpline: 1800-180-5522 (free call)" action="Call" onPress={() => openExternal('tel:18001805522')} />
              <Divider />
              <ToolRow icon="briefcase-outline" title="POSH / Internal Complaints" sub="Your institution's Internal Complaints Committee (ICC)" action="How to find" onPress={() => router.push({ pathname: '/all-help', params: { q: 'POSH committee' } })} />
              <Divider />
              <ToolRow icon="shield-checkmark-outline" title="Campus security" sub="Contact your campus security office directly" action="Ask DHARA" onPress={() => router.push({ pathname: '/(tabs)', params: { draft: 'How do I contact campus security or file a complaint?', entry: Date.now().toString() } } as any)} />
            </View>
            <View style={styles.lessonRow}>
              <Ionicons name="information-circle-outline" size={18} color={c.darkGold} />
              <Text style={styles.lessonTxt}>Campus security numbers vary by institution — check your campus app or notice boards</Text>
            </View>
          </View>
        )}

        {/* Talk to someone */}
        <View style={styles.section}>
          <Text style={styles.h2}>{tr('ws.talk', lang)}</Text>
          <Text style={styles.h2sub}>{tr('ws.talk.sub', lang)}</Text>
          <View style={styles.hlGrid}>
            {shownHelplines.map(h => (
              <Pressable key={h.num} style={styles.hlCard} onPress={() => openExternal(`tel:${h.num}`)} testID={`hl-${h.num}`} accessibilityRole="button" accessibilityLabel={`Call ${h.label}, ${h.num}`}>
                {h.verified && <Ionicons name="checkmark-circle" size={13} color={c.verifiedGreen} style={styles.hlVerified} />}
                <Text style={styles.hlNum}>{h.num}</Text>
                <Text style={styles.hlLabel} numberOfLines={1}>{h.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Safety plan */}
        <View style={styles.section}>
          <View style={styles.planCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.planTitle}>{tr('ws.plan', lang)}</Text>
              <Text style={styles.planSub}>{tr('ws.plan.sub', lang)}</Text>
            </View>
            <Pressable style={styles.planBtn} onPress={() => router.push('/women/safety-plan')} accessibilityRole="button" accessibilityLabel="Create my safety plan">
              <Text style={styles.planBtnTxt}>{tr('ws.start', lang)}</Text>
            </Pressable>
          </View>
        </View>
        </>}
      </ScrollView>
    </View>
  );
}

function ToolRow({ icon, title, sub, action, onPress }: { icon: any; title: string; sub: string; action: string; onPress: () => void }) {
  return (
    <Pressable
      style={styles.toolRow}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title} — ${action}`}
      accessibilityHint={sub}
    >
      <View style={styles.toolIcon}><Ionicons name={icon} size={20} color={c.navy} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.toolTitle}>{title}</Text>
        <Text style={styles.toolSub}>{sub}</Text>
      </View>
      <Text style={styles.toolAction}>{action}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  header: { backgroundColor: c.navy, paddingHorizontal: 20, paddingBottom: 18 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hideBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.18)', paddingHorizontal: 10, height: 30, borderRadius: 15 },
  hideBtnTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 13 },
  quickExit: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#fff', paddingHorizontal: 12, height: 32, borderRadius: 16 },
  quickExitTxt: { color: c.navy, fontWeight: '700', fontSize: 13 },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10 },
  shieldBox: { width: 52, height: 52, borderRadius: 14, backgroundColor: c.gold, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontFamily: theme.fonts.displayBold, fontSize: 26 },
  subtitle: { color: c.onNavyMuted, fontFamily: theme.fonts.body, fontSize: 13, marginTop: 2 },
  discreet: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 16, padding: 14, marginTop: 18 },
  discreetTitle: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 15 },
  discreetSub: { color: c.onNavyMuted, fontFamily: theme.fonts.body, fontSize: 12, marginTop: 2 },

  section: { paddingHorizontal: 20, marginTop: 24 },
  h2: { fontFamily: theme.fonts.displayBold, fontSize: 22, color: c.ink },
  h2sub: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, marginTop: 2, marginBottom: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 },
  rightCard: { width: '47.5%', flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.lines, padding: 12, minHeight: 64 },
  rightIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: c.goldMuted, alignItems: 'center', justifyContent: 'center' },
  rightTxt: { flex: 1, fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.ink },

  toolCard: { backgroundColor: c.surface, borderRadius: 18, borderWidth: 1, borderColor: c.lines, paddingHorizontal: 16 },
  toolRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16 },
  toolIcon: { width: 40, height: 40, borderRadius: 11, backgroundColor: c.navySoft, alignItems: 'center', justifyContent: 'center' },
  toolTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.ink },
  toolSub: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 2 },
  toolAction: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.navy },

  hlGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 },
  hlCard: { width: '31%', backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.lines, paddingVertical: 16, alignItems: 'center', position: 'relative' },
  hlVerified: { position: 'absolute', top: 8, right: 8 },
  lessonRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.goldMuted, borderRadius: 14, padding: 14, marginTop: 14 },
  lessonTxt: { flex: 1, fontFamily: theme.fonts.bodySemiBold, fontSize: 14, color: c.ink },
  hlNum: { fontFamily: theme.fonts.displayBold, fontSize: 22, color: c.navy },
  hlLabel: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 2 },

  planCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: c.goldMuted, borderRadius: 18, borderWidth: 1, borderColor: c.goldSoft, padding: 18 },
  planTitle: { fontFamily: theme.fonts.displayBold, fontSize: 18, color: c.ink },
  planSub: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, marginTop: 4, lineHeight: 18 },
  planBtn: { backgroundColor: c.navy, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 22 },
  planBtnTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 15 },

  // D1 — discreet cover styles
  discreetCover: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, paddingVertical: 60 },
  discreetCoverTitle: { fontFamily: theme.fonts.displayBold, fontSize: 22, color: c.ink, textAlign: 'center', marginBottom: 12 },
  discreetCoverNote: { fontFamily: theme.fonts.body, fontSize: 14, color: c.muted, textAlign: 'center', lineHeight: 21, marginBottom: 32 },
  revealBtn: { backgroundColor: c.navy, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 36 },
  revealBtnTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 16 },
});
