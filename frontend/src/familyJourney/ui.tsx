/**
 * Family Journey — shared UI pieces (Phase 1).
 * Calm styling only: no red urgency, no countdown pressure, no danger badges.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import { SosPill } from '../components/dhara/SosPill';
import { PREVIEW_LABEL, SEND_LABEL } from './previewCopy';
import { FJ_SEND_ENABLED } from './flags';

const c = theme.colors;

/** Header with back + title + always-visible SOS (help is never more than a tap away). */
export function JourneyHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
      <Pressable onPress={() => router.back()} hitSlop={8} style={styles.back} testID="fj-back" accessibilityRole="button" accessibilityLabel="Go back">
        <Ionicons name="chevron-back" size={24} color="#fff" />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={styles.hTitle} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.hSub} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      <SosPill />
    </View>
  );
}

/** Help row kept on every Family Journey screen — free, no subscription. */
export function JourneyHelpRow() {
  const router = useRouter();
  return (
    <View style={styles.helpRow} testID="fj-help-row">
      <Pressable style={styles.helpBtn} onPress={() => router.push('/emergency')} testID="fj-help-emergency">
        <Ionicons name="alert-circle-outline" size={16} color={c.navy} />
        <Text style={styles.helpTxt}>Emergency help</Text>
      </Pressable>
      <Pressable style={styles.helpBtn} onPress={() => router.push('/all-help')} testID="fj-help-all">
        <Ionicons name="help-buoy-outline" size={16} color={c.navy} />
        <Text style={styles.helpTxt}>Legal help</Text>
      </Pressable>
    </View>
  );
}

/** Unmissable "nothing has been sent" marker (Phase-1 preview screens). */
export function PreviewBadge({ testID }: { testID?: string }) {
  return (
    <View style={styles.badge} testID={testID ?? 'fj-preview-badge'}>
      <Ionicons name="eye-outline" size={14} color={c.darkGold} />
      <Text style={styles.badgeTxt}>{PREVIEW_LABEL}</Text>
    </View>
  );
}

/** Phase-2 marker: the SMS app opens, the student presses Send. */
export function SendBadge({ testID }: { testID?: string }) {
  return (
    <View style={styles.badge} testID={testID ?? 'fj-send-badge'}>
      <Ionicons name="chatbubble-ellipses-outline" size={14} color={c.darkGold} />
      <Text style={styles.badgeTxt}>{SEND_LABEL}</Text>
    </View>
  );
}

/** The badge that is truthful for the current phase. */
export function PhaseBadge({ testID }: { testID?: string }) {
  return FJ_SEND_ENABLED ? <SendBadge testID={testID} /> : <PreviewBadge testID={testID} />;
}

/** Marker for the read-only preview screen: with Phase 2 on, messages CAN be
 *  sent elsewhere in the app, so the claim is narrowed to this screen only. */
export function PreviewScreenBadge({ testID }: { testID?: string }) {
  return (
    <View style={styles.badge} testID={testID ?? 'fj-preview-badge'}>
      <Ionicons name="eye-outline" size={14} color={c.darkGold} />
      <Text style={styles.badgeTxt}>
        {FJ_SEND_ENABLED ? 'Nothing is sent from this screen.' : PREVIEW_LABEL}
      </Text>
    </View>
  );
}

/** Scope notice shown at the top of the feature. */
export function PhaseNotice() {
  if (FJ_SEND_ENABLED) {
    return (
      <View style={styles.phase} testID="fj-phase-notice">
        <Text style={styles.phaseTitle}>You press Send — always</Text>
        <Text style={styles.phaseBody}>
          A contact is only ever messaged when you choose it: your own SMS app opens with the text ready
          and you press Send, one contact at a time. DHARA never sends anything by itself, and no
          location of any kind is shared in this version. Your plan stays on this phone.
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.phase} testID="fj-phase-notice">
      <Text style={styles.phaseTitle}>Preview only in this version</Text>
      <Text style={styles.phaseBody}>
        Nothing is sent to anyone. No message, no notification and no location of any kind leaves this
        phone. Everything you set here is saved on this device only, so you can see exactly what a
        contact would receive before real sharing exists.
      </Text>
    </View>
  );
}

