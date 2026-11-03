/**
 * Data & Privacy screen — in-app fulfilment of DHARA's DPDP obligations.
 * Route: /settings/data-privacy
 * Entry: Settings → Legal → "Data & Privacy"
 *
 * ┌──────────────────────────────────────┐
 * │  § 1  What DHARA collects  (accordion) │
 * │  § 2  How we use your data (accordion) │
 * │  § 3  Your data rights     (always on) │
 * │  § 4  Our commitments      (static)    │
 * └──────────────────────────────────────┘
 *
 */
import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth, API_BASE } from '@/src/auth';
import { theme } from '@/src/theme';

import { openExternal } from '@/src/outbound';
// ── Contact constants ─────────────────────────────────────────────────────────
const GRIEVANCE_EMAIL        = 'grievance@calviltech.com';
const SUPPORT_EMAIL          = 'support@calviltech.com';
const GRIEVANCE_OFFICER_NAME = 'The Grievance Officer, Calvil Technologies';

// ── Accent colours (spec) ─────────────────────────────────────────────────────
const PRIMARY     = theme.colors.primary;
const ACCENT      = theme.colors.brandSecondary;
const DESTRUCTIVE = '#DC2626';   // delete action
const BADGE_BG    = '#F0FDF4';   // compliance badge background
const BADGE_TEXT  = '#166534';   // compliance badge text

// ── Data collected rows ───────────────────────────────────────────────────────
const COLLECTED = [
  {
    icon: 'mic-outline',
    label: 'Voice recordings',
    retention: 'Not stored — transcribed and immediately discarded',
  },
  {
    icon: 'document-text-outline',
    label: 'FIR drafts',
    retention: 'Until you delete them or close your account',
  },
  {
    icon: 'phone-portrait-outline',
    label: 'Account info',
    retention: 'While your account is active, then 30 days after deletion',
  },
  {
    icon: 'checkmark-circle-outline',
    label: 'Consent records',
    retention: 'Kept indefinitely as proof of your agreement',
  },
];

// ── How we use data bullets ───────────────────────────────────────────────────
const USES = [
  'Your inputs are sent to AI providers in anonymised form only — your name, phone, and account details are never included in AI queries.',
  'DHARA does not use your data to train AI models.',
  'Your FIR drafts are stored encrypted and are never shared with police, courts, or any third party — DHARA only shows them to you.',
  'We do not sell your data.',
];

