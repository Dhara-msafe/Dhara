import { useEffect, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet, ScrollView, ActivityIndicator, Share } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/src/theme';
import { useAuth, API_BASE } from '@/src/auth';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { draftByType } from '@/src/drafts';

const c = theme.colors;

type MaterialFacts = {
  issuing_authority?: string;
  recipient?: string;
  date_of_issue?: string;
  reference_number?: string;
  amount?: string;
  deadline?: string;
  statutes_cited?: string;
  jurisdiction?: string;
};

type Detail = {
  id: string; extracted_text: string; summary: string; action: string;
  mode: string; suggested_template?: string | null; prefill?: Record<string, string>;
  created_at: string; photo_base64?: string | null;
  // v2 fields — optional for backward compat with old saved scans
  document_type?: string;
  is_legal_document?: boolean;
  material_facts?: MaterialFacts;
  legal_truth_state?: string;
};

const DOC_TYPE_LABELS: Record<string, string> = {
  LEGAL_NOTICE: 'Legal Notice', COURT_DOCUMENT: 'Court Document',
  POLICE_DOCUMENT: 'Police Document', GOVERNMENT_NOTICE: 'Government Notice',
  EMPLOYMENT_NOTICE: 'Employment Notice', TENANCY_NOTICE: 'Tenancy / Housing Notice',
  BANK_NOTICE: 'Bank Notice', LOAN_DEMAND: 'Loan Demand Notice',
  CONTRACT: 'Contract', LEGAL_AGREEMENT: 'Legal Agreement',
  NON_LEGAL_DOCUMENT: 'Non-legal Document', UNKNOWN: 'Document',
};

const FACT_LABELS: Record<string, string> = {
  issuing_authority: 'Issued by', recipient: 'Addressed to',
  date_of_issue: 'Issued on', reference_number: 'Reference / Case No.',
  amount: 'Amount', deadline: 'Response deadline',
  statutes_cited: 'Law cited', jurisdiction: 'Jurisdiction',
};

