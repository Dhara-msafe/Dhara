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
import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, Alert, Switch, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth, API_BASE } from '@/src/auth';
import { theme } from '@/src/theme';
import { UI_V22_P10 } from '@/src/uiV22Flags';
import { useFamilyJourneyEnabled } from '@/src/familyJourney/store';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { goBackOr } from '@/src/goBackOr';
// NF-UI-REV-12 (Group J, DHARA UI Revision v2.2.1): presentation-only
// rollback flag + visible keyboard-focus ring + missing a11y labels.
import { UI_REVISION_V1 } from '@/src/designRevision';
import { focusRingStyle } from '@/src/a11yFocus';
// B-70: the grievance officer used to be hardcoded here as its own local
// value, different from the consent screen, my-data.tsx and /grievance. Now
// every screen reads the single source, operatorIdentity.ts (Varuna Moses,
// grievances@askdhara.in, owner-confirmed 17 Nov). This screen shows the
// officer's name and opens /grievance, which shows the email.
import { grievanceOfficerName as GRIEVANCE_OFFICER_NAME, isGrievanceContactPlaceholder, privacyContactEmail } from '@/src/operatorIdentity';
import { v22SectionLabel } from '@/src/v22SectionLabel';
// ── Contact constants ─────────────────────────────────────────────────────────
// SUPPORT_EMAIL is the general privacy / data-controller inbox (Callistus,
// callistus@askdhara.in). It is imported from operatorIdentity.ts so there
// is one place to update it. It is intentionally distinct from the
// statutory DPDP grievance contact (operatorIdentity.ts grievanceContactEmail)
// and is not part of the B-70 grievance consolidation.
const SUPPORT_EMAIL          = privacyContactEmail;

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
  'Your FIR drafts are stored on DHARA\'s servers (encrypted at rest) and are never shared with police, courts, or any third party — DHARA only shows them to you.',
  'We do not sell your data.',
];

/** P10: consent state chip colours from theme.consentState (P1 tokens). */
const CS = theme.consentState;
function P10OptionalStatus({ on, testID }: { on: boolean; testID: string }) {
  const tone = on ? CS.agreed : CS.notGiven;
  return (
    <View style={styles.p10StatusRow} testID={testID}>
      <View style={[styles.p10StateChip, { backgroundColor: tone.bg }]}>
        <Text style={[styles.p10StateChipText, { color: tone.fg }]}>{on ? 'Agreed' : 'Not given'}</Text>
      </View>
      <Text style={styles.p10StateNote}>Saved with the date and time in your record</Text>
    </View>
  );
}

/** P10: history chip — state in words AND colour (not ✓/✗ alone). An
 * optional purpose that is off may never have been given, so it uses the
 * neutral 'not given' tone, never the red 'withdrawn' one. */
function p10ChipTone(on: boolean) {
  return on ? CS.agreed : CS.notGiven;
}

