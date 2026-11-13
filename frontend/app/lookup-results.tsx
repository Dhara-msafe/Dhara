/**
 * Dhara Lookup — native eCourts results screen.
 * Replaces the old broken WebView flow (eCourts blocks requests without a
 * valid app_token). Both CNR and party-name search now call our own backend
 * proxy (/api/cases/cnr/{cnr} and /api/cases/search) which securely holds
 * the eCourtsIndia partner API token, and render results as native cards.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, FlatList, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth, API_BASE } from '@/src/auth';
import { theme } from '@/src/theme';

const NAVY  = theme.colors.primary;
const GOLD  = theme.colors.gold;
const CREAM = '#F8F6F0';
const HINT  = '#8A8A8A';

type CaseRow = {
  cnr: string | null;
  case_status: string | null;
  next_hearing_date: string | null;
  court_name: string | null;
  district: string | null;
  state: string | null;
  case_type: string | null;
  filing_date: string | null;
  petitioners: string[];
  respondents: string[];
};

function statusColor(status: string | null): { bg: string; fg: string } {
  const s = (status || '').toUpperCase();
  if (s === 'PENDING') return { bg: '#FEF3C7', fg: '#92400E' };
  if (s === 'DISPOSED') return { bg: '#D1FAE5', fg: '#065F46' };
  if (!s) return { bg: '#F3F4F6', fg: '#6B7280' };
  return { bg: '#E0E7FF', fg: NAVY };
}

function CaseCard({ row, onPress }: { row: CaseRow; onPress?: () => void }) {
  const sc = statusColor(row.case_status);
  const title =
    row.petitioners?.length || row.respondents?.length
      ? `${(row.petitioners || []).slice(0, 2).join(', ') || 'Unknown'}  vs  ${(row.respondents || []).slice(0, 2).join(', ') || 'Unknown'}`
      : 'Case details';

  return (
    <Pressable
      style={[styles.card, !onPress && { opacity: 1 }]}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={styles.cardTopRow}>
        <Text style={styles.cardTitle} numberOfLines={2}>{title}</Text>
        {row.case_status ? (
          <View style={[styles.statusChip, { backgroundColor: sc.bg }]}>
            <Text style={[styles.statusChipText, { color: sc.fg }]}>{row.case_status}</Text>
          </View>
        ) : null}
      </View>

      {row.cnr ? (
        <View style={styles.metaRow}>
          <Ionicons name="barcode-outline" size={13} color={HINT} />
          <Text style={styles.metaText}>{row.cnr}</Text>
        </View>
      ) : null}
      {row.court_name ? (
        <View style={styles.metaRow}>
          <Ionicons name="business-outline" size={13} color={HINT} />
          <Text style={styles.metaText} numberOfLines={1}>{row.court_name}</Text>
        </View>
      ) : null}
      {(row.district || row.state) ? (
        <View style={styles.metaRow}>
          <Ionicons name="location-outline" size={13} color={HINT} />
          <Text style={styles.metaText}>{[row.district, row.state].filter(Boolean).join(', ')}</Text>
        </View>
      ) : null}
      <View style={styles.dateRow}>
        {row.filing_date ? (
          <View style={styles.dateChip}>
            <Text style={styles.dateChipLabel}>Filed</Text>
            <Text style={styles.dateChipValue}>{row.filing_date}</Text>
          </View>
        ) : null}
        {row.next_hearing_date ? (
          <View style={styles.dateChip}>
            <Text style={styles.dateChipLabel}>Next hearing</Text>
            <Text style={styles.dateChipValue}>{row.next_hearing_date}</Text>
          </View>
        ) : null}
      </View>
      {onPress ? (
        <View style={styles.viewMoreRow}>
          <Text style={styles.viewMoreText}>View full case</Text>
          <Ionicons name="chevron-forward" size={14} color={NAVY} />
        </View>
      ) : null}
    </Pressable>
  );
}

export default function LookupResults() {
  const params = useLocalSearchParams<{
    mode: 'cnr' | 'party';
    cnr?: string;
    name?: string;
    partyType?: string;
    stateName?: string;
    districtName?: string;
  }>();
  const { token, loading: authLoading, forceLogout } = useAuth();

  const mode = params.mode === 'cnr' ? 'cnr' : 'party';
  const cnrParam = params.cnr ?? '';
  const nameParam = params.name ?? '';

  const [loading, setLoading]   = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // B-88: distinguishes "nothing to retry" (no search term was ever given)
  // from a real fetch failure, so the error action can say "Go Back"
  // instead of "Try Again" — retrying an empty search would just repeat
  // the same dead end.
  const [noSearchTerm, setNoSearchTerm] = useState(false);
  const [caseDetail, setCaseDetail] = useState<CaseRow | null>(null);
  const [results, setResults]   = useState<CaseRow[]>([]);
  const [page, setPage]         = useState(1);
  const [hasMore, setHasMore]   = useState(false);

  const authHeaders = { Authorization: `Bearer ${token}` };

  const fetchCnr = useCallback(async (cnr: string) => {
    setLoading(true);
    setErrorMsg(null);
    setNoSearchTerm(false);
    try {
      const r = await fetch(`${API_BASE}/api/cases/cnr/${encodeURIComponent(cnr)}`, { headers: authHeaders });
      if (r.status === 401) { await forceLogout(); return; }
      const data = await r.json();
      if (!r.ok) {
        setErrorMsg(typeof data?.detail === 'string' ? data.detail : 'Could not find this case. Please check the CNR and try again.');
        setCaseDetail(null);
      } else {
        setCaseDetail(data);
      }
    } catch {
      setErrorMsg('Network error — please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  const fetchParty = useCallback(async (name: string, pageNum: number, append: boolean) => {
    if (append) setLoadingMore(true); else { setLoading(true); setErrorMsg(null); setNoSearchTerm(false); }
    try {
      const r = await fetch(
        `${API_BASE}/api/cases/search?name=${encodeURIComponent(name)}&page=${pageNum}`,
        { headers: authHeaders },
      );
      if (r.status === 401) { await forceLogout(); return; }
      const data = await r.json();
      if (!r.ok) {
        setErrorMsg(typeof data?.detail === 'string' ? data.detail : 'Search failed. Please try again.');
        if (!append) setResults([]);
      } else {
        const rows: CaseRow[] = data.results || [];
        setResults(prev => append ? [...prev, ...rows] : rows);
        setHasMore(rows.length >= 20);
        setPage(pageNum);
      }
    } catch {
      setErrorMsg('Network error — please check your connection and try again.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [token]);

  useEffect(() => {
    // Guard against the auth-hydration race: this screen can be opened as a
    // top-level route (e.g. a hard web refresh, or a fast cold start) before
    // AuthProvider has finished restoring the token from storage. Firing the
    // fetch too early would send "Bearer null" and wrongly look like an
    // expired session. Wait for hydration, then redirect only if truly
    // signed out — mirrors the guard in (tabs)/_layout.tsx.
    if (authLoading) return;
    if (!token) { router.replace('/login' as any); return; }
    if (mode === 'cnr' && cnrParam) fetchCnr(cnrParam);
    else if (mode === 'party' && nameParam) fetchParty(nameParam, 1, false);
    else {
      // B-88: this screen used to default `loading` to true and only ever
      // flip it to false inside fetchCnr()/fetchParty()'s `finally` block.
      // Opened directly with no search term (a direct URL hit, a refresh
      // that dropped the query params, or a stale link) meant neither
      // fetch ever ran, so `loading` stayed true and the spinner never
      // resolved. Surface an explicit empty-state/error instead.
      setLoading(false);
      setNoSearchTerm(true);
      setErrorMsg(
        mode === 'cnr'
          ? 'No CNR number was provided. Please go back and enter a CNR to search.'
          : 'No name was provided. Please go back and enter a name to search.'
      );
    }
  }, [mode, cnrParam, nameParam, authLoading, token]);

  const handleRetry = () => {
    if (noSearchTerm) { router.back(); return; }
    if (mode === 'cnr') fetchCnr(cnrParam);
    else fetchParty(nameParam, 1, false);
  };

  const handleLoadMore = () => {
    if (!loadingMore && hasMore) fetchParty(nameParam, page + 1, true);
  };

  const openCase = (cnr: string | null) => {
    if (!cnr) return;
    router.push({ pathname: '/lookup-results' as any, params: { mode: 'cnr', cnr } });
  };

  const headerSubtitle = mode === 'cnr'
    ? `CNR: ${cnrParam}`
    : `"${nameParam}"${params.stateName ? ` · ${params.stateName}` : ''}${params.districtName ? `, ${params.districtName}` : ''}`;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={10}>
          <Ionicons name="arrow-back-outline" size={22} color={GOLD} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {mode === 'cnr' ? 'Case Details' : 'Search Results'}
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>{headerSubtitle}</Text>
        </View>
      </View>

      {loading && (
        <View style={styles.center}>
          <ActivityIndicator color={NAVY} size="large" />
          <Text style={styles.loadingText}>Searching eCourts records…</Text>
        </View>
      )}

      {!loading && errorMsg && (
        <View style={styles.center} testID="lookup-results-error">
          <Ionicons name={noSearchTerm ? 'search-outline' : 'alert-circle-outline'} size={40} color={noSearchTerm ? HINT : '#DC2626'} />
          <Text style={styles.errorText}>{errorMsg}</Text>
          <Pressable style={styles.retryBtn} onPress={handleRetry} testID="lookup-results-retry">
            <Ionicons name={noSearchTerm ? 'arrow-back' : 'refresh'} size={16} color="#fff" />
            <Text style={styles.retryBtnText}>{noSearchTerm ? 'Go Back' : 'Try Again'}</Text>
          </Pressable>
        </View>
      )}

      {!loading && !errorMsg && mode === 'cnr' && caseDetail && (
        <View style={styles.contentPad}>
          <CaseCard row={caseDetail} />
          {(caseDetail.petitioners?.length || caseDetail.respondents?.length) ? (
            <View style={styles.partiesCard}>
              {caseDetail.petitioners?.length ? (
                <View style={styles.partyBlock}>
                  <Text style={styles.partyLabel}>Petitioner(s)</Text>
                  {caseDetail.petitioners.map((p, i) => (
                    <Text key={i} style={styles.partyName}>• {p}</Text>
                  ))}
                </View>
              ) : null}
              {caseDetail.respondents?.length ? (
                <View style={styles.partyBlock}>
                  <Text style={styles.partyLabel}>Respondent(s)</Text>
                  {caseDetail.respondents.map((p, i) => (
                    <Text key={i} style={styles.partyName}>• {p}</Text>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
          <Text style={styles.disclaimer}>
            Data sourced from eCourtsIndia public records. Please verify with your court before relying on this for legal action.
          </Text>
        </View>
      )}

      {!loading && !errorMsg && mode === 'party' && (
        <FlatList
          data={results}
          keyExtractor={(item, i) => `${item.cnr || 'row'}-${i}`}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => <CaseCard row={item} onPress={item.cnr ? () => openCase(item.cnr) : undefined} />}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          ListHeaderComponent={
            results.length > 0 ? (
              <View style={styles.noteCard}>
                <Ionicons name="information-circle-outline" size={16} color={NAVY} />
                <Text style={styles.noteText}>
                  Showing all-India matches for this name. Use the state/district above as a guide to identify the right case.
                </Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="document-text-outline" size={40} color={HINT} />
              <Text style={styles.emptyText}>No cases found for &ldquo;{nameParam}&rdquo;.</Text>
              <Text style={styles.emptyHint}>Try a different spelling, or search with just the first and last name.</Text>
            </View>
          }
          ListFooterComponent={
            results.length > 0 ? (
              loadingMore ? (
                <ActivityIndicator color={NAVY} style={{ marginVertical: 16 }} />
              ) : (
                <Text style={styles.disclaimer}>
                  Data sourced from eCourtsIndia public records. Please verify with your court before relying on this for legal action.
                </Text>
              )
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: CREAM },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: NAVY, paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: 'rgba(211,182,117,0.25)',
  },
  backBtn: { padding: 4 },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  headerSub: { color: GOLD, fontSize: 12, fontWeight: '500', marginTop: 2 },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 12 },
  loadingText: { color: NAVY, fontSize: 14, fontWeight: '500' },
  errorText: { color: '#374151', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: NAVY, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 10, marginTop: 4 },
  retryBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  emptyText: { color: '#374151', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  emptyHint: { color: HINT, fontSize: 13, textAlign: 'center', lineHeight: 18 },

  contentPad: { padding: 16, gap: 12, flex: 1 },
  listContent: { padding: 16, gap: 12, flexGrow: 1 },

  card: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', padding: 14, gap: 6, marginBottom: 12 },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  cardTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: NAVY, lineHeight: 19 },
  statusChip: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 6 },
  statusChipText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 12.5, color: '#4B5563', flex: 1 },

  dateRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  dateChip: { backgroundColor: '#F3F4F6', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  dateChipLabel: { fontSize: 10, color: HINT, fontWeight: '600' },
  dateChipValue: { fontSize: 12.5, color: '#1F2937', fontWeight: '700' },

  viewMoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 4 },
  viewMoreText: { fontSize: 12.5, color: NAVY, fontWeight: '700' },

  partiesCard: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', padding: 14, gap: 12 },
  partyBlock: { gap: 4 },
  partyLabel: { fontSize: 12, fontWeight: '800', color: NAVY, letterSpacing: 0.2, marginBottom: 2 },
  partyName: { fontSize: 13.5, color: '#374151', lineHeight: 19 },

  disclaimer: { fontSize: 11.5, color: HINT, lineHeight: 16, textAlign: 'center', paddingHorizontal: 8, marginTop: 4, marginBottom: 8 },
  noteCard: { flexDirection: 'row', gap: 8, backgroundColor: '#EEF2FF', borderRadius: 10, padding: 12, alignItems: 'flex-start', marginBottom: 12 },
  noteText: { flex: 1, fontSize: 12.5, color: NAVY, lineHeight: 17 },
});
