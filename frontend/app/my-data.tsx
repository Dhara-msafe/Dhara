/**
 * My Data Portal — DPDP Act 2023 §17 / PIPEDA Principle 9
 * T&C v2.0 clause 10.3: "These functions are available within the Application
 * under Settings > My Data."
 *
 * Screens: profile snapshot · consent record · activity stats ·
 *          data region & retention policy · Export JSON · Delete account link
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth, API_BASE } from '@/src/auth';
import { theme } from '@/src/theme';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
// B-70: this screen used to hardcode its own "grievance@calviltech.com" --
// a THIRD value, different from both the consent screen's operatorIdentity.ts
// (Varuna Moses, varuna@calviltech.com) and /grievance's own hardcoded
// string. operatorIdentity.ts is already documented as the single source of
// truth "across the app"; this screen just wasn't reading it yet.
import { grievanceOfficerName, grievanceContactEmail, isGrievanceContactPlaceholder } from '@/src/operatorIdentity';

interface MyDataSummary {
  profile: Record<string, any>;
  consent: Record<string, any>;
  activity: { total_questions: number; fir_sessions: number; saved_answers: number };
  grievances: any[];
  data_region: string;
  retention_policy: Record<string, string>;
}

export default function MyDataScreen() {
  const router = useRouter();
  const { token, loading: authLoading, forceLogout } = useAuth();
  const [summary, setSummary] = useState<MyDataSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  // W1-J07: signed out (or never signed in) -> go to sign-in instead of an
  // endless "Loading your data summary".
  useEffect(() => {
    if (!authLoading && !token) router.replace('/login');
  }, [authLoading, token, router]);
  const [exporting, setExporting] = useState(false);

  const fetchSummary = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setLoadFailed(false);
    try {
      const res = await fetch(`${API_BASE}/api/user/my-data`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // W1-J06: an error reply used to be shown as if it were the user's data
      // (dashes and default values). 401 -> session expired; other errors ->
      // say the data could not be loaded.
      if (res.status === 401) { await forceLogout(); return; }
      if (!res.ok) { setSummary(null); setLoadFailed(true); return; }
      const data = await res.json();
      setSummary(data);
    } catch {
      setSummary(null);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  const handleExport = async () => {
    if (!token) return;
    setExporting(true);
    try {
      const res = await fetch(`${API_BASE}/api/user/my-data/export`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      const jsonStr = JSON.stringify(json, null, 2);

      if (Platform.OS === 'web') {
        // Web: trigger browser download via Blob
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dhara-my-data-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        // M: migrated to the expo-file-system ~19 File/Paths API (the old
        // cacheDirectory/EncodingType/writeAsStringAsync calls no longer
        // exist on this version and threw at runtime). Write to app cache,
        // share, then always delete the temp file — export contents unchanged.
        const tempFile = new File(Paths.cache, `dhara-my-data-${Date.now()}.json`);
        try {
          tempFile.write(jsonStr);
          const canShare = await Sharing.isAvailableAsync();
          if (canShare) {
            await Sharing.shareAsync(tempFile.uri, {
              mimeType: 'application/json',
              dialogTitle: 'Export your Dhara data',
            });
          } else {
            Alert.alert('Export complete', 'Your data export is ready, but sharing is not available on this device.');
          }
        } finally {
          try { tempFile.delete(); } catch {}
        }
      }
    } catch (e) {
      Alert.alert('Export failed', 'Could not export data. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={theme.colors.brand} />
          <Text style={styles.loadingText}>Loading your data summary…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loadFailed || !summary) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.loadingWrap}>
          <Ionicons name="cloud-offline-outline" size={36} color={theme.colors.onSurfaceSecondary} />
          <Text testID="my-data-load-failed" style={styles.loadingText}>We could not load your data right now.</Text>
          <Pressable testID="my-data-retry" onPress={fetchSummary} hitSlop={8}>
            <Text style={[styles.loadingText, { color: theme.colors.brand, fontWeight: '700' }]}>Try again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const profile  = summary?.profile  ?? {};
  const consent  = summary?.consent  ?? {};
  const activity = summary?.activity ?? { total_questions: 0, fir_sessions: 0, saved_answers: 0 };
  const retention = summary?.retention_policy ?? {};

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={theme.colors.brand} />
        </Pressable>
        <Text style={styles.headerTitle}>My Data</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Profile ── */}
        <SectionCard title="Your Profile" icon="person-outline">
          <DataRow label="Name"       value={profile.name    || '—'} />
          <DataRow label="Email"      value={profile.email   || '—'} />
          <DataRow label="Phone"      value={profile.phone ? profile.phone.replace(/\d(?=\d{4})/g, '•') : '—'} />
          <DataRow label="Language"   value={profile.language?.toUpperCase() || 'EN'} />
          <DataRow label="Joined"     value={profile.created_at ? new Date(profile.created_at).toLocaleDateString('en-IN') : '—'} />
          <DataRow label="Plan"       value={profile.is_pro ? '⭐ Pro' : 'Basic (free)'} last />
        </SectionCard>

        {/* ── Consent ── */}
        <SectionCard title="Your Consent Record" icon="shield-checkmark-outline">
          <DataRow label="T&C Version"  value={`v${consent.version || '1.0'}`} />
          <DataRow label="Accepted on"  value={consent.accepted_at ? new Date(consent.accepted_at).toLocaleDateString('en-IN') : '—'} />
          <DataRow label="Analytics"    value={consent.purposes?.analytics ? 'Yes' : 'No'} />
          <DataRow label="Updates"      value={consent.purposes?.updates   ? 'Yes' : 'No'} />
          <DataRow label="Retained"     value="Indefinitely (legal proof)"  last />
        </SectionCard>

        {/* ── Activity ── */}
        <SectionCard title="Your Activity" icon="bar-chart-outline">
          <DataRow label="Questions asked" value={String(activity.total_questions)} />
          <DataRow label="FIR sessions"    value={String(activity.fir_sessions)}    />
          <DataRow label="Saved answers"   value={String(activity.saved_answers)}   last />
        </SectionCard>

        {/* ── Grievances ── */}
        {summary?.grievances && summary.grievances.length > 0 && (
          <SectionCard title="Privacy Concern Tickets" icon="flag-outline">
            {summary.grievances.map((t, i) => (
              <DataRow
                key={t.ticket_id}
                label={t.ticket_id}
                value={`${t.category.replace(/_/g, ' ')} · ${t.status}`}
                last={i === summary.grievances.length - 1}
              />
            ))}
          </SectionCard>
        )}

        {/* ── Data Region ── */}
        <SectionCard title="Data Region" icon="globe-outline">
          <DataRow label="Stored in"   value={summary?.data_region || 'India'} last />
        </SectionCard>

        {/* ── Retention ── */}
        <SectionCard title="How Long We Keep Your Data" icon="time-outline">
          {Object.entries(retention).map(([key, val], i, arr) => (
            <DataRow
              key={key}
              label={key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
              value={val as string}
              last={i === arr.length - 1}
            />
          ))}
        </SectionCard>

        {/* ── Actions ── */}
        <View style={styles.actionsSection}>
          <Pressable
            style={({ pressed }) => [styles.exportBtn, pressed && { opacity: 0.75 }]}
            onPress={handleExport}
            disabled={exporting}
          >
            {exporting
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="download-outline" size={20} color="#fff" />
            }
            <Text style={styles.exportBtnText}>
              {exporting ? 'Preparing export…' : 'Export my data (JSON)'}
            </Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.deleteLink, pressed && { opacity: 0.7 }]}
            onPress={() => router.push('/settings' as any)}
          >
            <Ionicons name="trash-outline" size={16} color={theme.colors.error} />
            <Text style={styles.deleteLinkText}>Delete my account</Text>
          </Pressable>
        </View>

        <Text style={styles.legalNote}>
          Under the Digital Personal Data Protection Act, 2023 (India) and PIPEDA (Canada),
          you have the right to access, correct, and request deletion of your personal data.
          {!isGrievanceContactPlaceholder() && ` For queries: ${grievanceOfficerName}, ${grievanceContactEmail}`}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Helper components ──────────────────────────────────────────────────────────

function SectionCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Ionicons name={icon as any} size={16} color={theme.colors.brand} />
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function DataRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View style={[styles.dataRow, last && { borderBottomWidth: 0 }]}>
      <Text style={styles.dataLabel}>{label}</Text>
      <Text style={styles.dataValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: theme.colors.onSurfaceSecondary,
    fontSize: 14,
  },
  // Header
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
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: theme.colors.onSurface,
  },
  // Scroll
  scroll: { flex: 1 },
  scrollContent: {
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
    paddingBottom: 40,
  },
  // Card
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
    backgroundColor: 'rgba(30, 58, 138, 0.04)',
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.colors.brand,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  // Data row
  dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
    gap: 8,
  },
  dataLabel: {
    fontSize: 13,
    color: theme.colors.onSurfaceSecondary,
    flex: 1,
  },
  dataValue: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.onSurface,
    flex: 1.5,
    textAlign: 'right',
  },
  // Actions
  actionsSection: {
    gap: theme.spacing.md,
    marginTop: theme.spacing.sm,
  },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: theme.colors.brand,
    borderRadius: theme.radius.lg,
    paddingVertical: 14,
    paddingHorizontal: theme.spacing.xl,
  },
  exportBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  deleteLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  deleteLinkText: {
    color: theme.colors.error,
    fontSize: 14,
    fontWeight: '600',
  },
  // Legal note
  legalNote: {
    fontSize: 11,
    color: theme.colors.onSurfaceTertiary,
    lineHeight: 17,
    textAlign: 'center',
    paddingHorizontal: theme.spacing.md,
    marginTop: theme.spacing.sm,
  },
});