export default function DataPrivacyScreen() {
  const router = useRouter();
  const { token } = useAuth();

  const [sec1Open, setSec1Open] = useState(false);
  const [sec2Open, setSec2Open] = useState(false);
  const { enabled: fjEnabled, setEnabled: setFjEnabled } = useFamilyJourneyEnabled();

  const [exportLoading, setExportLoading]   = useState(false);
  const [exportSuccess, setExportSuccess]   = useState(false);

  // ── ID-47: Per-purpose consent toggles (analytics, updates) ──────────────
  const [purposesLoading, setPurposesLoading] = useState(true);
  const [purposesSaving,  setPurposesSaving]  = useState(false);
  const [analytics, setAnalyticsState] = useState(false);
  const [updates,   setUpdatesState]   = useState(false);
  // Current consent record (Screen 54)
  const [consentRecord, setConsentRecord] = useState<{
    version: string; accepted_at: string; purposes: Record<string, boolean>;
  } | null>(null);

  // Load current purposes + consent record on mount
  React.useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        const p = data.consent_purposes || {};
        setAnalyticsState(!!p.analytics);
        setUpdatesState(!!p.updates);
        // Build consent record from user object
        setConsentRecord({
          version:     data.terms_version   || '',
          accepted_at: data.terms_accepted_at || '',
          purposes:    p,
        });
      })
      .catch(() => {/* non-fatal */})
      .finally(() => setPurposesLoading(false));
  }, [token]);

  // ── Screen 55: Consent history ledger ────────────────────────────────────
  type HistoryEntry = {
    timestamp: string; event?: string;
    purposes: { core?: boolean; analytics?: boolean; updates?: boolean };
    notice_version?: string; language?: string;
  };
  const [historyEntries,  setHistoryEntries]  = useState<HistoryEntry[]>([]);
  const [historyTotal,    setHistoryTotal]    = useState(0);
  const [historyLoading,  setHistoryLoading]  = useState(false);
  const [historyOpen,     setHistoryOpen]     = useState(false);
  const [historyShowAll,  setHistoryShowAll]  = useState(false);

  const loadHistory = useCallback(async (all: boolean) => {
    if (!token) return;
    setHistoryLoading(true);
    try {
      const limit = all ? 0 : 10;
      const res = await fetch(`${API_BASE}/api/user/consent-history?limit=${limit}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('failed');
      const data = await res.json();
      setHistoryEntries(data.entries || []);
      setHistoryTotal(data.total || 0);
      if (all) setHistoryShowAll(true);
    } catch {/* non-fatal */}
    finally { setHistoryLoading(false); }
  }, [token]);

  // Auto-load last 10 when accordion opens
  useEffect(() => {
    if (historyOpen && historyEntries.length === 0 && !historyLoading) {
      loadHistory(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyOpen]);

  const handlePurposeToggle = useCallback(
    async (field: 'analytics' | 'updates', value: boolean) => {
      if (!token || purposesSaving) return;
      const next = field === 'analytics'
        ? { analytics: value, updates }
        : { analytics, updates: value };
      if (field === 'analytics') setAnalyticsState(value);
      else setUpdatesState(value);
      setPurposesSaving(true);
      try {
        const res = await fetch(`${API_BASE}/api/user/privacy-choices`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(next),
        });
        if (!res.ok) throw new Error('save failed');
        // Update the displayed consent record timestamp
        setConsentRecord(prev => prev ? {
          ...prev,
          purposes: { ...prev.purposes, ...next },
          accepted_at: new Date().toISOString(),
        } : null);
        // Refresh history if already loaded
        if (historyEntries.length > 0) {
          loadHistory(historyShowAll);
        }
      } catch {
        // Revert on failure
        if (field === 'analytics') setAnalyticsState(!value);
        else setUpdatesState(!value);
        Alert.alert('Could not save', 'Please try again.');
      } finally {
        setPurposesSaving(false);
      }
    },
    [token, purposesSaving, analytics, updates, historyEntries.length, historyShowAll, loadHistory],
  );

  // ── Helpers ───────────────────────────────────────────────────────────────
  const fmtDate = (iso: string) => {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return iso.slice(0, 16).replace('T', ' '); }
  };

  const eventLabel = (event?: string) => {
    if (!event || event === 'initial_consent') return 'Initial consent';
    if (event === 'privacy_choices_update') return 'Preferences updated';
    if (event === 'withdrawal') return 'Consent withdrawn';
    return event.replace(/_/g, ' ');
  };

  // B-83: this used to POST to a stub endpoint that only logged the request
  // and showed a canned "we'll email your data export within 24 hours"
  // banner -- no email was ever sent and no file ever appeared anywhere.
  // Settings -> My Data (app/my-data.tsx) already has a real, working export
  // (GET /api/user/my-data/export -> write to a temp file -> native share
  // sheet), so this now does exactly the same thing instead of promising
  // something nothing ever fulfilled.
  const handleDownload = useCallback(async () => {
    if (!token) return;
    setExportLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/user/my-data/export`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Request failed');
      const json = await res.json();
      const jsonStr = JSON.stringify(json, null, 2);

      if (Platform.OS === 'web') {
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dhara-my-data-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setExportSuccess(true);
        setTimeout(() => setExportSuccess(false), 4000);
      } else {
        const tempFile = new File(Paths.cache, `dhara-my-data-${Date.now()}.json`);
        try {
          tempFile.write(jsonStr);
          const canShare = await Sharing.isAvailableAsync();
          if (canShare) {
            await Sharing.shareAsync(tempFile.uri, {
              mimeType: 'application/json',
              dialogTitle: 'Export your Dhara data',
            });
            setExportSuccess(true);
            setTimeout(() => setExportSuccess(false), 4000);
          } else {
            Alert.alert('Export complete', 'Your data export is ready, but sharing is not available on this device.');
          }
        } finally {
          try { tempFile.delete(); } catch {}
        }
      }
    } catch {
      Alert.alert('Could not export data', 'Please try again or email ' + SUPPORT_EMAIL);
    } finally {
      setExportLoading(false);
    }
  }, [token]);

  const handleWithdrawConsent = () => {
    // Navigate to the P0 Fix 4 consent-preferences screen
    router.push('/consent?mode=update' as any);
  };

  // W6-J05 (12 Nov 2026): open the in-app grievance screen (raise a ticket,
  // see past tickets). The old mailto link did nothing on web/preview. The
  // /grievance screen reads the single operatorIdentity source (B-70) and
  // never shows an unconfirmed placeholder address.
  const handleContact = () => {
    router.push('/grievance' as any);
  };

  const handleDeleteAccount = () => {
    // Route to existing Danger Zone in main settings — deletion is not built here
    router.push('/(tabs)/settings' as any);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Pressable onPress={() => goBackOr(router, '/(tabs)/settings')} hitSlop={8} style={(s) => [styles.backBtn, focusRingStyle(s)]} accessibilityRole="button" accessibilityLabel="Go back">
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
          style={(s) => [styles.accordionHeader, focusRingStyle(s)]}
          onPress={() => setSec1Open(v => !v)}
          accessibilityRole="button"
          accessibilityLabel="What DHARA collects"
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
          style={(s) => [styles.accordionHeader, { marginTop: theme.spacing.sm }, focusRingStyle(s)]}
          onPress={() => setSec2Open(v => !v)}
          accessibilityRole="button"
          accessibilityLabel="How we use your data"
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
          style={(s) => [styles.actionCard, s.pressed && { opacity: 0.8 }, focusRingStyle(s)]}
          onPress={handleDownload}
          disabled={exportLoading}
          accessibilityRole="button"
          accessibilityLabel="Download my data. Get a copy of your DHARA data"
          accessibilityState={{ disabled: exportLoading, busy: exportLoading }}
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
              {Platform.OS === 'web'
                ? 'Your data export has downloaded'
                : 'Your data export is ready to share'}
            </Text>
          </View>
        )}

        {/* 3b. Delete my account — destructive */}
        <Pressable
          testID="delete-account-btn"
          style={(s) => [styles.actionCard, styles.actionCardDestructive, s.pressed && { opacity: 0.8 }, focusRingStyle(s)]}
          onPress={handleDeleteAccount}
          accessibilityRole="button"
          accessibilityLabel="Delete my account. Delete account and all data"
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
          style={(s) => [styles.actionCard, s.pressed && { opacity: 0.8 }, focusRingStyle(s)]}
          onPress={handleWithdrawConsent}
          accessibilityRole="button"
          accessibilityLabel="Withdraw consent. Change my data preferences"
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
          style={(s) => [styles.actionCard, s.pressed && { opacity: 0.8 }, focusRingStyle(s)]}
          onPress={handleContact}
          accessibilityRole="button"
          accessibilityLabel="Grievance or data question? Acknowledged within 48 hours, resolved within 30 days"
        >
          <View style={styles.actionIconWrap}>
            <Ionicons name="mail-outline" size={20} color={PRIMARY} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.actionTitle}>Grievance or data question?</Text>
            <Text style={styles.actionSub}>Acknowledged within 48 hours, resolved within 30 days</Text>
            {!isGrievanceContactPlaceholder() && (
              <Text style={styles.actionFooter}>
                Grievance Officer: {GRIEVANCE_OFFICER_NAME}
              </Text>
            )}
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.onSurfaceTertiary} />
        </Pressable>

        {/* ══════════════════════════════════════════════════════════
            SECTION 3b — Consent preferences  (ID-47 / Screen 46 partial)
            Per-purpose toggles for optional processing.
            ══════════════════════════════════════════════════════════ */}
        <Text style={[styles.sectionHeader, { marginTop: theme.spacing.xl }]}>Consent preferences</Text>

        {purposesLoading ? (
          <ActivityIndicator style={{ marginVertical: 16 }} color={PRIMARY} />
        ) : (
          <>
            {/* Analytics toggle */}
            <View style={styles.actionCard} testID="consent-analytics-card">
              <View style={styles.actionIconWrap}>
                <Ionicons name="bar-chart-outline" size={20} color={PRIMARY} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.p10TitleRow}>
                  <Text style={styles.actionTitle}>Analytics</Text>
                  {UI_V22_P10 && <View style={styles.p10OptionalBadge}><Text style={styles.p10OptionalBadgeText}>Optional</Text></View>}
                </View>
                <Text style={styles.actionSub}>Help improve DHARA using anonymised usage data</Text>
                {UI_V22_P10 && <P10OptionalStatus on={analytics} testID="consent-analytics-state" />}
              </View>
              {purposesSaving
                ? <ActivityIndicator size="small" color={PRIMARY} />
                : (
                  <Switch
                    testID="consent-analytics-toggle"
                    accessibilityLabel="Allow anonymised analytics"
                    value={analytics}
                    onValueChange={v => handlePurposeToggle('analytics', v)}
                    trackColor={{ true: PRIMARY, false: theme.colors.borderStrong }}
                    thumbColor="#fff"
                  />
                )
              }
            </View>

            {/* Updates toggle */}
            <View style={styles.actionCard} testID="consent-updates-card">
              <View style={styles.actionIconWrap}>
                <Ionicons name="notifications-outline" size={20} color={PRIMARY} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.p10TitleRow}>
                  <Text style={styles.actionTitle}>Service updates</Text>
                  {UI_V22_P10 && <View style={styles.p10OptionalBadge}><Text style={styles.p10OptionalBadgeText}>Optional</Text></View>}
                </View>
                <Text style={styles.actionSub}>Receive important updates about DHARA features</Text>
                {UI_V22_P10 && <P10OptionalStatus on={updates} testID="consent-updates-state" />}
              </View>
              {purposesSaving
                ? <ActivityIndicator size="small" color={PRIMARY} />
                : (
                  <Switch
                    testID="consent-updates-toggle"
                    accessibilityLabel="Allow service update messages"
                    value={updates}
                    onValueChange={v => handlePurposeToggle('updates', v)}
                    trackColor={{ true: PRIMARY, false: theme.colors.borderStrong }}
                    thumbColor="#fff"
                  />
                )
              }
            </View>
          </>
        )}

        {/* ══════════════════════════════════════════════════════════
            SECTION 3c — Consent record  (Screen 54 — current snapshot)
            ══════════════════════════════════════════════════════════ */}
        <Text style={[styles.sectionHeader, { marginTop: theme.spacing.xl }]}>My consent record</Text>

        <View style={[styles.actionCard, styles.consentRecordCard]} testID="consent-record-card">
          <View style={styles.crRow}>
            <Ionicons name="shield-checkmark-outline" size={18} color={PRIMARY} style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.crLabel}>Notice version</Text>
              <Text style={styles.crValue}>{consentRecord?.version || '—'}</Text>
            </View>
          </View>
          <View style={[styles.crRow, { marginTop: 10 }]}>
            <Ionicons name="time-outline" size={18} color={PRIMARY} style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.crLabel}>Last updated</Text>
              <Text style={styles.crValue}>
                {consentRecord?.accepted_at ? fmtDate(consentRecord.accepted_at) : '—'}
              </Text>
            </View>
          </View>
          <View style={[styles.crRow, { marginTop: 10 }]}>
            <Ionicons name="checkmark-circle-outline" size={18} color={PRIMARY} style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.crLabel}>Active purposes</Text>
              <View style={styles.purposeChips}>
                <View style={[styles.chip, { backgroundColor: '#EEF2FF' }]}>
                  <Text style={[styles.chipText, { color: '#3730A3' }]}>Core ✓</Text>
                </View>
                <View style={[styles.chip,
                  consentRecord?.purposes?.analytics
                    ? { backgroundColor: '#F0FDF4' }
                    : { backgroundColor: '#FEF2F2' }
                ]}>
                  <Text style={[styles.chipText,
                    consentRecord?.purposes?.analytics
                      ? { color: '#166534' }
                      : { color: '#991B1B' }
                  ]}>
                    Analytics {consentRecord?.purposes?.analytics ? '✓' : '✗'}
                  </Text>
                </View>
                <View style={[styles.chip,
                  consentRecord?.purposes?.updates
                    ? { backgroundColor: '#F0FDF4' }
                    : { backgroundColor: '#FEF2F2' }
                ]}>
                  <Text style={[styles.chipText,
                    consentRecord?.purposes?.updates
                      ? { color: '#166534' }
                      : { color: '#991B1B' }
                  ]}>
                    Updates {consentRecord?.purposes?.updates ? '✓' : '✗'}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* ══════════════════════════════════════════════════════════
            SECTION 3d — Consent history  (Screen 55 — ledger)
            Last 10 by default; "View all" shows complete log.
            ══════════════════════════════════════════════════════════ */}
        <Pressable
          testID="consent-history-accordion"
          style={(s) => [styles.accordionHeader, { marginTop: theme.spacing.xl }, focusRingStyle(s)]}
          onPress={() => setHistoryOpen(v => !v)}
          accessibilityRole="button"
          accessibilityLabel="Consent history"
          accessibilityState={{ expanded: historyOpen }}
        >
          <Text style={styles.accordionTitle}>Consent history</Text>
          <Ionicons
            name={historyOpen ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={historyOpen ? ACCENT : theme.colors.onSurfaceTertiary}
          />
        </Pressable>

        {historyOpen && (
          <View style={styles.accordionBody}>
            {historyLoading && historyEntries.length === 0 ? (
              <ActivityIndicator style={{ marginVertical: 16 }} color={PRIMARY} />
            ) : historyEntries.length === 0 ? (
              <Text style={[styles.collectRetention, { paddingVertical: 12 }]}>
                No consent history yet.
              </Text>
            ) : (
              <>
                {historyEntries.map((entry, i) => (
                  <View
                    key={`${entry.timestamp}-${i}`}
                    style={[
                      styles.historyRow,
                      i < historyEntries.length - 1 && styles.collectRowBorder,
                    ]}
                  >
                    <View style={styles.historyDotWrap}>
                      <View style={styles.historyDot} />
                      {i < historyEntries.length - 1 && <View style={styles.historyLine} />}
                    </View>
                    <View style={{ flex: 1, paddingBottom: 12 }}>
                      <Text style={styles.historyEvent}>{eventLabel(entry.event)}</Text>
                      <Text style={styles.historyTime}>{fmtDate(entry.timestamp)}</Text>
                      <View style={[styles.purposeChips, { marginTop: 5 }]}>
                        {entry.purposes?.core !== false && (
                          <View style={[styles.chip, { backgroundColor: UI_V22_P10 ? CS.agreed.bg : '#EEF2FF' }]}>
                            <Text style={[styles.chipText, { color: UI_V22_P10 ? CS.agreed.fg : '#3730A3' }]}>{UI_V22_P10 ? 'Core: agreed' : 'Core ✓'}</Text>
                          </View>
                        )}
                        {UI_V22_P10 ? (
                          <>
                            {([['Analytics', !!entry.purposes?.analytics], ['Updates', !!entry.purposes?.updates]] as const).map(([name, on]) => (
                              <View key={name} style={[styles.chip, { backgroundColor: p10ChipTone(on).bg }]}>
                                <Text style={[styles.chipText, { color: p10ChipTone(on).fg }]}>
                                  {name}: {on ? 'agreed' : 'not given'}
                                </Text>
                              </View>
                            ))}
                          </>
                        ) : (<>
                        <View style={[styles.chip,
                          entry.purposes?.analytics
                            ? { backgroundColor: '#F0FDF4' }
                            : { backgroundColor: '#F3F4F6' }
                        ]}>
                          <Text style={[styles.chipText,
                            entry.purposes?.analytics
                              ? { color: '#166534' }
                              : { color: '#6B7280' }
                          ]}>
                            Analytics {entry.purposes?.analytics ? '✓' : '✗'}
                          </Text>
                        </View>
                        <View style={[styles.chip,
                          entry.purposes?.updates
                            ? { backgroundColor: '#F0FDF4' }
                            : { backgroundColor: '#F3F4F6' }
                        ]}>
                          <Text style={[styles.chipText,
                            entry.purposes?.updates
                              ? { color: '#166534' }
                              : { color: '#6B7280' }
                          ]}>
                            Updates {entry.purposes?.updates ? '✓' : '✗'}
                          </Text>
                        </View>
                        </>)}
                      </View>
                      {entry.notice_version ? (
                        <Text style={styles.historyVersion}>Notice v{entry.notice_version}</Text>
                      ) : null}
                    </View>
                  </View>
                ))}

                {/* View all / showing all indicator */}
                {!historyShowAll && historyTotal > historyEntries.length && (
                  <Pressable
                    testID="consent-history-view-all"
                    style={(s) => [styles.viewAllBtn, focusRingStyle(s)]}
                    onPress={() => loadHistory(true)}
                    accessibilityRole="button"
                    accessibilityLabel={`View all ${historyTotal} consent history entries`}
                  >
                    {historyLoading
                      ? <ActivityIndicator size="small" color={PRIMARY} />
                      : <Text style={styles.viewAllText}>
                          View all {historyTotal} entries
                        </Text>
                    }
                  </Pressable>
                )}
                {historyShowAll && (
                  <Text style={[styles.collectRetention, { paddingVertical: 8, textAlign: 'center' }]}>
                    Showing all {historyTotal} entries
                  </Text>
                )}
              </>
            )}
          </View>
        )}

        {/* ══════════════════════════════════════════════════════════
            Family Journey — app-wide switch (Phase 1: preview only)
            ══════════════════════════════════════════════════════════ */}
        <Text style={[styles.sectionHeader, { marginTop: theme.spacing.xl }]}>Family Journey</Text>

        <View style={styles.actionCard} testID="fj-privacy-toggle-card">
          <View style={styles.actionIconWrap}>
            <Ionicons name="navigate-outline" size={20} color={PRIMARY} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.actionTitle}>Family Journey</Text>
            <Text style={styles.actionSub}>
              {fjEnabled
                ? 'On — a contact is only messaged when you press Send yourself. No location is collected.'
                : 'Off — hidden everywhere in DHARA.'}
            </Text>
          </View>
          <Switch
            testID="fj-privacy-toggle"
            accessibilityLabel="Family Journey"
            value={fjEnabled}
            onValueChange={setFjEnabled}
            trackColor={{ true: PRIMARY, false: theme.colors.borderStrong }}
            thumbColor="#fff"
          />
        </View>

        {/* ══════════════════════════════════════════════════════════
            SECTION 4 — Our commitments  (static, no accordion)
            ══════════════════════════════════════════════════════════ */}
        <Text style={[styles.sectionHeader, { marginTop: theme.spacing.xl }]}>Our commitments</Text>

        <Text style={styles.reviewNote}>
          Pending legal and implementation review. This flow is intended to support rights under
          India&apos;s DPDP Act 2023 and Canada&apos;s PIPEDA. It is not a certification and has
          not been confirmed as sufficient.
        </Text>

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
    minHeight: UI_V22_P10 ? 48 : undefined,
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
    // P10: v2.2 small-caps section label (same words, presentation only)
    ...(UI_V22_P10 ? { textTransform: 'uppercase' as const, letterSpacing: 0.8, fontSize: 12 } : null),
    fontSize: UI_V22_P10 ? 12 : 13,
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
    // NF-UI-REV-12: onSurfaceTertiary directly on this screen's cream root
    // background measured ~4.33:1 — under 4.5:1. onSurfaceSecondary clears ~6.5:1.
    color: UI_REVISION_V1 ? theme.colors.onSurfaceSecondary : theme.colors.onSurfaceTertiary,
    lineHeight: 17,
    marginTop: theme.spacing.md,
  },
  reviewNote: {
    fontSize: 12,
    color: theme.colors.onSurfaceSecondary,
    lineHeight: 18,
  },

  // ── Consent record card (Screen 54) ───────────────────────────────────────
  consentRecordCard: {
    flexDirection: 'column',
    gap: 0,
    paddingVertical: theme.spacing.md,
  },
  crRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  crLabel: v22SectionLabel({
    fontSize: 11,
    color: theme.colors.onSurfaceTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  }),
  crValue: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.onSurface,
  },
  purposeChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  chipText: {
    fontSize: UI_V22_P10 ? 12 : 11,
    fontWeight: '700',
  },
  // ── P10 (v2.2 consent settings look) ──
  p10TitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  p10OptionalBadge: { backgroundColor: theme.consentState.notGiven.bg, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  p10OptionalBadgeText: { fontSize: 11, fontWeight: '700', color: theme.consentState.notGiven.fg },
  p10StatusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  p10StateChip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  p10StateChipText: { fontSize: 12, fontWeight: '700' },
  p10StateNote: { fontSize: 12, color: theme.colors.onSurfaceTertiary },

  // ── Consent history ledger (Screen 55) ───────────────────────────────────
  historyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingTop: 12,
  },
  historyDotWrap: {
    width: 16,
    alignItems: 'center',
    paddingTop: 4,
  },
  historyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: PRIMARY,
  },
  historyLine: {
    flex: 1,
    width: 1,
    backgroundColor: theme.colors.divider,
    marginTop: 4,
  },
  historyEvent: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.colors.onSurface,
  },
  historyTime: {
    fontSize: 11,
    color: theme.colors.onSurfaceTertiary,
    marginTop: 2,
  },
  historyVersion: {
    fontSize: 10,
    color: theme.colors.onSurfaceTertiary,
    marginTop: 4,
    fontStyle: 'italic',
  },
  viewAllBtn: {
    minHeight: UI_V22_P10 ? 48 : undefined,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: theme.colors.divider,
  },
  viewAllText: {
    fontSize: 13,
    fontWeight: '700',
    color: PRIMARY,
  },
});
