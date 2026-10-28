/**
 * IPC → BNS Cross-Reference Lookup Tool — Citation Guard edition
 *
 * Citation Guard rules (non-negotiable):
 * A. query_found_in_db === false → show NOT-IN-DATABASE wall. Never guess.
 * B. new_section is null / "—" → render "Deleted / No BNS equivalent". Never substitute.
 * C. verified === false → yellow caution banner on every card.
 * D. change_type === 'dead_law' → Dead-Law Guard banner. Never render as valid mapping.
 * E. No LLM / AI call is ever made from this screen.
 */
import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE } from '@/src/auth';
import { theme } from '@/src/theme';

const NAVY   = theme.colors.primary;
const GOLD   = theme.colors.gold;
const CUTOFF = '2024-07-01';

// ── Types ─────────────────────────────────────────────────────────────────────
interface XRef {
  source:            string;
  old_section:       string;
  new_section:       string;
  offence:           string;
  change_type:       string;
  what_changed:      string;
  verified:          boolean;
  source_link?:      string;
  judicial_citation?: string;
  dead_law?:         boolean;
  // Set by the backend approval gate when the IPC↔BNS correspondence has no
  // active approval: the other side and the offence text are blanked.
  correspondence_withheld?: boolean;
  withheld_reason?:   string | null;
}
interface CitationGuard {
  database_only:        boolean;
  query_found_in_db:    boolean;
  all_entries_verified: boolean;
  unverified_count:     number;
  total_in_db:          number;
  not_in_db_message:    string;
  withheld_count?:      number;
  withheld_message?:    string;
}

// ── Change-type display config ────────────────────────────────────────────────
const CHANGE_META: Record<string, { label: string; bg: string; color: string }> = {
  renumbering_only:                { label: 'Renumbered',      bg: '#EEF2FF', color: '#3730A3' },
  renumbering_plus_relocation:     { label: 'Relocated',       bg: '#F0FDF4', color: '#166534' },
  wording_change_same_effect:      { label: 'Minor Wording',   bg: '#FFF7ED', color: '#9A3412' },
  substantive_change:              { label: 'Substantive ⚠',   bg: '#FEF3C7', color: '#92400E' },
  deleted_replaced_by_new_offence: { label: 'Replaced',        bg: '#FEF2F2', color: '#991B1B' },
  deleted:                         { label: 'Deleted',         bg: '#FEE2E2', color: '#B91C1C' },
  new:                             { label: 'New',             bg: '#ECFDF5', color: '#065F46' },
  dead_law:                        { label: '⚠ Dead Law',      bg: '#1F2937', color: '#FCA5A5' },
  withheld:                        { label: 'Not yet approved', bg: '#F3F4F6', color: '#374151' },
};
function changeMeta(ct: string) {
  return CHANGE_META[ct] ?? { label: ct.replace(/_/g, ' '), bg: '#F3F4F6', color: '#374151' };
}

/** Guard B: returns true only when the new_section value is meaningful. */
function hasBnsEquivalent(ns: string | null | undefined): boolean {
  if (!ns) return false;
  const s = ns.trim();
  return s !== '' && s !== '—' && s.toLowerCase() !== 'null' && s.toLowerCase() !== 'none';
}

// ── Date helper ───────────────────────────────────────────────────────────────
function isValidCalendarDate(y: number, mo: number, da: number): boolean {
  if (mo < 1 || mo > 12 || da < 1) return false;
  const daysInMonth = new Date(y, mo, 0).getDate(); // day 0 of next month = last day of this month
  return da <= daysInMonth;
}