/** Plain confirm sheet — used because every permission needs its own explicit yes. */
export function ConfirmSheet({
  visible, title, body, confirmLabel, onConfirm, onCancel, testID, hideCancel, badge = 'phase',
}: {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string;
  /** For read-only preview sheets, where "Cancel" would just repeat "Close". */
  hideCancel?: boolean;
  /** Which truth marker belongs on this sheet. 'none' for sheets that neither
   *  preview nor send (e.g. discarding a draft). */
  badge?: 'phase' | 'preview' | 'none';
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} testID={testID ?? 'fj-confirm-sheet'}>
          <ScrollView bounces={false}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Text style={styles.sheetBody}>{body}</Text>
            {badge === 'none' ? null : badge === 'preview'
              ? <PreviewBadge testID="fj-confirm-preview-badge" />
              : <PhaseBadge testID="fj-confirm-preview-badge" />}
          </ScrollView>
          <Pressable style={styles.primaryBtn} onPress={onConfirm} testID="fj-confirm-yes">
            <Text style={styles.primaryBtnTxt}>{confirmLabel}</Text>
          </Pressable>
          {hideCancel ? null : (
            <Pressable style={styles.ghostBtn} onPress={onCancel} testID="fj-confirm-cancel">
              <Text style={styles.ghostBtnTxt}>Cancel</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

/** Shown on the sub-screens when the app-wide switch is off (e.g. opened by a
 *  direct link) — the feature must be unreachable everywhere when it is off. */
export function FamilyJourneyOff() {
  const router = useRouter();
  return (
    <View style={fjStyles.root} testID="fj-off-screen">
      <JourneyHeader title="Family Journey" />
      <ScrollView contentContainerStyle={fjStyles.body}>
        <View style={fjStyles.card}>
          <Text style={fjStyles.cardTitle}>Family Journey is switched off</Text>
          <Text style={fjStyles.cardSub}>
            You turned this feature off. No new message will be prepared for anyone. You can switch it
            back on in Family Journey or in Settings → Data &amp; Privacy.
          </Text>
          <Pressable style={fjStyles.primary} onPress={() => router.replace('/family-journey')} testID="fj-off-hub">
            <Text style={fjStyles.primaryTxt}>Open Family Journey</Text>
          </Pressable>
        </View>
        <JourneyHelpRow />
      </ScrollView>
    </View>
  );
}

export const fjStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  body: { padding: 16, paddingBottom: 220, gap: 14 },
  card: { backgroundColor: c.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: c.border, padding: 16, gap: 8 },
  cardTitle: { fontFamily: theme.fonts.displayBold, fontSize: 17, color: c.ink },
  cardSub: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, lineHeight: 19 },
  label: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.ink, marginTop: 6 },
  input: {
    backgroundColor: c.surfaceSecondary, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: c.border,
    paddingHorizontal: 12, paddingVertical: 10, fontFamily: theme.fonts.body, fontSize: 15, color: c.ink, minHeight: 44,
  },
  primary: { backgroundColor: c.navy, borderRadius: theme.radius.pill, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  primaryTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 15 },
  secondary: {
    backgroundColor: c.surface, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: c.borderStrong,
    minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, flexDirection: 'row', gap: 8,
  },
  secondaryTxt: { color: c.navy, fontFamily: theme.fonts.bodyBold, fontSize: 15 },
  pill: { alignSelf: 'flex-start', backgroundColor: c.surfaceSecondary, borderRadius: theme.radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  pillTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 11, color: c.muted, letterSpacing: 0.2 },
  empty: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, lineHeight: 19 },
});

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.navy, paddingHorizontal: 12, paddingBottom: 14 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  hTitle: { color: '#fff', fontFamily: theme.fonts.displayBold, fontSize: 21 },
  hSub: { color: c.onNavyMuted, fontFamily: theme.fonts.body, fontSize: 12, marginTop: 2 },

  helpRow: { flexDirection: 'row', gap: 10 },
  helpBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44,
    backgroundColor: c.surface, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: c.borderStrong, paddingHorizontal: 12,
  },
  helpTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.navy },

  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 8,
    backgroundColor: c.goldMuted, borderWidth: 1, borderColor: c.gold, borderRadius: theme.radius.sm,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  badgeTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 12, color: c.darkGold, letterSpacing: 0.2 },

  phase: { backgroundColor: c.navySoft, borderRadius: theme.radius.md, borderWidth: 1, borderColor: c.border, padding: 14, gap: 6 },
  phaseTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.navy },
  phaseBody: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, lineHeight: 19 },

  backdrop: { flex: 1, backgroundColor: 'rgba(14,39,64,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: c.surface, borderTopLeftRadius: theme.radius.lg, borderTopRightRadius: theme.radius.lg,
    padding: 20, paddingBottom: 28, gap: 12, maxHeight: '80%',
  },
  sheetTitle: { fontFamily: theme.fonts.displayBold, fontSize: 19, color: c.ink },
  sheetBody: { fontFamily: theme.fonts.body, fontSize: 14, color: c.muted, lineHeight: 20, marginTop: 6 },
  primaryBtn: { backgroundColor: c.navy, borderRadius: theme.radius.pill, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  primaryBtnTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 15 },
  ghostBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  ghostBtnTxt: { color: c.muted, fontFamily: theme.fonts.bodySemiBold, fontSize: 14 },
});
