import { useState } from 'react';
import { useLightStatusBar } from '@/src/ui/kit';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { tr } from '@/src/ui18n';
import { QuickExit } from '@/src/components/dhara/SosPill';
import { openPhone } from '@/src/women/helpActions';
import { setEvidenceAutoRecord } from '@/src/women/evidenceAutoRecord';
import { focusRingStyle } from '@/src/a11yFocus';
// Step S3 (Safety core, v2.2 design, 23 Nov handover): visual-only — the
// background used the legacy `emergencyDeep` (#7A160F) constant, which
// predates the v2.2 design package; Emergency.dc.html's authoritative
// background is `redDeep` (#7F1D1D, design-tokens.json). Screen-manifest
// id 25 is "Copy correction + Visual change" — the copy (no "Police
// notified", "Open dialler for 112" label, visible number fallback) was
// already correct, and the real 112 handler was already wired
// unconditionally by an earlier, separate fix (see the comment on
// call-112 below) — "wiring = New functionality" in the manifest is not
// reopened here. This only recalibrates the one token mismatch.
import { UI_V22_S3 } from '@/src/uiV22Flags';

const c = theme.colors;

export default function Emergency() {
  useLightStatusBar(); // redesign v3: white status-bar icons over the dark header
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { language } = useAuth();
  const lang = language.code;
  const [callStatus, setCallStatus] = useState<string | null>(null);

  const tiles = [
    { id: 'silent-alert', icon: 'people-outline', title: tr('em.silent', lang), sub: tr('em.silent.sub', lang), route: '/women/silent-alert', beforeNav: undefined as (() => void) | undefined },
    // B1 (Phase 0.5): beforeNav sets the module-level auto-record flag so the
    // locker can verify the intent came from in-app navigation, not a deep-link.
    // The route no longer carries ?record=1 — the URL param approach allowed any
    // external link to turn on the microphone.
    { id: 'record-now', icon: 'mic-outline', title: tr('em.record', lang), sub: tr('em.record.sub', lang), route: '/women/evidence-locker', beforeNav: () => setEvidenceAutoRecord() },
    { id: 'officer-card', icon: 'shield-outline', title: tr('em.officer', lang), sub: tr('em.officer.sub', lang), route: '/women/officer-card?scenario=police_wont_file', beforeNav: undefined },
    { id: 'nearest-help', icon: 'location-outline', title: tr('em.nearest', lang), sub: tr('em.nearest.sub', lang), route: '/women/nearest-help', beforeNav: undefined },
  ];

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
        <View style={styles.topRow}>
          <View style={styles.dangerRow}>
            <Ionicons name="warning-outline" size={22} color="#fff" />
            <Text style={styles.danger}>{tr('em.danger', lang)}</Text>
          </View>
          <QuickExit />
        </View>
        {/* v2.2 design spec: "Pick one. Each button does one thing." */}
        <Text style={styles.emergencySubtitle}>{tr('em.subtitle', lang)}</Text>

        {/* v2.2.1 Stage 2 (screen 25): this used to be a plain <View> with no
            onPress at all — accessibilityLabel literally said "Calling not
            yet active." Now a real Pressable using the same tested
            openPhone() helper already used on nearest-help.tsx/officer-
            card.tsx/trusted-circle.tsx (routes through the Outbound Guard —
            src/outbound.ts). Already well over the 48px touch target
            (230x230). Fix is unconditional (not flag-gated): a dead control
            is a correctness bug, not a stylistic choice to roll back to. */}
        <Pressable
          testID="call-112"
          style={(s) => [styles.callCircle, focusRingStyle(s)]}
          onPress={async () => setCallStatus(await openPhone('112'))}
          accessibilityRole="button"
          accessibilityLabel="Open dialler for 112"
          accessibilityHint="Opens your phone's dialler with 112 filled in. You still have to press call yourself."
        >
          <Ionicons name="call-outline" size={34} color={c.emergencyRed} />
          {/* `selectable`: the fallback the owner asked for — if the dialler
              can't open (see openPhone's catch branch below), the number is
              still copyable text, not just a dead label. */}
          <Text style={styles.callNum} selectable>112</Text>
          <Text style={styles.callTap}>{tr('em.tapcall', lang)}</Text>
        </Pressable>

        {/* Outbound-policy-aware status line. In this build's current
            profile (internal_qa) openPhone()/openExternal() already return
            the "Simulated — nothing sent" message below — nothing here
            claims a call was placed. */}
        {!!callStatus && (
          <Text
            testID="emergency-call-status"
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            style={styles.callStatus}
            selectable
          >
            {callStatus}
          </Text>
        )}

        <Text style={styles.oneNumber}>{tr('em.oneNumber', lang)}</Text>

        <View style={styles.grid}>
          {tiles.map(t => (
            <Pressable key={t.id} testID={`help-${t.id}`} accessibilityRole="button" accessibilityLabel={`${t.title} — ${t.sub}`} style={({ pressed }) => [styles.tile, pressed && { opacity: 0.7 }]} onPress={() => { t.beforeNav?.(); router.push(t.route as any); }}>
              <Ionicons name={t.icon as any} size={24} color="#fff" />
              <Text testID={`help-${t.id}-title`} style={styles.tileTitle}>{t.title}</Text>
              <Text testID={`help-${t.id}-description`} style={styles.tileSub}>{t.sub}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.tipBox}>
          <Text testID="emergency-device-tip" style={styles.tipTxt}>{tr('em.powerTip', lang)}</Text>
        </View>
      </ScrollView>

      <Pressable style={styles.safeBtn} onPress={() => router.replace('/(tabs)/home')} testID="im-safe" accessibilityRole="button" accessibilityLabel={tr('em.safe', lang)}>
        <Text style={styles.safeTxt}>{tr('em.safe', lang)}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: UI_V22_S3 ? c.redDeep : c.emergencyDeep, paddingHorizontal: 16 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  dangerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  danger: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 14, letterSpacing: 0.4, flexShrink: 1 },
  callCircle: { alignSelf: 'center', width: 230, height: 230, borderRadius: 115, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginTop: 22 },
  callNum: { color: c.emergencyRed, fontFamily: theme.fonts.displayBlack, fontSize: 58, lineHeight: 65 },
  callTap: { color: c.emergencyRed, fontFamily: theme.fonts.bodyBold, fontSize: 15 },
  callStatus: {
    color: '#fff', fontFamily: theme.fonts.body, fontSize: 13, lineHeight: 18,
    textAlign: 'center', marginTop: 14, paddingHorizontal: 12,
  },
  emergencySubtitle: { color: 'rgba(255,255,255,0.75)', fontFamily: theme.fonts.body, fontSize: 14, lineHeight: 19, marginBottom: 10 },
  oneNumber: { color: '#fff', fontFamily: theme.fonts.body, fontSize: 15, textAlign: 'center', marginTop: 26 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 14, marginTop: 18 },
  tile: { width: '47%', backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 16, padding: 18, minHeight: 120, justifyContent: 'center', gap: 8 },
  tileTitle: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 15 },
  tileSub: { color: 'rgba(255,255,255,0.82)', fontFamily: theme.fonts.body, fontSize: 12 },
  tipBox: { backgroundColor: 'rgba(0,0,0,0.22)', borderRadius: 14, padding: 16, marginTop: 20 },
  tipTxt: { color: '#fff', fontFamily: theme.fonts.body, fontSize: 13, lineHeight: 19 },
  safeBtn: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.5)', borderRadius: 16, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  safeTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 16 },
});
