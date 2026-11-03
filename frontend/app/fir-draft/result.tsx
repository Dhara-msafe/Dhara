/**
 * FIR Draft Result Screen (v3.4 — P0-Fix1: draft loaded from server, not URL)
 * Displays the generated FIR complaint letter with share/export options.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, Platform, Alert, Clipboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE, useAuth } from '@/src/auth';
import { theme } from '@/src/theme';
import FirSectionDrawer, { SectionItem, DroppedSection } from '@/src/components/FirSectionDrawer';

import { openExternal, shareExternal } from '@/src/outbound';
// ── Theme ─────────────────────────────────────────────────────────────────────
const NAVY   = theme.colors.primary;
const GOLD   = theme.colors.gold;
const CREAM  = theme.colors.surfaceSecondary;
const SURFACE = theme.colors.surface;
const MUTED  = theme.colors.onSurfaceSecondary;
const BORDER = theme.colors.border;
const RED    = theme.colors.error;

const HELPLINES = [
  { label: 'Police',         number: '100',   icon: 'shield-outline' },
  { label: 'Women Helpline', number: '181',   icon: 'woman-outline' },
  { label: 'NALSA Legal Aid',number: '15100', icon: 'briefcase-outline' },
  { label: 'Cybercrime',     number: '1930',  icon: 'laptop-outline' },
  { label: 'Childline',      number: '1098',  icon: 'people-outline' },
];

export default function FIRResult() {
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const router = useRouter();
  const { token } = useAuth();

  // P0-Fix1: draft is fetched from the server, never from URL params
  const [draftText, setDraftText] = useState('');
  const [draftLoading, setDraftLoading] = useState(true);
  const [draftError, setDraftError] = useState('');
  const [copyDone, setCopyDone] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const sessionId = params.sessionId || '';

  // Fetch draft securely from the server
  useEffect(() => {
    if (!sessionId) {
      setDraftError('Session ID missing. Please go back and try again.');
      setDraftLoading(false);
      return;
    }
    const fetchDraft = async () => {
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(`${API_BASE}/api/fir/session/${sessionId}/draft`, { headers });
        if (res.status === 403) {
          setDraftError('Access denied. This draft belongs to another account.');
          return;
        }
        if (res.status === 404) {
          setDraftError('Draft not found. The interview may not be complete.');
          return;
        }
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        const data = await res.json();
        setDraftText(data.draft_text || '');
        // P0-Fix1e: clear local interview state after successful draft load
        await AsyncStorage.removeItem('fir_draft_state').catch(() => {});
        await AsyncStorage.removeItem('gk_fir_session').catch(() => {});
      } catch (e: any) {
        setDraftError('Could not load your draft. Please check your connection and try again.');
      } finally {
        setDraftLoading(false);
      }
    };
    fetchDraft();
  }, [sessionId, token]);

  // Issue 9: Section drawer state
  const [showSectionDrawer, setShowSectionDrawer] = useState(false);
  const [suggestedSections, setSuggestedSections] = useState<SectionItem[]>([]);
  const [droppedSections, setDroppedSections] = useState<DroppedSection[]>([]);

  // Load sections from session on mount
  useEffect(() => {
    if (!sessionId) return;
    const loadSections = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/fir/session/${sessionId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) return;
        const sess = await res.json();
        if (sess.suggested_sections?.length > 0) {
          setSuggestedSections(sess.suggested_sections);
        }
        if (sess.dropped_sections?.length > 0) {
          setDroppedSections(sess.dropped_sections);
        }
      } catch { /* best effort */ }
    };
    loadSections();
  }, [sessionId, token]);

  // ── Copy to clipboard ──────────────────────────────────────────────────────
  const handleCopy = useCallback(() => {
    if (!draftText) return;
    if (Platform.OS === 'web') {
      navigator.clipboard?.writeText(draftText).catch(() => {});
    } else {
      Clipboard.setString(draftText);
    }
    setCopyDone(true);
    setTimeout(() => setCopyDone(false), 2500);
  }, [draftText]);

  // ── Print ──────────────────────────────────────────────────────────────────
  const handlePrint = useCallback(async () => {
    if (!draftText) return;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>body{padding:24px;font-family:Arial,sans-serif;}
h2{color:#1B2B5B;font-size:18px;margin-bottom:4px;}
.warn{background:#FFF8E7;border-left:4px solid #C9973A;padding:10px;font-size:12px;color:#555;margin-bottom:16px;}
pre{white-space:pre-wrap;font-size:13px;line-height:1.7;font-family:'Courier New',monospace;}</style>
</head><body>
<h2>FIR Complaint Draft — DHARA</h2>
<div class="warn"><strong>CITIZEN DRAFT — NOT A REGISTERED FIR.</strong> Present at any police station for official registration under Section 173(1) BNSS.</div>
<pre>${draftText.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>
</body></html>`;
    if (Platform.OS === 'web') {
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } else {
      try {
        const Print = await import('expo-print');
        await Print.printAsync({ html });
      } catch {
        Alert.alert('Print unavailable', 'Use Export PDF instead.');
      }
    }
  }, [draftText]);

  // ── Share as text ──────────────────────────────────────────────────────────
  const handleShare = useCallback(async () => {
    if (!draftText) return;
    setSharing(true);
    try {
      await shareExternal({ message: draftText, title: 'FIR Complaint Draft (DHARA)' });
    } catch {
      Alert.alert('Share failed', 'Could not share the draft.');
    } finally {
      setSharing(false);
    }
  }, [draftText]);

  // ── Export as .txt file ────────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    if (!draftText) return;
    if (Platform.OS === 'web') {
      const blob = new Blob([draftText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'FIR_Draft_DHARA.txt';
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    try {
      const dir = FileSystem.documentDirectory || FileSystem.cacheDirectory;
      if (!dir) throw new Error('No directory available');
      const fileUri = dir + `FIR_Draft_${Date.now()}.txt`;
      await FileSystem.writeAsStringAsync(fileUri, draftText, { encoding: FileSystem.EncodingType.UTF8 });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(fileUri, { mimeType: 'text/plain', dialogTitle: 'Save FIR Draft' });
      } else {
        Alert.alert('Saved', 'Draft exported successfully.');
      }
    } catch {
      Alert.alert('Export failed', 'Could not export the draft. Use Share instead.');
    }
  }, [draftText]);

  // ── v3.3: Download PDF ────────────────────────────────────────────────────
  const handleDownloadPdf = useCallback(async () => {
    if (!sessionId) {
      Alert.alert('Session not found', 'Cannot generate PDF without session ID.');
      return;
    }
    setDownloadingPdf(true);
    try {
      const pdfUrl = `${API_BASE}/api/fir/session/${sessionId}/draft.pdf`;
      if (Platform.OS === 'web') {
        // Can't attach an Authorization header to a plain URL navigation —
        // fetch the PDF as a blob with the header, then open that blob.
        const res = await fetch(pdfUrl, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        openExternal(blobUrl);
        return;
      }
      const dir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
      if (!dir) throw new Error('No directory');
      const fileUri = dir + `FIR_Draft_${sessionId.slice(0, 8)}.pdf`;
      const dl = await FileSystem.downloadAsync(pdfUrl, fileUri, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (dl.status === 200) {
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(dl.uri, { mimeType: 'application/pdf', dialogTitle: 'Save FIR Draft PDF' });
        } else {
          Alert.alert('Saved', 'PDF saved to device.');
        }
      } else {
        throw new Error(`HTTP ${dl.status}`);
      }
    } catch (e: any) {
      Alert.alert('PDF Error', e?.message || 'Could not generate PDF. Try Export .txt instead.');
    } finally {
      setDownloadingPdf(false);
    }
  }, [sessionId, token]);

  if (draftLoading) {
    return (
      <SafeAreaView testID="fir-result-loading" style={styles.root}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={NAVY} />
          <Text style={styles.loadingText}>Loading your draft…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (draftError || !draftText) {
    return (
      <SafeAreaView testID="fir-result-error" style={styles.root}>
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={48} color={RED} />
          <Text style={[styles.loadingText, { color: RED, marginTop: 12 }]}>{draftError || 'Draft could not be loaded.'}</Text>
          <Pressable testID="fir-result-error-back" onPress={() => router.back()} style={{ marginTop: 20, padding: 12, backgroundColor: NAVY, borderRadius: 8 }}>
            <Text style={{ color: '#fff', fontWeight: '600' }}>← Go Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView testID="fir-result-screen" style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable testID="fir-result-back" accessibilityLabel="Go back" onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Ionicons name="arrow-back" size={22} color={SURFACE} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Your FIR Draft</Text>
          <Text style={styles.headerSub}>Ready to present at police station</Text>
        </View>
        {/* Issue 9: Section menu button */}
        {suggestedSections.length > 0 && (
          <Pressable
            testID="fir-result-sections-menu" onPress={() => setShowSectionDrawer(true)}
            style={styles.sectionMenuBtn}
            hitSlop={12}
          >
            <Ionicons name="list-outline" size={22} color={GOLD} />
          </Pressable>
        )}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Disclaimer banner */}
        <View style={styles.disclaimerCard}>
          <Ionicons name="alert-circle" size={18} color={RED} />
          <Text style={styles.disclaimerText}>
            <Text style={{ fontWeight: '700' }}>CITIZEN DRAFT — NOT A REGISTERED FIR.</Text>
            {' '}Present this at the police station for official registration under Section 173(1) BNSS.
          </Text>
        </View>

        {/* Zero FIR note */}
        <View style={styles.zeroFirCard}>
          <Ionicons name="information-circle" size={18} color={NAVY} />
          <Text style={styles.zeroFirText}>
            <Text style={{ fontWeight: '700' }}>Zero FIR Right: </Text>
            You can file this FIR at ANY police station in India. They are legally required to accept it (Section 173(1) BNSS).
          </Text>
        </View>

        {/* Issue 9: Sections summary badge (if sections available) */}
        {suggestedSections.length > 0 && (
          <Pressable testID="fir-result-sections-summary" style={styles.sectionsSummaryCard} onPress={() => setShowSectionDrawer(true)}>
            <Ionicons name="library-outline" size={16} color={NAVY} />
            <Text style={styles.sectionsSummaryText}>
              {suggestedSections.length} BNS section{suggestedSections.length !== 1 ? 's' : ''} suggested
              {droppedSections.length > 0 ? ` · ${droppedSections.length} not applicable` : ''}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={MUTED} />
          </Pressable>
        )}

        {/* Draft text */}
        <View style={styles.draftCard}>
          <View style={styles.draftHeader}>
            <Ionicons name="document-text-outline" size={18} color={NAVY} />
            <Text style={styles.draftTitle}>Complaint Letter</Text>
          </View>
          <Text testID="fir-result-draft-text" style={styles.draftText} selectable>{draftText}</Text>
        </View>

        {/* Action buttons */}
        <View style={styles.actions}>
          <Pressable testID="fir-result-copy" style={styles.actionBtn} onPress={handleCopy}>
            <Ionicons name={copyDone ? 'checkmark-circle' : 'copy-outline'} size={20} color={NAVY} />
            <Text style={styles.actionBtnText}>{copyDone ? 'Copied!' : 'Copy Text'}</Text>
          </Pressable>
          <Pressable testID="fir-result-share" style={styles.actionBtn} onPress={handleShare} disabled={sharing}>
            {sharing
              ? <ActivityIndicator size="small" color={NAVY} />
              : <Ionicons name="share-outline" size={20} color={NAVY} />}
            <Text style={styles.actionBtnText}>Share</Text>
          </Pressable>
          <Pressable testID="fir-result-export-text" style={styles.actionBtn} onPress={handleExport}>
            <Ionicons name="download-outline" size={20} color={NAVY} />
            <Text style={styles.actionBtnText}>Export .txt</Text>
          </Pressable>
          {/* v3.3: PDF download */}
          <Pressable testID="fir-result-export-pdf" style={[styles.actionBtn, styles.actionBtnPdf]} onPress={handleDownloadPdf} disabled={downloadingPdf}>
            {downloadingPdf
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="document-attach-outline" size={20} color="#fff" />}
            <Text style={[styles.actionBtnText, { color: '#fff' }]}>Export PDF</Text>
          </Pressable>
          {/* Print */}
          <Pressable testID="fir-result-print" style={[styles.actionBtn, styles.actionBtnPrint]} onPress={handlePrint}>
            <Ionicons name="print-outline" size={20} color="#fff" />
            <Text style={[styles.actionBtnText, { color: '#fff' }]}>Print</Text>
          </Pressable>
        </View>

        {/* Next steps */}
        <View style={styles.stepsCard}>
          <Text style={styles.stepsTitle}>What to do next</Text>
          {[
            'Print or save this draft on your phone.',
            'Visit the nearest police station (any station accepts Zero FIR).',
            'Give this document to the Station House Officer (SHO).',
            "Insist on getting a copy of the registered FIR — it's your right.",
            'Note the FIR number and officer\'s name for your records.',
          ].map((step, i) => (
            <View key={i} style={styles.stepRow}>
              <View style={styles.stepNum}><Text style={styles.stepNumText}>{i + 1}</Text></View>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
        </View>

        {/* Helplines */}
        <View style={styles.helplinesCard}>
          <Text style={styles.helplinesTitle}>Emergency Helplines (Free)</Text>
          <View style={styles.helplinesGrid}>
            {HELPLINES.map(h => (
              <View key={h.number} style={styles.helplineItem}>
                <Ionicons name={h.icon as any} size={16} color={NAVY} />
                <Text style={styles.helplineNum}>{h.number}</Text>
                <Text style={styles.helplineLabel}>{h.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Start new complaint */}
        <Pressable
          testID="fir-result-new-complaint"
          style={styles.newComplaintBtn}
          onPress={() => router.replace('/fir-draft')}
        >
          <Ionicons name="add-circle-outline" size={20} color={NAVY} />
          <Text style={styles.newComplaintText}>Start New Complaint</Text>
        </Pressable>

      </ScrollView>

      {/* Issue 9: Section Drawer (no jump in result — user is already in the draft view) */}
      <FirSectionDrawer
        visible={showSectionDrawer}
        onClose={() => setShowSectionDrawer(false)}
        suggestedSections={suggestedSections}
        droppedSections={droppedSections}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: SURFACE },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { color: MUTED, fontSize: 15 },

  // Header
  header: {
    backgroundColor: NAVY, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12, gap: 12,
  },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#fff' },
  headerSub: { fontSize: 12, color: GOLD },
  backBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  sectionMenuBtn: { padding: 6 },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 16, paddingBottom: 40 },

  // Disclaimer
  disclaimerCard: {
    flexDirection: 'row', gap: 10, backgroundColor: '#FEF2F2',
    borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#FECACA',
    alignItems: 'flex-start',
  },
  disclaimerText: { flex: 1, fontSize: 13, color: '#7F1D1D', lineHeight: 19 },

  // Zero FIR
  zeroFirCard: {
    flexDirection: 'row', gap: 10, backgroundColor: '#EFF6FF',
    borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#BFDBFE',
    alignItems: 'flex-start',
  },
  zeroFirText: { flex: 1, fontSize: 13, color: NAVY, lineHeight: 19 },

  // Issue 9: Sections summary card
  sectionsSummaryCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: CREAM, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: BORDER,
  },
  sectionsSummaryText: { flex: 1, fontSize: 13, color: NAVY, fontWeight: '600' },

  // Draft
  draftCard: {
    backgroundColor: CREAM, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: '#D6C9B0',
  },
  draftHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  draftTitle: { fontSize: 15, fontWeight: '700', color: NAVY },
  draftText: { fontSize: 13, color: '#2D2D2D', lineHeight: 22, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },

  // Actions
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, backgroundColor: CREAM, borderRadius: 10, paddingVertical: 12,
    borderWidth: 1.5, borderColor: BORDER, minWidth: 80,
  },
  actionBtnPdf: { backgroundColor: NAVY, borderColor: NAVY, flexBasis: '100%', flex: 0 },
  actionBtnPrint: { backgroundColor: '#2D6A4F', borderColor: '#2D6A4F', flexBasis: '100%', flex: 0 },
  actionBtnText: { fontSize: 13, color: NAVY, fontWeight: '600' },

  // Steps
  stepsCard: {
    backgroundColor: SURFACE, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: BORDER,
  },
  stepsTitle: { fontSize: 15, fontWeight: '700', color: NAVY, marginBottom: 12 },
  stepRow: { flexDirection: 'row', gap: 10, marginBottom: 10, alignItems: 'flex-start' },
  stepNum: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: NAVY,
    alignItems: 'center', justifyContent: 'center',
  },
  stepNumText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  stepText: { flex: 1, fontSize: 13, color: MUTED, lineHeight: 19 },

  // Helplines
  helplinesCard: {
    backgroundColor: NAVY, borderRadius: 14, padding: 16,
  },
  helplinesTitle: { fontSize: 14, fontWeight: '700', color: GOLD, marginBottom: 12 },
  helplinesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  helplineItem: {
    backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 10, padding: 10,
    alignItems: 'center', minWidth: 80, gap: 4,
  },
  helplineNum: { fontSize: 16, fontWeight: '800', color: '#fff' },
  helplineLabel: { fontSize: 10, color: 'rgba(255,255,255,0.7)', textAlign: 'center' },

  // New complaint
  newComplaintBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: 12, paddingVertical: 14,
    backgroundColor: CREAM, borderWidth: 1.5, borderColor: BORDER,
  },
  newComplaintText: { color: NAVY, fontSize: 14, fontWeight: '600' },
});