function CodeAppliesHelper() {
  const [date, setDate]     = useState('');
  const [result, setResult] = useState<{ label: string; color: string; detail: string } | null>(null);

  const check = () => {
    const d = date.trim();
    const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) {
      setResult({ label: 'Invalid date', color: '#B91C1C', detail: 'Use YYYY-MM-DD format (e.g. 2024-06-28)' });
      return;
    }
    // DHARA-B016: the old check only verified the string SHAPE (4-2-2
    // digits), so an impossible date like 2024-02-31 passed straight
    // through to a legal classification. Validate it's a real calendar
    // date first.
    const y = parseInt(m[1], 10), mo = parseInt(m[2], 10), da = parseInt(m[3], 10);
    if (!isValidCalendarDate(y, mo, da)) {
      setResult({ label: 'Invalid date', color: '#B91C1C', detail: `${d} is not a real calendar date — please check the day and month.` });
      return;
    }
    // DHARA-B016: both branches now say "procedure uses BNSS" consistently
    // instead of the heading implying old CrPC procedure while the detail
    // said BNSS — and both carry the same transition-law caveat.
    const caveat = 'General transition guidance only — the exact effect on an investigation or trial already underway depends on the applicable savings clause (BNSS Section 531). Confirm the FIR/charge-sheet date with a legal professional.';
    if (d < CUTOFF) {
      setResult({
        label: 'IPC / Indian Evidence Act apply (substantive) — BNSS governs procedure',
        color: theme.colors.primary,
        detail: `Offence date ${d} is BEFORE ${CUTOFF}.\nSubstantive charge: use IPC sections.\nProcedure: use BNSS (bail, remand, FIR) for any step taken on or after ${CUTOFF}.\n\n${caveat}`,
      });
    } else {
      setResult({
        label: 'BNS / BSA apply (substantive) — BNSS governs procedure',
        color: '#065F46',
        detail: `Offence date ${d} is ON/AFTER ${CUTOFF}.\nSubstantive charge: use BNS sections.\nProcedure: use BNSS throughout.\n\n${caveat}`,
      });
    }
  };

  return (
    <View style={h.card}>
      <View style={h.headRow}>
        <Ionicons name="calendar-outline" size={18} color={NAVY} />
        <Text style={h.title}>Which Code Applies?</Text>
      </View>
      <Text style={h.sub}>Enter the date the alleged offence was committed</Text>
      <View style={h.row}>
        <TextInput
          style={h.input}
          placeholder="YYYY-MM-DD  e.g. 2024-06-28"
          placeholderTextColor="#9CA3AF"
          value={date}
          onChangeText={t => { setDate(t); setResult(null); }}
          keyboardType="numeric"
          maxLength={10}
          returnKeyType="done"
          onSubmitEditing={check}
        />
        <Pressable style={h.checkBtn} onPress={check}>
          <Text style={h.checkBtnText}>Check</Text>
        </Pressable>
      </View>
      {result && (
        <View style={[h.resultBox, { borderLeftColor: result.color }]}>
          <Text style={[h.resultLabel, { color: result.color }]}>{result.label}</Text>
          <Text style={h.resultDetail}>{result.detail}</Text>
        </View>
      )}
      <Text style={h.cutoffNote}>
        Transition date: <Text style={{ fontWeight: '700' }}>1 July 2024</Text>
        {' '}— BNS/BNSS/BSA in force from this date.
      </Text>
    </View>
  );
}

// ── Guard D: Dead-Law banner ───────────────────────────────────────────────────
function DeadLawBanner({ item }: { item: XRef }) {
  return (
    <View style={dl.card}>
      <View style={dl.headerRow}>
        <View style={dl.iconWrap}>
          <Ionicons name="close-circle" size={28} color="#FCA5A5" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={dl.title}>⚠ Dead Law — Never Cite</Text>
          <Text style={dl.section}>IPC {item.old_section}</Text>
        </View>
      </View>
      <Text style={dl.offence}>{item.offence}</Text>
      <View style={dl.reasonBox}>
        <Text style={dl.reasonText}>{item.what_changed}</Text>
      </View>
      {!!item.judicial_citation && (
        <View style={dl.citationRow}>
          <Ionicons name="library-outline" size={13} color="#F87171" />
          <Text style={dl.citationText}>{item.judicial_citation}</Text>
        </View>
      )}
      <View style={dl.warningBox}>
        <Ionicons name="warning-outline" size={14} color="#FBBF24" />
        <Text style={dl.warningText}>
          This provision is void and unenforceable. It must never be cited in a pleading,
          FIR, or legal document as a valid subsisting law.
        </Text>
      </View>
    </View>
  );
}