export default function DataPrivacyScreen() {
  const router = useRouter();
  const { token } = useAuth();

  const [sec1Open, setSec1Open] = useState(false);
  const [sec2Open, setSec2Open] = useState(false);

  const [exportLoading, setExportLoading]   = useState(false);
  const [exportSuccess, setExportSuccess]   = useState(false);

  const handleDownload = useCallback(async () => {
    if (!token) return;
    setExportLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/user/data-export`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Request failed');
      setExportSuccess(true);
      // Auto-hide after 4 s
      setTimeout(() => setExportSuccess(false), 4000);
    } catch {
      Alert.alert('Could not submit request', 'Please try again or email ' + SUPPORT_EMAIL);
    } finally {
      setExportLoading(false);
    }
  }, [token]);

  const handleWithdrawConsent = () => {
    // Navigate to the P0 Fix 4 consent-preferences screen
    router.push('/consent?mode=update' as any);
  };

  const handleContact = () => {
    const url = `mailto:${GRIEVANCE_EMAIL}?subject=DHARA%20Data%20Request`;
    openExternal(url).catch(() => {
      Alert.alert('Cannot open email app', `Please email us at ${GRIEVANCE_EMAIL}`);
    });
  };

  const handleDeleteAccount = () => {
    // Route to existing Danger Zone in main settings — deletion is not built here
    router.push('/(tabs)/settings' as any);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={PRIMARY} />
        </Pressable>
        <Text style={styles.headerTitle}>Data &amp; Privacy</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ══════════════════════════════════════════════════════════
            SECTION 1 — What DHARA collects  (collapsible accordion)
            ══════════════════════════════════════════════════════════ */}
        <Pressable
          style={styles.accordionHeader}
          onPress={() => setSec1Open(v => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: sec1Open }}
        >
          <Text style={styles.accordionTitle}>What DHARA collects</Text>
          <Ionicons
            name={sec1Open ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={sec1Open ? ACCENT : theme.colors.onSurfaceTertiary}
          />
        </Pressable>

        {sec1Open && (
          <View style={styles.accordionBody}>
            {COLLECTED.map((row, i) => (
              <View
                key={row.label}
                style={[styles.collectRow, i < COLLECTED.length - 1 && styles.collectRowBorder]}
              >
                <View style={styles.collectIconWrap}>
                  <Ionicons name={row.icon as any} size={18} color={PRIMARY} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.collectLabel}>{row.label}</Text>
                  <Text style={styles.collectRetention}>{row.retention}</Text>
                </View>
              </View>
            ))}
            <Text style={styles.paymentsNote}>
              💳 Payments processed by Razorpay are retained for 7 years as required by law.
            </Text>
          </View>
        )}

        {/* ══════════════════════════════════════════════════════════
            SECTION 2 — How we use your data  (collapsible accordion)
            ══════════════════════════════════════════════════════════ */}
        <Pressable
          style={[styles.accordionHeader, { marginTop: theme.spacing.sm }]}
          onPress={() => setSec2Open(v => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: sec2Open }}
        >
          <Text style={styles.accordionTitle}>How we use your data</Text>
          <Ionicons
            name={sec2Open ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={sec2Open ? ACCENT : theme.colors.onSurfaceTertiary}
          />
        </Pressable>

        {sec2Open && (
          <View style={styles.accordionBody}>
            {USES.map((point, i) => (
              <View key={i} style={styles.bulletRow}>
                <View style={styles.bulletDot} />
                <Text style={styles.bulletText}>{point}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ══════════════════════════════════════════════════════════
            SECTION 3 — Your data rights  (NOT collapsible)
            ══════════════════════════════════════════════════════════ */}
        <Text style={styles.sectionHeader}>Your data rights</Text>

        {/* 3a. Download my data */}
        <Pressable
          testID="download-data-btn"
          style={({ pressed }) => [styles.actionCard, pressed && { opacity: 0.8 }]}
          onPress={handleDownload}
          disabled={exportLoading}
        >
          <View style={styles.actionIconWrap}>
            {exportLoading
              ? <ActivityIndicator size="small" color={PRIMARY} />
              : <Ionicons name="download-outline" size={20} color={PRIMARY} />
            }
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.actionTitle}>Download my data</Text>
            <Text style={styles.actionSub}>Get a copy of your DHARA data</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.onSurfaceTertiary} />
        </Pressable>

        {/* Success toast (inline) */}
        {exportSuccess && (
          <View testID="export-success-banner" style={styles.successBanner}>
            <Ionicons name="checkmark-circle" size={16} color={BADGE_TEXT} />
            <Text style={styles.successBannerText}>
              {"We'll email your data export within 24 hours"}
            </Text>
          </View>
        )}

        {/* 3b. Delete my account — destructive */}
        <Pressable
          testID="delete-account-btn"
          style={({ pressed }) => [styles.actionCard, styles.actionCardDestructive, pressed && { opacity: 0.8 }]}
          onPress={handleDeleteAccount}
        >
          <View style={[styles.actionIconWrap, { backgroundColor: '#FEF2F2' }]}>
            <Ionicons name="trash-outline" size={20} color={DESTRUCTIVE} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.actionTitle, { color: DESTRUCTIVE }]}>Delete my account</Text>
            <Text style={styles.actionSub}>Delete account and all data</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={DESTRUCTIVE} />
        </Pressable>

        {/* 3c. Withdraw consent */}
        <Pressable
          testID="withdraw-consent-btn"
          style={({ pressed }) => [styles.actionCard, pressed && { opacity: 0.8 }]}
          onPress={handleWithdrawConsent}
        >
          <View style={styles.actionIconWrap}>
            <Ionicons name="options-outline" size={20} color={PRIMARY} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.actionTitle}>Withdraw consent</Text>
            <Text style={styles.actionSub}>Change my data preferences</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.onSurfaceTertiary} />
        </Pressable>

        {/* 3d. Contact us */}
        <Pressable
          testID="contact-grievance-btn"
          style={({ pressed }) => [styles.actionCard, pressed && { opacity: 0.8 }]}
          onPress={handleContact}
        >
          <View style={styles.actionIconWrap}>
            <Ionicons name="mail-outline" size={20} color={PRIMARY} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.actionTitle}>Grievance or data question?</Text>
            <Text style={styles.actionSub}>Respond within 30 days</Text>
            <Text style={styles.actionFooter}>
              Grievance Officer: {GRIEVANCE_OFFICER_NAME}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.onSurfaceTertiary} />
        </Pressable>

        {/* ══════════════════════════════════════════════════════════
            SECTION 4 — Our commitments  (static, no accordion)
            ══════════════════════════════════════════════════════════ */}
        <Text style={[styles.sectionHeader, { marginTop: theme.spacing.xl }]}>Our commitments</Text>

        <View style={styles.badgesRow}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>🇮🇳 DPDP Act 2023 compliant</Text>
          </View>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>🇨🇦 PIPEDA compliant</Text>
          </View>
        </View>

        <Text style={styles.operatorNote}>
          DHARA is operated by MSafe Solutions Inc. (Canada) and Calviltech Digital Solutions Pvt Ltd (India).
        </Text>

        {/* Spacer */}
        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
    backgroundColor: theme.colors.surface,
  },
  backBtn: { width: 40, height: 40, alignItems: 'flex-start', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: theme.colors.onSurface },
  scroll: { flex: 1 },
  scrollContent: {
    padding: theme.spacing.lg,
    paddingBottom: 40,
  },

  // ── Accordion ──────────────────────────────────────────────────────────────
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  accordionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: PRIMARY,
    flex: 1,
  },
  accordionBody: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: theme.colors.border,
    borderBottomLeftRadius: theme.radius.lg,
    borderBottomRightRadius: theme.radius.lg,
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
    marginBottom: 0,
  },

  // ── Section 1 rows ─────────────────────────────────────────────────────────
  collectRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
  },
  collectRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
  },
  collectIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(30,58,138,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  collectLabel: { fontSize: 13, fontWeight: '700', color: theme.colors.onSurface },
  collectRetention: {
    fontSize: 12,
    color: theme.colors.onSurfaceSecondary,
    marginTop: 2,
    lineHeight: 17,
  },
  paymentsNote: {
    fontSize: 11,
    color: theme.colors.onSurfaceTertiary,
    lineHeight: 16,
    marginTop: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.divider,
  },

  // ── Section 2 bullets ──────────────────────────────────────────────────────
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 8,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: PRIMARY,
    marginTop: 6,
    flexShrink: 0,
  },
  bulletText: {
    flex: 1,
    fontSize: 13,
    color: theme.colors.onSurface,
    lineHeight: 19,
  },

  // ── Section header (non-accordion) ─────────────────────────────────────────
  sectionHeader: {
    fontSize: 13,
    fontWeight: '800',
    color: PRIMARY,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: theme.spacing.xl,
    marginBottom: theme.spacing.md,
  },

  // ── Action cards ───────────────────────────────────────────────────────────
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 12,
  },
  actionCardDestructive: {
    borderColor: '#FECACA',
    backgroundColor: '#FFF5F5',
  },
  actionIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(30,58,138,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  actionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.colors.onSurface,
  },
  actionSub: {
    fontSize: 12,
    color: theme.colors.onSurfaceSecondary,
    marginTop: 1,
  },
  actionFooter: {
    fontSize: 11,
    color: theme.colors.onSurfaceTertiary,
    marginTop: 3,
    fontStyle: 'italic',
  },

  // ── Export success banner ──────────────────────────────────────────────────
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: BADGE_BG,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  successBannerText: {
    fontSize: 13,
    fontWeight: '600',
    color: BADGE_TEXT,
    flex: 1,
  },

  // ── Section 4 badges ───────────────────────────────────────────────────────
  badgesRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    flexWrap: 'wrap',
  },
  badge: {
    backgroundColor: BADGE_BG,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: BADGE_TEXT,
  },
  operatorNote: {
    fontSize: 11,
    color: theme.colors.onSurfaceTertiary,
    lineHeight: 17,
    marginTop: theme.spacing.md,
  },
});
