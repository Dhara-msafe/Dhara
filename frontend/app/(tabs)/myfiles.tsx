import { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { tr } from '@/src/ui18n';
import {
  useComplaints, isDraftReady, complaintTitle, complaintProgress,
  type Complaint, type EvidenceFile,
} from '@/src/home/complaints';

const c = theme.colors;

const EVIDENCE_ICON: Record<string, any> = {
  image: 'image-outline', audio: 'mic-outline', video: 'videocam-outline',
  document: 'document-text-outline',
};

export default function MyFiles() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { language, user } = useAuth();
  const lang = language.code;
  const [tab, setTab] = useState('active');

  // Real case data — same backend source (GET /api/fir/sessions/:user_id) the
  // old Complaints screen uses. Replaces the previous hardcoded "File #2" sample.
  const { items: cases, loading, error, retry } = useComplaints();
  const activeCases = cases.filter((i) => !isDraftReady(i));
  const readyCases = cases.filter((i) => isDraftReady(i));
  const evidence: (EvidenceFile & { session: Complaint })[] = cases.flatMap((session) =>
    (session.evidence_files || []).map((f) => ({ ...f, session })),
  );

  const openCase = (item: Complaint) => router.push(
    isDraftReady(item)
      ? ({ pathname: '/fir-draft/result', params: { sessionId: item.session_id } } as any)
      : ({ pathname: '/fir-draft', params: { resumeId: item.session_id } } as any),
  );

  const dateOf = (item: Complaint) => {
    const d = item.updated_at ? new Date(item.updated_at) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : null;
  };

  const tabs: [string, string, number][] = [
    ['active', tr('mf.active', lang), activeCases.length],
    ['evidence', tr('mf.evidence', lang), evidence.length],
    ['documents', tr('mf.documents', lang), readyCases.length],
  ];

  const renderActiveCase = (item: Complaint) => {
    const progress = complaintProgress(item);
    const date = dateOf(item);
    return (
      <Pressable key={item.session_id} style={styles.fileCard} onPress={() => openCase(item)} testID={`myfiles-active-${item.session_id}`}>
        <View style={styles.fileHead}>
          <View style={{ flex: 1 }}>
            <Text style={styles.fileTitle} numberOfLines={1}>{complaintTitle(item)}</Text>
            <Text style={styles.fileSub}>{progress.label} · {tr('mf.step', lang)} {progress.step} of {progress.total}{date ? ` · ${date}` : ''}</Text>
          </View>
          <View style={styles.statusPill}><Text style={styles.statusTxt}>{item.status === 'paused' ? 'Paused' : tr('mf.ontrack', lang)}</Text></View>
        </View>
        <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${(progress.step / progress.total) * 100}%` }]} /></View>
        <View style={styles.nextBtns}>
          <Pressable style={styles.goldBtn} onPress={() => openCase(item)}><Text style={styles.goldBtnTxt}>Continue</Text></Pressable>
        </View>
      </Pressable>
    );
  };

  const renderReadyCase = (item: Complaint) => {
    const date = dateOf(item);
    return (
      <Pressable key={item.session_id} style={styles.resolvedCard} onPress={() => openCase(item)} testID={`myfiles-doc-${item.session_id}`}>
        <View style={styles.resolvedIcon}><Ionicons name="document-text-outline" size={20} color={c.navy} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.resolvedTitle} numberOfLines={1}>{complaintTitle(item)}</Text>
          <Text style={styles.resolvedSub}>Draft ready{date ? ` · ${date}` : ''}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={c.onSurfaceTertiary} />
      </Pressable>
    );
  };

  const renderEvidence = (f: EvidenceFile & { session: Complaint }) => (
    <Pressable key={f.file_id} style={styles.evidenceRow} onPress={() => openCase(f.session)} testID={`myfiles-evidence-${f.file_id}`}>
      <View style={styles.attachChip}>
        <Ionicons name={EVIDENCE_ICON[f.file_type || ''] || 'document-attach-outline'} size={16} color={c.navy} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.evidenceName} numberOfLines={1}>{f.caption || f.filename}</Text>
        <Text style={styles.evidenceMeta} numberOfLines={1}>{complaintTitle(f.session)}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={c.onSurfaceTertiary} />
    </Pressable>
  );

  const Empty = ({ icon, title, sub, cta, onPress }: { icon: any; title: string; sub: string; cta?: string; onPress?: () => void }) => (
    <View style={styles.empty}>
      <Ionicons name={icon} size={30} color={c.onSurfaceTertiary} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySub}>{sub}</Text>
      {cta && onPress && (
        <Pressable style={styles.goldBtn} onPress={onPress}><Text style={styles.goldBtnTxt}>{cta}</Text></Pressable>
      )}
    </View>
  );

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        <View style={styles.headRow}>
          <Text style={styles.title}>{tr('mf.title', lang)}</Text>
          <View style={styles.pin}><Ionicons name="lock-closed-outline" size={15} color={c.darkGold} /><Text style={styles.pinTxt}>{tr('mf.pin', lang)}</Text></View>
        </View>

        {/* DHARA-B014: Guest drafts save/resume correctly, but were not
            honestly labelled as device/session-local rather than a
            permanent cloud account — this clarifies the real behavior
            instead of silently implying registered-account storage. */}
        {!!user?.is_guest && (
          <View style={styles.guestNotice}>
            <Ionicons name="information-circle-outline" size={16} color={c.darkGold} />
            <Text style={styles.guestNoticeTxt}>
              Guest drafts are tied to this device — if you clear app data or uninstall the app, you&apos;ll lose access to them. Create a free account to keep them permanently and reach them from any device.
            </Text>
          </View>
        )}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {tabs.map(([id, label, n]) => (
            <Pressable key={id} style={[styles.tab, tab === id && styles.tabActive]} onPress={() => setTab(id)} testID={`myfiles-tab-${id}`}>
              <Text style={[styles.tabTxt, tab === id && styles.tabTxtActive]}>{label} {n}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {loading ? (
          <View style={styles.loadingWrap}><ActivityIndicator color={c.navy} /></View>
        ) : error ? (
          <View style={styles.empty}>
            <Text style={styles.emptySub}>We couldn’t load your cases. Please check your connection.</Text>
            <Pressable style={styles.goldBtn} onPress={retry}><Text style={styles.goldBtnTxt}>Try again</Text></Pressable>
          </View>
        ) : tab === 'active' ? (
          activeCases.length ? activeCases.map(renderActiveCase) : (
            <Empty icon="folder-open-outline" title="No cases in progress" sub="Start a complaint and DHARA will walk you through it, step by step." cta="Start a complaint" onPress={() => router.push('/engine')} />
          )
        ) : tab === 'documents' ? (
          readyCases.length ? readyCases.map(renderReadyCase) : (
            <Empty icon="document-text-outline" title="No drafts yet" sub="Finished complaint drafts will appear here, ready to download or share." />
          )
        ) : (
          evidence.length ? evidence.map(renderEvidence) : (
            <Empty icon="images-outline" title="No evidence attached" sub="Photos, audio or documents you add to a complaint will be listed here." />
          )
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingRight: 72 },
  title: { fontFamily: theme.fonts.displayBold, fontSize: 28, color: c.ink },
  pin: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.goldMuted, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  pinTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.darkGold },
  guestNotice: { flexDirection: 'row', gap: 10, backgroundColor: c.goldMuted, borderRadius: 14, padding: 14, marginTop: 14, alignItems: 'flex-start' },
  guestNoticeTxt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 12.5, color: c.ink, lineHeight: 18 },
  tabs: { gap: 10, paddingVertical: 16 },
  tab: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 9 },
  tabActive: { backgroundColor: c.navy, borderColor: c.navy },
  tabTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 14, color: c.ink },
  tabTxtActive: { color: '#fff' },
  fileCard: { backgroundColor: c.surface, borderRadius: 18, borderWidth: 1, borderColor: c.lines, padding: 18, marginBottom: 14 },
  fileHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  fileTitle: { fontFamily: theme.fonts.displayBold, fontSize: 18, color: c.ink },
  fileSub: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, marginTop: 2 },
  statusPill: { backgroundColor: c.successSoft, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  statusTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.verifiedGreen },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: c.surfaceTertiary, marginTop: 14, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: c.gold },
  nextBtns: { flexDirection: 'row', gap: 12, marginTop: 16 },
  goldBtn: { backgroundColor: c.gold, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 },
  goldBtnTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.navy },
  loadingWrap: { paddingVertical: 50, alignItems: 'center' },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 36, paddingHorizontal: 20, backgroundColor: c.surface, borderRadius: 18, borderWidth: 1, borderColor: c.lines },
  emptyTitle: { fontFamily: theme.fonts.displayBold, fontSize: 17, color: c.ink, textAlign: 'center', marginTop: 4 },
  emptySub: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, textAlign: 'center', lineHeight: 19 },
  evidenceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.lines, padding: 14, marginBottom: 10 },
  evidenceName: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.ink },
  evidenceMeta: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 2 },
  attachChip: { width: 36, height: 36, borderRadius: 999, backgroundColor: c.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  resolvedCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.lines, padding: 16, marginBottom: 14 },
  resolvedIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: c.navySoft, alignItems: 'center', justifyContent: 'center' },
  resolvedTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 16, color: c.ink },
  resolvedSub: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 2 },
});