// ── Guard A: Not-in-database wall ─────────────────────────────────────────────
function NotInDatabaseWall({ sectionQuery, totalInDb }: { sectionQuery: string; totalInDb: number }) {
  return (
    <View style={w.wall}>
      <View style={w.iconWrap}>
        <Ionicons name="shield-checkmark-outline" size={32} color="#B91C1C" />
      </View>
      <Text style={w.title}>No Mapping Found for &ldquo;{sectionQuery}&rdquo;</Text>
      <View style={w.secPill}>
        <Text style={w.secPillTxt}>{sectionQuery}</Text>
      </View>
      <Text style={w.body}>
        This section is not in our cross-reference database.{'\n'}
        The database currently covers <Text style={{ fontWeight: '700' }}>{totalInDb} entries</Text> and is still expanding.
      </Text>
      <View style={w.actionBox}>
        <Ionicons name="book-outline" size={16} color={NAVY} />
        <Text style={w.actionText}>
          Cross-check against the bare Act at{' '}
          <Text style={{ fontWeight: '700' }}>indiacode.nic.in</Text>
          {' '}or the Bharatiya Nyaya Sanhita 2023 gazette before filing.
        </Text>
      </View>
      <Text style={w.note}>
        This tool never guesses or infers a BNS equivalent. Only entries
        present in the cross-reference database are shown.
      </Text>
    </View>
  );
}

// ── Guard C: Unverified caution banner ────────────────────────────────────────
function UnverifiedBanner() {
  return (
    <View style={v.banner}>
      <Ionicons name="warning-outline" size={14} color="#92400E" />
      <Text style={v.bannerTxt}>
        Pending advocate verification — treat as indicative only.
        Do not cite without manual cross-check.
      </Text>
    </View>
  );
}

// ── Withheld card: correspondence not approved ────────────────────────────────
// A blank new_section here means "not approved", NOT "deleted" — never route a
// withheld row through Guard B / the dead-law banner.
const WITHHELD_FALLBACK_MSG =
  'Section mapping not yet confirmed in our database. Please consult a manual or the bare Act directly.';

function WithheldCard({ item, message }: { item: XRef; message?: string }) {
  const searched = item.old_section || item.new_section || '—';
  return (
    <View style={rc.card}>
      <View style={rc.sourceRow}>
        <View style={[rc.srcBadge, { backgroundColor: '#F3F4F6' }]}>
          <Text style={[rc.srcTxt, { color: '#374151' }]}>{item.source}</Text>
        </View>
        <View style={[rc.chgBadge, { backgroundColor: '#F3F4F6' }]}>
          <Text style={[rc.chgTxt, { color: '#374151' }]}>Not yet approved</Text>
        </View>
      </View>
      <View style={rc.secRow}>
        <View style={rc.secBox}>
          <Text style={rc.secLabel}>Section</Text>
          <Text style={rc.secNum}>{searched}</Text>
        </View>
        <View style={rc.secBox}>
          <Text style={rc.secLabel}>Mapping</Text>
          <Text style={[rc.secNum, { color: '#374151', fontSize: 13, lineHeight: 18 }]}>
            Not yet{'\n'}approved
          </Text>
        </View>
      </View>
      <Text style={rc.offence}>{message || WITHHELD_FALLBACK_MSG}</Text>
    </View>
  );
}