// Read-only view of a scan saved by POST /api/scan/notice — reached from the
// "Documents" tab. Supports both v1 (summary only) and v2 (structured) saved scans.
export default function ScanDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showText, setShowText] = useState(false);

  useEffect(() => {
    if (!id || !token) { setLoading(false); setError(true); return; }
    let active = true;
    fetch(`${API_BASE}/api/scan/history/detail/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(data => { if (active) setDetail(data); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, token]);

  const share = async () => {
    if (!detail) return;
    try {
      await Share.share({ message: `${detail.mode === 'draft' ? 'Drafted reply' : 'Document, explained'} — DHARA\n\n${detail.summary}` });
    } catch {}
  };

  const hasMaterialFacts = detail?.material_facts
    ? Object.values(detail.material_facts).some(v => v && v !== 'null' && v !== 'NOT FOUND')
    : false;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Scanned document" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32 }}>
        {loading ? (
          <View style={styles.busy}><ActivityIndicator color={c.navy} /></View>
        ) : error || !detail ? (
          <View style={styles.errBox}>
            <Text style={styles.errTxt}>Couldn&apos;t load this scan. Please go back and try again.</Text>
          </View>
        ) : (
          <View>
            {detail.photo_base64 ? (
              <Image source={{ uri: `data:image/jpeg;base64,${detail.photo_base64}` }} style={styles.preview} resizeMode="cover" />
            ) : null}

            {/* v2: document type badge */}
            {detail.document_type && detail.document_type !== 'UNKNOWN' && (
              <View style={styles.docTypeBadge}>
                <Ionicons name="shield-checkmark-outline" size={13} color={c.navy} />
                <Text style={styles.docTypeBadgeTxt}>
                  {DOC_TYPE_LABELS[detail.document_type] || detail.document_type}
                </Text>
              </View>
            )}

            {/* v2: material facts grid */}
            {hasMaterialFacts && (
              <View style={[styles.sectionBlock, { marginTop: 14 }]}>
                <Text style={styles.sectionLabel}>IMPORTANT DETAILS</Text>
                <View style={styles.factsGrid}>
                  {Object.entries(detail.material_facts || {})
                    .filter(([, v]) => v && v !== 'null' && v !== 'NOT FOUND' && v.trim() !== '')
                    .map(([k, v]) => (
                      <View key={k} style={styles.factCard}>
                        <Text style={styles.factKey}>{FACT_LABELS[k] || k}</Text>
                        <Text style={styles.factValue}>{v as string}</Text>
                      </View>
                    ))}
                </View>
              </View>
            )}

            {/* Main result card */}
            <View style={styles.card}>
              <Text style={styles.cardLabel}>{detail.mode === 'draft' ? 'DRAFTED REPLY' : 'WHAT THIS MEANS'}</Text>
              <Text style={styles.summary}>{detail.summary}</Text>
            </View>

            {/* Legal truth state */}
            {detail.legal_truth_state === 'CANNOT_VERIFY' && (
              <View style={styles.truthNote}>
                <Ionicons name="information-circle-outline" size={15} color={c.warning} />
                <Text style={styles.truthNoteTxt}>
                  DHARA could not verify the specific applicable law from this document alone. Consult an advocate before acting.
                </Text>
              </View>
            )}

            {detail.action ? (
              <View style={styles.actionCard}>
                <Ionicons name="arrow-forward-circle" size={18} color={c.gold} />
                <Text style={styles.actionTxt}>{detail.action}</Text>
              </View>
            ) : null}

            {detail.suggested_template && draftByType(detail.suggested_template) ? (
              <Pressable
                style={styles.templateCard}
                onPress={() => router.push({
                  pathname: '/drafts/[type]',
                  params: { type: detail.suggested_template!, prefill: JSON.stringify(detail.prefill || {}) },
                } as any)}
              >
                <View style={styles.templateIcon}>
                  <Ionicons name={draftByType(detail.suggested_template)!.icon} size={20} color={c.navy} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.templateTitle}>Use the {draftByType(detail.suggested_template)!.title} template</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={c.onSurfaceTertiary} />
              </Pressable>
            ) : null}

            <Pressable style={styles.toggle} onPress={() => setShowText(s => !s)}>
              <Ionicons name={showText ? 'chevron-up' : 'chevron-down'} size={18} color={c.navy} />
              <Text style={styles.toggleTxt}>{showText ? 'Hide' : 'Show'} text DHARA read</Text>
            </Pressable>
            {showText && <Text style={styles.extracted}>{detail.extracted_text}</Text>}

            <Pressable style={styles.secBtn} onPress={share} testID="scan-detail-share">
              <Ionicons name="share-outline" size={18} color={c.navy} />
              <Text style={styles.secTxt}>Share</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  busy: { alignItems: 'center', paddingVertical: 60 },
  errBox: { backgroundColor: '#FBEAE8', borderRadius: 12, padding: 14, marginTop: 16 },
  errTxt: { fontFamily: theme.fonts.bodyMedium, fontSize: 14, color: c.error },
  preview: { width: '100%', height: 180, borderRadius: 14, marginBottom: 12, backgroundColor: c.surfaceTertiary },
  docTypeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.navySoft, borderRadius: 20, paddingHorizontal: 12,
    paddingVertical: 6, alignSelf: 'flex-start', marginBottom: 8,
  },
  docTypeBadgeTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 13, color: c.navy },
  sectionBlock: { marginTop: 12, gap: 8 },
  sectionLabel: { fontFamily: theme.fonts.bodyBold, fontSize: 11, color: c.darkGold, letterSpacing: 1.2 },
  factsGrid: { borderRadius: 14, borderWidth: 1, borderColor: c.lines, backgroundColor: c.surface, overflow: 'hidden' },
  factCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingHorizontal: 14, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: c.divider,
  },
  factKey: { fontFamily: theme.fonts.bodyBold, fontSize: 12, color: c.muted, width: 110, flexShrink: 0, paddingTop: 1 },
  factValue: { flex: 1, fontFamily: theme.fonts.bodyMedium, fontSize: 14, color: c.ink, lineHeight: 20 },
  truthNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#FFF8E8', borderRadius: 12, padding: 12, marginTop: 12,
  },
  truthNoteTxt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 13, color: c.warning, lineHeight: 19 },
  card: { backgroundColor: c.navy, borderRadius: 18, padding: 20, marginTop: 12 },
  cardLabel: { fontFamily: theme.fonts.bodyBold, fontSize: 12, color: c.gold, letterSpacing: 1.2 },
  summary: { fontFamily: theme.fonts.body, fontSize: 17, color: '#fff', lineHeight: 26, marginTop: 10 },
  actionCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: c.goldMuted, borderRadius: 14, padding: 16, marginTop: 14,
  },
  actionTxt: { flex: 1, fontFamily: theme.fonts.bodySemiBold, fontSize: 15, color: c.ink, lineHeight: 22 },
  templateCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: c.surface,
    borderWidth: 1, borderColor: c.gold, borderRadius: 16, padding: 16, marginTop: 14,
  },
  templateIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: c.goldMuted, alignItems: 'center', justifyContent: 'center' },
  templateTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.ink },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18 },
  toggleTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.navy },
  extracted: {
    fontFamily: theme.fonts.body, fontSize: 14, color: c.muted, lineHeight: 21, marginTop: 10,
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines, borderRadius: 12, padding: 14,
  },
  secBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1, borderColor: c.lines, borderRadius: 12, paddingVertical: 13,
    backgroundColor: c.surface, marginTop: 18,
  },
  secTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.navy },
});
