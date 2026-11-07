import { useCallback, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE } from '@/src/auth';
import { theme } from '@/src/theme';

/**
 * DHARA — tester reports & server errors (operator tool).
 *
 * Not linked anywhere inside the app. Reached only by a direct link known to
 * the operator. Uses the SAME existing X-Admin-Key mechanism as every other
 * admin endpoint (dependencies.check_admin_key) — no new auth concept. The
 * key lives only in this page's memory for the current session.
 *
 * Reads only. The single write action is changing a report's status.
 */

type Report = {
  id: string;
  category: string;
  title: string;
  description: string;
  status: 'New' | 'In progress' | 'Resolved';
  app_version: string | null;
  build: string | null;
  platform: string | null;
  os_version: string | null;
  device_model: string | null;
  current_screen: string | null;
  created_at: string;
};

type ErrorEvent = {
  route: string;
  method: string;
  error_type: string;
  traceback: string;
  status_code: number;
  created_at: string;
};

const STATUSES: Report['status'][] = ['New', 'In progress', 'Resolved'];
const NEXT_STATUS: Record<Report['status'], Report['status']> = {
  New: 'In progress',
  'In progress': 'Resolved',
  Resolved: 'New',
};

export default function AdminIssues() {
  const [adminKey, setAdminKey] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [tab, setTab] = useState<'reports' | 'errors'>('reports');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [reports, setReports] = useState<Report[]>([]);
  const [byCategory, setByCategory] = useState<Record<string, number>>({});
  const [statusFilter, setStatusFilter] = useState<Report['status'] | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [errors, setErrors] = useState<ErrorEvent[]>([]);
  const [byRoute, setByRoute] = useState<Record<string, number>>({});
  const [routeFilter, setRouteFilter] = useState<string | null>(null);

  const load = useCallback(
    async (
      which: 'reports' | 'errors',
      key: string,
      filters: { status?: string | null; category?: string | null; route?: string | null } = {},
    ) => {
      setError(null);
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (which === 'reports') {
          if (filters.status) params.set('status', filters.status);
          if (filters.category) params.set('category', filters.category);
        } else if (filters.route) {
          params.set('route', filters.route);
        }
        const path = which === 'reports' ? '/api/issues' : '/api/admin/error-events';
        const qs = params.toString();
        const res = await fetch(`${API_BASE}${path}${qs ? `?${qs}` : ''}`, {
          headers: { 'X-Admin-Key': key },
        });
        if (res.status === 401) {
          setError('Invalid admin key.');
          setUnlocked(false);
          return;
        }
        if (res.status === 503) {
          setError('Admin access is not configured on this server.');
          return;
        }
        if (!res.ok) {
          setError('Could not load. Please try again.');
          return;
        }
        const data = await res.json();
        if (which === 'reports') {
          setReports(data.items || []);
          setByCategory(data.by_category || {});
        } else {
          setErrors(data.items || []);
          setByRoute(data.by_route || {});
        }
        setUnlocked(true);
      } catch {
        setError('Network error. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const switchTab = (next: 'reports' | 'errors') => {
    setTab(next);
    load(next, adminKey, next === 'reports' ? { status: statusFilter, category: categoryFilter } : { route: routeFilter });
  };

  const applyReportFilter = (status: Report['status'] | null, category: string | null) => {
    setStatusFilter(status);
    setCategoryFilter(category);
    load('reports', adminKey, { status, category });
  };

  const applyRouteFilter = (route: string | null) => {
    setRouteFilter(route);
    load('errors', adminKey, { route });
  };

  const advanceStatus = async (report: Report) => {
    const next = NEXT_STATUS[report.status];
    setActingOn(report.id);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/issues/${report.id}`, {
        method: 'PATCH',
        headers: { 'X-Admin-Key': adminKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        setError('Could not change the status.');
        return;
      }
      setReports((prev) => prev.map((r) => (r.id === report.id ? { ...r, status: next } : r)));
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setActingOn(null);
    }
  };

  if (Platform.OS !== 'web') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centerPad}>
          <Text style={styles.heading}>Open this in a browser</Text>
          <Text style={styles.sub}>This operator tool is only available on the web.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} testID="admin-issues-screen">
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Tester reports & server errors</Text>

        {!unlocked && (
          <View style={styles.card}>
            <Text style={styles.label}>Admin key</Text>
            <TextInput
              testID="admin-key-input"
              style={styles.input}
              value={adminKey}
              onChangeText={setAdminKey}
              placeholder="Enter the admin key"
              placeholderTextColor={theme.colors.onSurfaceTertiary}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={() => load(tab, adminKey)}
            />
            {error && <Text style={styles.error}>{error}</Text>}
            <Pressable
              testID="admin-load-button"
              style={[styles.btn, loading && { opacity: 0.6 }]}
              disabled={loading || !adminKey.trim()}
              onPress={() => load(tab, adminKey)}
            >
              {loading ? (
                <ActivityIndicator color={theme.colors.onBrandPrimary} />
              ) : (
                <Text style={styles.btnText}>Unlock</Text>
              )}
            </Pressable>
          </View>
        )}

        {unlocked && (
          <>
            <View style={styles.tabs}>
              <Pressable
                testID="tab-reports"
                style={[styles.tab, tab === 'reports' && styles.tabActive]}
                onPress={() => switchTab('reports')}
              >
                <Text style={[styles.tabText, tab === 'reports' && styles.tabTextActive]}>
                  Reports ({reports.length})
                </Text>
              </Pressable>
              <Pressable
                testID="tab-errors"
                style={[styles.tab, tab === 'errors' && styles.tabActive]}
                onPress={() => switchTab('errors')}
              >
                <Text style={[styles.tabText, tab === 'errors' && styles.tabTextActive]}>
                  Server errors ({errors.length})
                </Text>
              </Pressable>
              <View style={{ flex: 1 }} />
              <Pressable
                testID="admin-refresh-button"
                style={styles.refreshBtn}
                disabled={loading}
                onPress={() =>
                  load(tab, adminKey, tab === 'reports'
                    ? { status: statusFilter, category: categoryFilter }
                    : { route: routeFilter })
                }
              >
                <Ionicons name="refresh" size={16} color={theme.colors.brand} />
                <Text style={styles.refreshText}>Refresh</Text>
              </Pressable>
            </View>

            {error && <Text style={styles.error}>{error}</Text>}
            {loading && <ActivityIndicator color={theme.colors.brand} style={{ marginVertical: 12 }} />}

            {tab === 'reports' ? (
              <>
                <View style={styles.chipRow}>
                  <Pressable
                    style={[styles.chip, !statusFilter && styles.chipActive]}
                    onPress={() => applyReportFilter(null, categoryFilter)}
                  >
                    <Text style={[styles.chipText, !statusFilter && styles.chipTextActive]}>All</Text>
                  </Pressable>
                  {STATUSES.map((s) => (
                    <Pressable
                      key={s}
                      testID={`filter-${s}`}
                      style={[styles.chip, statusFilter === s && styles.chipActive]}
                      onPress={() => applyReportFilter(s, categoryFilter)}
                    >
                      <Text style={[styles.chipText, statusFilter === s && styles.chipTextActive]}>{s}</Text>
                    </Pressable>
                  ))}
                </View>

                {Object.keys(byCategory).length > 0 && (
                  <View style={styles.chipRow}>
                    {categoryFilter && (
                      <Pressable style={[styles.chip, styles.chipActive]} onPress={() => applyReportFilter(statusFilter, null)}>
                        <Text style={[styles.chipText, styles.chipTextActive]}>Clear category ✕</Text>
                      </Pressable>
                    )}
                    {Object.entries(byCategory).map(([cat, n]) => (
                      <Pressable
                        key={cat}
                        style={[styles.chip, categoryFilter === cat && styles.chipActive]}
                        onPress={() => applyReportFilter(statusFilter, cat)}
                      >
                        <Text style={[styles.chipText, categoryFilter === cat && styles.chipTextActive]}>
                          {cat} · {n}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}

                {reports.length === 0 && !loading ? (
                  <Text style={styles.sub}>No reports yet.</Text>
                ) : (
                  reports.map((r) => (
                    <Pressable
                      key={r.id}
                      testID={`report-${r.id}`}
                      style={styles.row}
                      onPress={() => setExpanded(expanded === r.id ? null : r.id)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowTitle}>{r.title}</Text>
                        <Text style={styles.rowMeta}>{r.category}</Text>
                        <Text
                          style={styles.rowBody}
                          numberOfLines={expanded === r.id ? undefined : 2}
                        >
                          {r.description}
                        </Text>
                        <Text style={styles.rowDate}>
                          {new Date(r.created_at).toLocaleString()}
                          {r.platform ? ` · ${r.platform}` : ''}
                          {r.os_version ? ` ${r.os_version}` : ''}
                          {r.device_model ? ` · ${r.device_model}` : ''}
                          {r.app_version ? ` · v${r.app_version}` : ''}
                          {r.current_screen ? ` · ${r.current_screen}` : ''}
                        </Text>
                      </View>
                      {actingOn === r.id ? (
                        <ActivityIndicator color={theme.colors.brand} />
                      ) : (
                        <Pressable
                          testID={`status-${r.id}`}
                          style={[
                            styles.statusBtn,
                            r.status === 'Resolved' && styles.statusResolved,
                            r.status === 'In progress' && styles.statusProgress,
                          ]}
                          onPress={() => advanceStatus(r)}
                        >
                          <Text style={styles.statusText}>{r.status}</Text>
                        </Pressable>
                      )}
                    </Pressable>
                  ))
                )}
              </>
            ) : (
              <>
                <Text style={styles.note}>
                  Route, method, error type and traceback only. No request bodies, tokens,
                  locations or message contents are ever stored.
                </Text>
                {Object.keys(byRoute).length > 0 && (
                  <View style={styles.chipRow}>
                    <Pressable style={[styles.chip, !routeFilter && styles.chipActive]} onPress={() => applyRouteFilter(null)}>
                      <Text style={[styles.chipText, !routeFilter && styles.chipTextActive]}>All routes</Text>
                    </Pressable>
                    {Object.entries(byRoute).map(([route, n]) => (
                      <Pressable
                        key={route}
                        style={[styles.chip, routeFilter === route && styles.chipActive]}
                        onPress={() => applyRouteFilter(route)}
                      >
                        <Text style={[styles.chipText, routeFilter === route && styles.chipTextActive]}>
                          {route} · {n}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}

                {errors.length === 0 && !loading ? (
                  <Text style={styles.sub}>No server errors recorded. </Text>
                ) : (
                  errors.map((e, i) => (
                    <Pressable
                      key={`${e.created_at}-${i}`}
                      testID={`error-${i}`}
                      style={styles.row}
                      onPress={() => setExpanded(expanded === `err-${i}` ? null : `err-${i}`)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowTitle}>
                          {e.error_type} · {e.method} {e.route}
                        </Text>
                        <Text style={styles.rowDate}>{new Date(e.created_at).toLocaleString()}</Text>
                        <Text
                          style={styles.trace}
                          numberOfLines={expanded === `err-${i}` ? undefined : 3}
                        >
                          {e.traceback}
                        </Text>
                      </View>
                    </Pressable>
                  ))
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  scroll: { padding: theme.spacing.xl, paddingTop: theme.spacing.xxl, flexGrow: 1 },
  centerPad: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xl },
  title: { fontFamily: theme.fonts.display, fontSize: 22, color: theme.colors.onSurface, fontWeight: '700', marginBottom: theme.spacing.lg },
  heading: { fontSize: 18, fontWeight: '700', color: theme.colors.onSurface },
  sub: { color: theme.colors.onSurfaceSecondary, marginTop: 6 },
  note: { color: theme.colors.onSurfaceTertiary, fontSize: 12, marginBottom: theme.spacing.md },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, padding: theme.spacing.xl },
  label: { color: theme.colors.onSurfaceSecondary, marginBottom: theme.spacing.sm, fontWeight: '600' },
  input: {
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md,
    padding: theme.spacing.md, fontSize: 16, color: theme.colors.onSurface,
    backgroundColor: theme.colors.surfaceSecondary, minHeight: 48,
  },
  error: { color: theme.colors.error, marginTop: theme.spacing.md, fontSize: 13 },
  btn: {
    backgroundColor: theme.colors.brand, padding: theme.spacing.lg, borderRadius: theme.radius.md,
    alignItems: 'center', marginTop: theme.spacing.lg, minHeight: 48,
  },
  btnText: { color: theme.colors.onBrandPrimary, fontWeight: '700', fontSize: 15 },
  tabs: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, marginBottom: theme.spacing.md },
  tab: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceSecondary, minHeight: 44, justifyContent: 'center' },
  tabActive: { backgroundColor: theme.colors.brand },
  tabText: { color: theme.colors.onSurfaceSecondary, fontWeight: '700', fontSize: 13 },
  tabTextActive: { color: theme.colors.onBrandPrimary },
  refreshBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: theme.spacing.sm, minHeight: 44 },
  refreshText: { color: theme.colors.brand, fontWeight: '600' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, marginBottom: theme.spacing.md },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: theme.radius.sm, backgroundColor: theme.colors.surfaceSecondary, minHeight: 36, justifyContent: 'center' },
  chipActive: { backgroundColor: theme.colors.brand },
  chipText: { fontSize: 12, fontWeight: '600', color: theme.colors.onSurfaceSecondary },
  chipTextActive: { color: theme.colors.onBrandPrimary },
  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.md,
    backgroundColor: theme.colors.surface, borderRadius: theme.radius.md,
    padding: theme.spacing.lg, marginBottom: theme.spacing.md,
  },
  rowTitle: { fontWeight: '700', color: theme.colors.onSurface, fontSize: 14 },
  rowMeta: { color: theme.colors.brand, fontSize: 12, marginTop: 2, fontWeight: '600' },
  rowBody: { color: theme.colors.onSurfaceSecondary, fontSize: 13, marginTop: 4 },
  rowDate: { color: theme.colors.onSurfaceTertiary, fontSize: 11, marginTop: 4 },
  trace: { color: theme.colors.onSurfaceTertiary, fontSize: 11, marginTop: 6, fontFamily: Platform.OS === 'web' ? 'monospace' : undefined },
  statusBtn: { backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.sm, paddingVertical: 8, paddingHorizontal: 12, minHeight: 36, justifyContent: 'center' },
  statusProgress: { backgroundColor: theme.colors.surfaceSecondary, borderWidth: 1, borderColor: theme.colors.brand },
  statusResolved: { backgroundColor: theme.colors.successSoft },
  statusText: { fontSize: 12, fontWeight: '700', color: theme.colors.onSurface },
});