// ── Result card ───────────────────────────────────────────────────────────────
function ResultCard({ item, withheldMessage }: { item: XRef; withheldMessage?: string }) {
  // Hook must be called unconditionally (Rules of Hooks)
  const [expanded, setExpanded] = useState(false);

  // Approval gate: withheld correspondence → neutral card, never "Deleted" or dead-law
  if (item.correspondence_withheld) {
    return <WithheldCard item={item} message={withheldMessage} />;
  }

  // Guard D: dead-law → dedicated banner, never a normal card
  if (item.change_type === 'dead_law' || item.dead_law) {
    return <DeadLawBanner item={item} />;
  }
  const meta      = changeMeta(item.change_type);
  const hasNewSec = hasBnsEquivalent(item.new_section); // Guard B

  return (
    <Pressable style={rc.card} onPress={() => setExpanded(e => !e)}>
      {/* Guard C: unverified banner */}
      {!item.verified && <UnverifiedBanner />}

      {/* Source + change-type badges */}
      <View style={rc.sourceRow}>
        <View style={[rc.srcBadge, {
          backgroundColor: item.source.includes('CrPC')     ? '#EFF6FF'
                         : item.source.includes('Evidence') ? '#F5F3FF' : '#F0FDF4',
        }]}>
          <Text style={[rc.srcTxt, {
            color: item.source.includes('CrPC')     ? theme.colors.primary
                 : item.source.includes('Evidence') ? '#6D28D9' : '#166534',
          }]}>{item.source}</Text>
        </View>
        <View style={[rc.chgBadge, { backgroundColor: meta.bg }]}>
          <Text style={[rc.chgTxt, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>

      {/* Section numbers — Guard B */}
      <View style={rc.secRow}>
        <View style={rc.secBox}>
          <Text style={rc.secLabel}>Old Section</Text>
          <Text style={rc.secNum}>{item.old_section || '—'}</Text>
        </View>
        <Ionicons
          name="arrow-forward" size={18}
          color={hasNewSec ? NAVY : '#B91C1C'}
          style={{ marginTop: 14 }}
        />
        <View style={[rc.secBox, !hasNewSec && rc.secBoxDeleted]}>
          <Text style={rc.secLabel}>{hasNewSec ? 'New Section' : 'Status'}</Text>
          {hasNewSec
            ? <Text style={rc.secNum}>{item.new_section}</Text>
            : <Text style={[rc.secNum, { color: '#B91C1C', fontSize: 13, lineHeight: 18 }]}>
                Deleted{'\n'}No BNS equiv.
              </Text>
          }
        </View>
      </View>

      {/* Offence */}
      <Text style={rc.offence} numberOfLines={expanded ? undefined : 2}>
        {item.offence}
      </Text>

      {/* Explanation */}
      {expanded && item.what_changed ? (
        <View style={rc.explainBox}>
          <Text style={rc.explainTxt}>{item.what_changed}</Text>
        </View>
      ) : (
        <View style={rc.expandHint}>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color="#9CA3AF" />
          <Text style={rc.expandHintTxt}>{expanded ? 'Collapse' : 'Tap for explanation'}</Text>
        </View>
      )}

      {/* Source link */}
      {expanded && !!item.source_link && (
        <Pressable
          style={rc.srcLinkRow}
          onPress={() => Linking.openURL(item.source_link!)}
          hitSlop={6}
        >
          <Ionicons name="open-outline" size={12} color={theme.colors.primary} />
          <Text style={rc.srcLinkTxt}>View on India Code</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

// ── Citation Guard status bar ─────────────────────────────────────────────────
function GuardStatusBar({ guard, total }: { guard: CitationGuard; total: number }) {
  return (
    <View style={gb.bar}>
      <View style={gb.left}>
        <Ionicons name="shield-checkmark-outline" size={14} color="#166534" />
        <Text style={gb.label}>Citation Guard</Text>
        <View style={gb.dbPill}><Text style={gb.dbTxt}>DB only</Text></View>
      </View>
      <Text style={gb.right}>
        {total} result{total !== 1 ? 's' : ''}{' · '}
        {guard.unverified_count > 0
          ? `${guard.unverified_count} pending review`
          : 'all reviewed'}
      </Text>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function IpcBnsLookup() {
  const router = useRouter();
  const [query, setQuery]         = useState('');
  const [mode, setMode]           = useState<'keyword' | 'ipc' | 'bns'>('keyword');
  const [results, setResults]     = useState<XRef[]>([]);
  const [guard, setGuard]         = useState<CitationGuard | null>(null);
  const [loading, setLoading]     = useState(false);
  const [searched, setSearched]   = useState(false);
  const [lastQuery, setLastQuery] = useState('');
  const [error, setError]         = useState('');

  // A3 fix — always read latest query value, not the stale closure
  const queryRef = useRef('');
  const modeRef  = useRef<'keyword' | 'ipc' | 'bns'>('keyword');
  const abortRef = useRef<AbortController | null>(null);

  const search = useCallback(async () => {
    const q = queryRef.current.trim();
    const m = modeRef.current;
    if (!q) return;

    // Cancel any in-flight request
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true); setError(''); setResults([]);
    setGuard(null);   setSearched(false); setLastQuery(q);
    try {
      const params = m === 'ipc' ? `ipc=${encodeURIComponent(q)}`
                   : m === 'bns' ? `bns=${encodeURIComponent(q)}`
                   : `q=${encodeURIComponent(q)}`;
      const res  = await fetch(`${API_BASE}/api/advocate/cross-reference?${params}`,
                               { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResults(data.results ?? []);
      setGuard(data.citation_guard ?? null);
      setSearched(true);
    } catch (err: any) {
      if (err?.name === 'AbortError') return; // superseded by newer query
      setError('Search failed. Check your connection and try again.');
      setSearched(true);
    } finally {
      setLoading(false);
    }
  }, []); // deps intentionally empty — reads from refs

  const tabs: { key: typeof mode; label: string; icon: string }[] = [
    { key: 'keyword', label: 'Keyword',    icon: 'search-outline' },
    { key: 'ipc',     label: 'IPC / CrPC', icon: 'code-slash-outline' },
    { key: 'bns',     label: 'BNS / BNSS', icon: 'shield-outline' },
  ];

  const isSectionSearch = mode === 'ipc' || mode === 'bns';
  // Guard A: section search with zero results
  const showWall    = searched && !loading && isSectionSearch && guard?.query_found_in_db === false;
  // A3: explicit no-results for BOTH keyword and section mode
  const showNoMatch = searched && !loading && !showWall && results.length === 0;
  const showResults = searched && !loading && results.length > 0;
  const totalInDb   = guard?.total_in_db ?? 655;

  return (
    <SafeAreaView style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>IPC → BNS Lookup</Text>
          <Text style={s.sub}>Cross-reference old and new criminal codes</Text>
        </View>
        <View style={s.guardPill}>
          <Ionicons name="shield-checkmark" size={12} color={NAVY} />
          <Text style={s.guardPillTxt}>DB only</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <CodeAppliesHelper />

          {/* Mode tabs */}
          <View style={s.tabs}>
            {tabs.map(t => (
              <Pressable
                key={t.key}
                style={[s.tab, mode === t.key && s.tabActive]}
                onPress={() => {
                  modeRef.current = t.key;
                  setMode(t.key);
                  queryRef.current = '';
                  setQuery('');
                  setResults([]); setSearched(false); setGuard(null);
                }}
              >
                <Ionicons name={t.icon as any} size={14} color={mode === t.key ? NAVY : '#6B7280'} />
                <Text style={[s.tabTxt, mode === t.key && s.tabTxtActive]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>

          {/* Search row */}
          <View style={s.searchRow}>
            <TextInput
              style={s.searchInput}
              value={query}
              onChangeText={t => { queryRef.current = t; setQuery(t); setSearched(false); }}
              placeholder={
                mode === 'ipc' ? 'IPC/CrPC section e.g. 302, 438, 65B' :
                mode === 'bns' ? 'BNS/BNSS/BSA section e.g. 103, 482' :
                'Keyword e.g. murder, bail, rape, evidence'
              }
              placeholderTextColor="#9CA3AF"
              returnKeyType="search"
              onSubmitEditing={search}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable
              style={[s.searchBtn, (!query.trim() || loading) && s.searchBtnOff]}
              onPress={search}
              disabled={!query.trim() || loading}
            >
              {loading
                ? <ActivityIndicator color={NAVY} size="small" />
                : <Ionicons name="search" size={20} color={NAVY} />}
            </Pressable>
          </View>

          {/* Network error */}
          {!!error && (
            <View style={s.errorBox}>
              <Ionicons name="alert-circle-outline" size={16} color="#B91C1C" />
              <Text style={s.errorTxt}>{error}</Text>
            </View>
          )}

          {/* Guard A wall */}
          {showWall && <NotInDatabaseWall sectionQuery={lastQuery} totalInDb={totalInDb} />}

          {/* Results */}
          {showResults && guard && (
            <>
              <GuardStatusBar guard={guard} total={results.length} />
              {results.map((item, i) => (
                <ResultCard key={`${item.old_section}|${item.new_section}|${i}`} item={item} withheldMessage={guard.withheld_message} />
              ))}
            </>
          )}

          {/* A3: Explicit no-results — shown for both keyword and section mode */}
          {showNoMatch && (
            <View style={s.noResults}>
              <Ionicons name="search-outline" size={28} color="#D1D5DB" />
              <Text style={s.noResultsTitle}>No mapping found for &ldquo;{lastQuery}&rdquo;</Text>
              <Text style={s.noResultsSub}>
                This query returned no results from a database of {totalInDb} entries
                (still expanding). Cross-check against the bare Act at{' '}
                <Text style={{ fontWeight: '700' }}>indiacode.nic.in</Text> before filing.
              </Text>
            </View>
          )}

          {/* Pre-search empty state */}
          {!searched && !loading && (
            <View style={s.empty}>
              <Ionicons name="book-outline" size={40} color="#D1D5DB" />
              <Text style={s.emptyTitle}>BNS / BNSS / BSA Search</Text>
              <Text style={s.emptySub}>
                Search by old IPC section, new BNS section, or keywords like
                theft, bail, rape, evidence.
              </Text>
              <View style={s.chips}>
                {[
                  { label: '302 → murder',           sec: '302',  m: 'ipc' as const },
                  { label: '420 → cheating',         sec: '420',  m: 'ipc' as const },
                  { label: '498A → cruelty',          sec: '498A', m: 'ipc' as const },
                  { label: '438 → anticipatory bail', sec: '438',  m: 'ipc' as const },
                ].map(c => (
                  <Pressable
                    key={c.label}
                    style={s.chip}
                    onPress={() => { setMode(c.m); setQuery(c.sec); }}
                  >
                    <Text style={s.chipTxt}>{c.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {/* Disclaimer */}
          <View style={s.disclaimer}>
            <Ionicons name="information-circle-outline" size={14} color="#9CA3AF" />
            <Text style={s.disclaimerTxt}>
              {totalInDb} entries — all pending dual advocate sign-off.
              Always cross-check against the bare Act before filing.
              IPC 303 and other struck-down provisions render with a Dead-Law guard.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FDFBF7' },
  header: {
    backgroundColor: NAVY, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16, gap: 12,
  },
  backBtn:    { padding: 4 },
  title:      { fontSize: 18, fontWeight: '800', color: '#fff' },
  sub:        { fontSize: 12, color: '#94A3B8', marginTop: 1 },
  guardPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: GOLD, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10,
  },
  guardPillTxt: { fontSize: 10, fontWeight: '700', color: NAVY },
  scroll: { padding: 16, gap: 14, paddingBottom: 40 },

  tabs:       { flexDirection: 'row', gap: 8 },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 9, borderRadius: 10,
    backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB',
  },
  tabActive:    { backgroundColor: GOLD, borderColor: GOLD },
  tabTxt:       { fontSize: 12, fontWeight: '600', color: '#6B7280' },
  tabTxtActive: { color: NAVY },

  searchRow:  { flexDirection: 'row', gap: 8 },
  searchInput: {
    flex: 1, backgroundColor: '#fff', borderRadius: 12,
    borderWidth: 1, borderColor: '#E5E7EB',
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: '#1F2937',
  },
  searchBtn: {
    width: 48, height: 48, borderRadius: 12,
    backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center',
  },
  searchBtnOff: { opacity: 0.45 },

  errorBox: {
    flexDirection: 'row', gap: 8, alignItems: 'center',
    backgroundColor: '#FEF2F2', borderRadius: 10, padding: 12,
  },
  errorTxt: { flex: 1, fontSize: 13, color: '#B91C1C' },

  noResults:     { alignItems: 'center', gap: 8, paddingVertical: 20, paddingHorizontal: 16 },
  noResultsTitle:{ fontSize: 15, fontWeight: '700', color: '#374151', textAlign: 'center' },
  noResultsSub:  { fontSize: 13, color: '#6B7280', textAlign: 'center', lineHeight: 20 },

  empty:      { alignItems: 'center', paddingTop: 12, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#374151' },
  emptySub: {
    fontSize: 13, color: '#6B7280', textAlign: 'center',
    lineHeight: 20, paddingHorizontal: 20,
  },
  chips: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    justifyContent: 'center', marginTop: 4,
  },
  chip:    { backgroundColor: '#EEF2FF', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  chipTxt: { fontSize: 12, fontWeight: '600', color: NAVY },

  disclaimer: {
    flexDirection: 'row', gap: 6, alignItems: 'flex-start',
    backgroundColor: '#F9FAFB', borderRadius: 10, padding: 12,
  },
  disclaimerTxt: { flex: 1, fontSize: 11, color: '#9CA3AF', lineHeight: 16 },
});

// ── Wall styles ────────────────────────────────────────────────────────────────
const w = StyleSheet.create({
  wall: {
    backgroundColor: '#FFF5F5', borderRadius: 14,
    borderWidth: 1.5, borderColor: '#FECACA',
    padding: 20, alignItems: 'center', gap: 10,
  },
  iconWrap: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center',
  },
  title:   { fontSize: 16, fontWeight: '800', color: '#B91C1C', textAlign: 'center' },
  secPill: {
    backgroundColor: '#FEE2E2', paddingHorizontal: 12,
    paddingVertical: 4, borderRadius: 8,
  },
  secPillTxt: { fontSize: 18, fontWeight: '800', color: '#7F1D1D' },
  body: { fontSize: 14, color: '#374151', textAlign: 'center', lineHeight: 22 },
  actionBox: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: '#EEF2FF', borderRadius: 10, padding: 12, width: '100%',
  },
  actionText: { flex: 1, fontSize: 13, color: '#1E40AF', lineHeight: 19 },
  note: { fontSize: 11, color: '#9CA3AF', textAlign: 'center', lineHeight: 16 },
});

// ── Guard status bar styles ────────────────────────────────────────────────────
const gb = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#F0FDF4', borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: '#BBF7D0',
  },
  left:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { fontSize: 12, fontWeight: '700', color: '#166534' },
  dbPill: {
    backgroundColor: '#166534', paddingHorizontal: 6,
    paddingVertical: 2, borderRadius: 6,
  },
  dbTxt:  { fontSize: 9, fontWeight: '700', color: '#fff' },
  right:  { fontSize: 12, color: '#374151' },
});

// ── Unverified banner styles ───────────────────────────────────────────────────
const v = StyleSheet.create({
  banner: {
    flexDirection: 'row', gap: 6, alignItems: 'flex-start',
    backgroundColor: '#FFFBEB', borderRadius: 8, padding: 8,
    borderLeftWidth: 3, borderLeftColor: theme.colors.gold, marginBottom: 8,
  },
  bannerTxt: { flex: 1, fontSize: 11, color: '#92400E', lineHeight: 16 },
});

// ── Helper card styles ─────────────────────────────────────────────────────────
const h = StyleSheet.create({
  card: {
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1, borderColor: '#E5E7EB', padding: 16,
  },
  headRow:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  title:       { fontSize: 15, fontWeight: '700', color: NAVY },
  sub:         { fontSize: 12, color: '#6B7280', marginBottom: 10 },
  row:         { flexDirection: 'row', gap: 8, marginBottom: 10 },
  input: {
    flex: 1, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#1F2937',
    backgroundColor: '#FAFAFA',
  },
  checkBtn:     { backgroundColor: NAVY, paddingHorizontal: 16, borderRadius: 10, justifyContent: 'center' },
  checkBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  resultBox:    { borderLeftWidth: 3, paddingLeft: 12, marginBottom: 8 },
  resultLabel:  { fontSize: 13, fontWeight: '700', marginBottom: 4 },
  resultDetail: { fontSize: 12, color: '#374151', lineHeight: 18 },
  cutoffNote:   { fontSize: 11, color: '#9CA3AF', marginTop: 4 },
});

// ── Result card styles ─────────────────────────────────────────────────────────
const rc = StyleSheet.create({
  card: {
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1, borderColor: '#E5E7EB', padding: 14,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  sourceRow:  { flexDirection: 'row', gap: 6, marginBottom: 10 },
  srcBadge:   { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  srcTxt:     { fontSize: 10, fontWeight: '700' },
  chgBadge:   { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  chgTxt:     { fontSize: 10, fontWeight: '700' },
  secRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    gap: 10, marginBottom: 10,
  },
  secBox: {
    flex: 1, backgroundColor: '#F8F6F0', borderRadius: 10,
    padding: 10, alignItems: 'center',
  },
  secBoxDeleted: { backgroundColor: '#FEF2F2' },
  secLabel: {
    fontSize: 10, color: '#9CA3AF', fontWeight: '600',
    textTransform: 'uppercase', marginBottom: 3,
  },
  secNum:        { fontSize: 20, fontWeight: '800', color: NAVY, textAlign: 'center' },
  offence:       { fontSize: 13, color: '#374151', lineHeight: 19, marginBottom: 6 },
  explainBox: {
    backgroundColor: '#F8FAFF', borderRadius: 10, padding: 12, marginTop: 4,
    borderLeftWidth: 3, borderLeftColor: GOLD,
  },
  explainTxt:    { fontSize: 13, color: '#1F2937', lineHeight: 20 },
  expandHint:    { flexDirection: 'row', alignItems: 'center', gap: 4 },
  expandHintTxt: { fontSize: 11, color: '#9CA3AF' },
  srcLinkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#F3F4F6',
  },
  srcLinkTxt: { fontSize: 11, color: theme.colors.primary, textDecorationLine: 'underline' },
});

// ── Dead-Law banner styles ─────────────────────────────────────────────────────
const dl = StyleSheet.create({
  card: {
    backgroundColor: '#111827', borderRadius: 14, padding: 16, gap: 10,
    borderWidth: 2, borderColor: '#EF4444',
  },
  headerRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: '#1F2937', alignItems: 'center', justifyContent: 'center',
  },
  title:       { fontSize: 14, fontWeight: '800', color: '#FCA5A5' },
  section:     { fontSize: 22, fontWeight: '900', color: '#fff', marginTop: 2 },
  offence:     { fontSize: 13, color: '#D1D5DB', lineHeight: 19 },
  reasonBox: {
    backgroundColor: '#1F2937', borderRadius: 10, padding: 12,
    borderLeftWidth: 3, borderLeftColor: '#EF4444',
  },
  reasonText:  { fontSize: 12, color: '#E5E7EB', lineHeight: 18 },
  citationRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  citationText:{ fontSize: 11, color: '#F87171', fontStyle: 'italic' },
  warningBox: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: '#78350F20', borderRadius: 8, padding: 10,
  },
  warningText: { flex: 1, fontSize: 11, color: '#FBBF24', lineHeight: 17 },
});
