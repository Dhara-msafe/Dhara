import { useState } from 'react';
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
 * DHARA Pro — UPI submissions review (operator tool, Phase 1).
 *
 * Not linked anywhere inside the app. Reached only by a direct link known
 * to the operator. Uses the SAME existing X-Admin-Key admin mechanism as
 * every other admin endpoint in this backend (dependencies.check_admin_key)
 * — no new auth was introduced for this page. The key is kept only in this
 * page's memory for the current session; it is never persisted.
 */

type Submission = {
  id: string;
  email: string;
  user_id: string;
  utr: string;
  note: string | null;
  status: 'pending' | 'confirmed' | 'rejected';
  created_at: string;
  reviewed_at: string | null;
};

export default function AdminUpiReview() {
  const [adminKey, setAdminKey] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/billing/upi/submissions`, {
        headers: { 'X-Admin-Key': adminKey },
      });
      if (res.status === 401) { setError('Invalid admin key.'); setUnlocked(false); return; }
      if (!res.ok) { setError('Could not load submissions.'); return; }
      const data = await res.json();
      setSubmissions(data.submissions || []);
      setUnlocked(true);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const act = async (id: string, action: 'confirm' | 'reject') => {
    setActingOn(id);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/billing/upi/submissions/${id}/${action}`, {
        method: 'POST',
        headers: { 'X-Admin-Key': adminKey },
      });
      if (!res.ok) { setError(`Could not ${action} this submission.`); return; }
      setSubmissions((prev) => prev.map((s) => (s.id === id ? { ...s, status: action === 'confirm' ? 'confirmed' : 'rejected' } : s)));
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
    <SafeAreaView style={styles.safe} testID="admin-upi-review-screen">
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>UPI payment submissions</Text>

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
            />
            {error && <Text style={styles.error}>{error}</Text>}
            <Pressable
              testID="admin-load-button"
              style={[styles.btn, loading && { opacity: 0.6 }]}
              disabled={loading || !adminKey.trim()}
              onPress={load}
            >
              {loading ? <ActivityIndicator color={theme.colors.onBrandPrimary} /> : <Text style={styles.btnText}>Load submissions</Text>}
            </Pressable>
          </View>
        )}

        {unlocked && (
          <>
            <View style={styles.toolbar}>
              <Pressable testID="admin-refresh-button" style={styles.refreshBtn} onPress={load} disabled={loading}>
                <Ionicons name="refresh" size={16} color={theme.colors.brand} />
                <Text style={styles.refreshText}>Refresh</Text>
              </Pressable>
            </View>

            {error && <Text style={styles.error}>{error}</Text>}

            {submissions.length === 0 ? (
              <Text style={styles.sub}>No submissions yet.</Text>
            ) : (
              submissions.map((s) => (
                <View key={s.id} style={styles.row} testID={`submission-${s.id}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowEmail}>{s.email}</Text>
                    <Text style={styles.rowUtr}>UTR: {s.utr}</Text>
                    {!!s.note && <Text style={styles.rowNote}>{s.note}</Text>}
                    <Text style={styles.rowDate}>{new Date(s.created_at).toLocaleString()}</Text>
                  </View>
                  {s.status === 'pending' ? (
                    actingOn === s.id ? (
                      <ActivityIndicator color={theme.colors.brand} />
                    ) : (
                      <View style={styles.actions}>
                        <Pressable testID={`confirm-${s.id}`} style={styles.confirmBtn} onPress={() => act(s.id, 'confirm')}>
                          <Text style={styles.confirmText}>Confirm</Text>
                        </Pressable>
                        <Pressable testID={`reject-${s.id}`} style={styles.rejectBtn} onPress={() => act(s.id, 'reject')}>
                          <Text style={styles.rejectText}>Reject</Text>
                        </Pressable>
                      </View>
                    )
                  ) : (
                    <View style={[styles.badge, s.status === 'confirmed' ? styles.badgeConfirmed : styles.badgeRejected]}>
                      <Text style={styles.badgeText}>{s.status}</Text>
                    </View>
                  )}
                </View>
              ))
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
  toolbar: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: theme.spacing.md },
  refreshBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: theme.spacing.sm },
  refreshText: { color: theme.colors.brand, fontWeight: '600' },
  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.md,
    backgroundColor: theme.colors.surface, borderRadius: theme.radius.md,
    padding: theme.spacing.lg, marginBottom: theme.spacing.md,
  },
  rowEmail: { fontWeight: '700', color: theme.colors.onSurface, fontSize: 14 },
  rowUtr: { color: theme.colors.onSurfaceSecondary, fontSize: 13, marginTop: 2 },
  rowNote: { color: theme.colors.onSurfaceTertiary, fontSize: 12, marginTop: 2, fontStyle: 'italic' },
  rowDate: { color: theme.colors.onSurfaceTertiary, fontSize: 11, marginTop: 4 },
  actions: { gap: 6 },
  confirmBtn: { backgroundColor: theme.colors.success, borderRadius: theme.radius.sm, paddingVertical: 8, paddingHorizontal: 12, minHeight: 36 },
  confirmText: { color: '#fff', fontWeight: '700', fontSize: 12, textAlign: 'center' },
  rejectBtn: { backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.sm, paddingVertical: 8, paddingHorizontal: 12, minHeight: 36 },
  rejectText: { color: theme.colors.error, fontWeight: '700', fontSize: 12, textAlign: 'center' },
  badge: { borderRadius: theme.radius.sm, paddingVertical: 6, paddingHorizontal: 10 },
  badgeConfirmed: { backgroundColor: theme.colors.successSoft },
  badgeRejected: { backgroundColor: theme.colors.surfaceSecondary },
  badgeText: { fontSize: 12, fontWeight: '700', color: theme.colors.onSurface, textTransform: 'capitalize' },
});
