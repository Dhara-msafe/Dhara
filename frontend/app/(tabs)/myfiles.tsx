import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
  ActivityIndicator, Modal, Alert, TouchableOpacity,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { UI_REVISION_V1 } from '@/src/designRevision';
import { focusRingStyle } from '@/src/a11yFocus';
import { useAuth } from '@/src/auth';
import { tr } from '@/src/ui18n';
import {
  useComplaints, isDraftReady, complaintTitle, complaintProgress,
  type Complaint, type EvidenceFile,
} from '@/src/home/complaints';
import { useScanHistory, type ScanHistoryItem } from '@/src/home/scanHistory';

const c = theme.colors;

const EVIDENCE_ICON: Record<string, any> = {
  image: 'image-outline', audio: 'mic-outline', video: 'videocam-outline',
  document: 'document-text-outline',
};

/** Items with the same title are stacked when this many exist. */
const STACK_THRESHOLD = 3;

type ItemState = 'active' | 'archived' | 'trashed' | 'deleted';
type Filter = 'All' | 'Active' | 'Paused' | 'Archived' | 'Trash';

const FILTERS: Filter[] = ['All', 'Active', 'Paused', 'Archived', 'Trash'];

const ACTIVE_ACTIONS = [
  { id: 'archive',  icon: 'archive-outline',       label: 'Archive',              color: c.navy },
  { id: 'save',     icon: 'download-outline',       label: 'Save to device',       color: c.navy },
  { id: 'trash',    icon: 'trash-outline',          label: 'Move to trash',        color: '#E07B39' },
  { id: 'delete',   icon: 'close-circle-outline',   label: 'Delete permanently',   color: '#C73236' },
] as const;

const ARCHIVED_ACTIONS = [
  { id: 'restore',  icon: 'refresh-outline',        label: 'Restore to active',    color: c.navy },
  { id: 'trash',    icon: 'trash-outline',          label: 'Move to trash',        color: '#E07B39' },
  { id: 'delete',   icon: 'close-circle-outline',   label: 'Delete permanently',   color: '#C73236' },
] as const;

const TRASH_ACTIONS = [
  { id: 'restore',  icon: 'refresh-outline',        label: 'Restore to active',    color: c.navy },
  { id: 'delete',   icon: 'close-circle-outline',   label: 'Delete permanently',   color: '#C73236' },
] as const;

export default function MyFiles() {
  const insets = useSafeAreaInsets();
  const router  = useRouter();
  const { language, user } = useAuth();
  const lang = language.code;

  const [tab,            setTab]            = useState('active');
  const [filter,         setFilter]         = useState<Filter>('All');
  const [menuItemId,     setMenuItemId]     = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [itemStates,     setItemStates]     = useState<Record<string, ItemState>>({});

  // ── Data ─────────────────────────────────────────────────────────────────
  const { items: cases, loading, error, retry } = useComplaints();
  const { items: scans, loading: scansLoading }  = useScanHistory();

  const activeCases = cases.filter((i) => !isDraftReady(i));
  const readyCases  = cases.filter((i) => isDraftReady(i));
  const evidence: (EvidenceFile & { session: Complaint })[] = cases.flatMap((s) =>
    (s.evidence_files || []).map((f) => ({ ...f, session: s })),
  );

  // ── Item-state persistence ────────────────────────────────────────────────
  const statesKey = `dhara_myfiles_states_${user?.id || 'guest'}`;

  useEffect(() => {
    AsyncStorage.getItem(statesKey)
      .then((raw) => { if (raw) setItemStates(JSON.parse(raw)); })
      .catch(() => {});
  }, [statesKey]);

  const setItemState = useCallback(async (id: string, state: ItemState) => {
    setItemStates((prev) => {
      const next = { ...prev, [id]: state };
      AsyncStorage.setItem(statesKey, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, [statesKey]);

  // ── Filtered active cases ─────────────────────────────────────────────────
  const getFiltered = useCallback((): Complaint[] => {
    if (filter === 'Archived') return activeCases.filter((i) => itemStates[i.session_id] === 'archived');
    if (filter === 'Trash')    return activeCases.filter((i) => itemStates[i.session_id] === 'trashed');

    const base = activeCases.filter((i) => {
      const st = itemStates[i.session_id];
      return !st || st === 'active';
    });
    if (filter === 'Active') return base.filter((i) => i.status !== 'paused');
    if (filter === 'Paused') return base.filter((i) => i.status === 'paused');
    return base; // 'All'
  }, [activeCases, filter, itemStates]);

  // ── Action handler ────────────────────────────────────────────────────────
  const handleAction = useCallback((action: string, itemId: string) => {
    setMenuItemId(null);
    if (action === 'archive')  { setItemState(itemId, 'archived'); return; }
    if (action === 'restore')  { setItemState(itemId, 'active');   return; }
    if (action === 'trash')    { setItemState(itemId, 'trashed');  return; }
    if (action === 'save')     {
      Alert.alert('Coming soon', 'Export to device will be available in an upcoming update.');
      return;
    }
    if (action === 'delete') {
      Alert.alert(
        'Delete permanently?',
        'This cannot be undone. The case will be removed from your files.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => setItemState(itemId, 'deleted') },
        ],
      );
    }
  }, [setItemState]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const openCase = (item: Complaint) => router.push(
    isDraftReady(item)
      ? ({ pathname: '/fir-draft/result', params: { sessionId: item.session_id } } as any)
      : ({ pathname: '/fir-draft', params: { resumeId: item.session_id } } as any),
  );

  const dateOf = (item: Complaint) => {
    const d = item.updated_at ? new Date(item.updated_at) : null;
    return d && !Number.isNaN(d.getTime())
      ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : null;
  };

  const globalIndex = useCallback(
    (item: Complaint) => activeCases.findIndex((i) => i.session_id === item.session_id) + 1,
    [activeCases],
  );

  // ── Stacking ──────────────────────────────────────────────────────────────
  /**
   * Returns display rows: either a single Complaint or a stack group.
   * Stacking is applied only for 'All' and 'Active' filters to avoid
   * confusing grouped display when drilling into Paused/Archived/Trash.
   */
  const buildRows = useCallback(() => {
    type Row = { type: 'single'; item: Complaint } | { type: 'stack'; title: string; items: Complaint[] };
    const filtered = getFiltered();
    const shouldStack = filter === 'All' || filter === 'Active';

    if (!shouldStack) return filtered.map((item) => ({ type: 'single', item }));

    // Group by title
    const groups: Record<string, Complaint[]> = {};
    filtered.forEach((item) => {
      const t = complaintTitle(item);
      if (!groups[t]) groups[t] = [];
      groups[t].push(item);
    });

    const rows: Row[] = [];
    const seen = new Set<string>();
    filtered.forEach((item) => {
      const t = complaintTitle(item);
      if (seen.has(t)) return;
      seen.add(t);
      const g = groups[t];
      if (g.length >= STACK_THRESHOLD) {
        rows.push({ type: 'stack', title: t, items: g });
      } else {
        g.forEach((i) => rows.push({ type: 'single', item: i }));
      }
    });
    return rows;
  }, [getFiltered, filter]);

  const toggleGroup = (title: string) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(title)) { next.delete(title); } else { next.add(title); }
      return next;
    });

  // ── Menu actions to show based on current filter ──────────────────────────
  const actionsFor = (): readonly { id: string; icon: string; label: string; color: string }[] => {
    if (filter === 'Archived') return ARCHIVED_ACTIONS;
    if (filter === 'Trash')    return TRASH_ACTIONS;
    return ACTIVE_ACTIONS;
  };

  // ── Tabs ──────────────────────────────────────────────────────────────────
  const tabsData: [string, string, number][] = [
    ['active',    tr('mf.active',    lang), activeCases.filter((i) => { const st = itemStates[i.session_id]; return !st || st === 'active'; }).length],
    ['evidence',  tr('mf.evidence',  lang), evidence.length],
    ['documents', tr('mf.documents', lang), readyCases.length + scans.length],
  ];

  // ── Renders ───────────────────────────────────────────────────────────────
  const renderCard = (item: Complaint, forceShowInStack = false) => {
    const progress = complaintProgress(item);
    const date = dateOf(item);
    const num  = globalIndex(item);
    const paused = item.status === 'paused';

    return (
      <View key={item.session_id} style={styles.fileCard}>
        {/* Number badge */}
        <View style={styles.numBadge} pointerEvents="none">
          <Text style={styles.numBadgeTxt}>#{num}</Text>
        </View>

        <Pressable
          style={(s) => [styles.cardBody, focusRingStyle(s)]}
          onPress={() => openCase(item)}
          testID={`myfiles-active-${item.session_id}`}
          accessibilityRole="button"
          accessibilityLabel={`${complaintTitle(item)}, step ${progress.step} of ${progress.total}`}
        >
          <View style={styles.fileHead}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={styles.fileTitle} numberOfLines={1}>{complaintTitle(item)}</Text>
              <Text style={styles.fileSub}>
                {progress.label} · {tr('mf.step', lang)} {progress.step} of {progress.total}
                {date ? ` · ${date}` : ''}
              </Text>
            </View>
            <View style={[styles.statusPill, paused && styles.statusPillPaused]}>
              <Text style={[styles.statusTxt, paused && styles.statusTxtPaused]}>
                {paused ? 'Paused' : tr('mf.ontrack', lang)}
              </Text>
            </View>
          </View>

          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${(progress.step / progress.total) * 100}%` }]} />
          </View>
        </Pressable>

        {/* Action row */}
        <View style={styles.actionRow}>
          <Pressable
            style={(s) => [styles.goldBtn, focusRingStyle(s)]}
            onPress={() => openCase(item)}
            accessibilityRole="button"
          >
            <Text style={styles.goldBtnTxt}>Continue</Text>
          </Pressable>
          <Pressable
            style={styles.iconBtn}
            onPress={() => setMenuItemId(item.session_id)}
            accessibilityRole="button"
            accessibilityLabel="More options"
            hitSlop={8}
          >
            <Ionicons name="ellipsis-horizontal" size={18} color={c.navy} />
          </Pressable>
        </View>
      </View>
    );
  };

  const renderStack = (title: string, items: Complaint[]) => {
    const isExpanded = expandedGroups.has(title);
    const display = isExpanded ? items : [items[0]];
    const extra   = items.length - 1;

    return (
      <View key={title} style={styles.stackWrap}>
        {/* Shadow layers for the stack visual */}
        {!isExpanded && items.length >= 2 && <View style={[styles.fileCard, styles.stackShadow2]} pointerEvents="none" />}
        {!isExpanded && items.length >= 3 && <View style={[styles.fileCard, styles.stackShadow3]} pointerEvents="none" />}

        {display.map((item) => renderCard(item))}

        {/* Expand / collapse strip */}
        <Pressable
          style={styles.stackToggle}
          onPress={() => toggleGroup(title)}
          accessibilityRole="button"
          accessibilityLabel={isExpanded ? `Collapse ${title}` : `Show ${extra} more ${title}`}
        >
          <Ionicons
            name={isExpanded ? 'chevron-up-circle-outline' : 'chevron-down-circle-outline'}
            size={16}
            color={c.navy}
          />
          <Text style={styles.stackToggleTxt}>
            {isExpanded ? `Collapse ${title}` : `+${extra} more ${title}`}
          </Text>
        </Pressable>
      </View>
    );
  };

  const renderReadyCase = (item: Complaint) => {
    const date = dateOf(item);
    return (
      <Pressable
        key={item.session_id}
        style={(s) => [styles.resolvedCard, focusRingStyle(s)]}
        onPress={() => openCase(item)}
        testID={`myfiles-doc-${item.session_id}`}
        accessibilityRole="button"
        accessibilityLabel={`${complaintTitle(item)}, draft ready`}
      >
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
    <Pressable
      key={f.file_id}
      style={(s) => [styles.evidenceRow, focusRingStyle(s)]}
      onPress={() => openCase(f.session)}
      testID={`myfiles-evidence-${f.file_id}`}
      accessibilityRole="button"
      accessibilityLabel={f.caption || f.filename}
    >
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

  const renderScan = (item: ScanHistoryItem) => {
    const d = item.created_at ? new Date(item.created_at) : null;
    const date = d && !Number.isNaN(d.getTime())
      ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : null;
    return (
      <Pressable
        key={item.id}
        style={(s) => [styles.resolvedCard, focusRingStyle(s)]}
        onPress={() => router.push({ pathname: '/scan/[id]', params: { id: item.id } } as any)}
        testID={`myfiles-scan-${item.id}`}
        accessibilityRole="button"
        accessibilityLabel={item.summary || item.extracted_text || 'Scanned document'}
      >
        <View style={styles.resolvedIcon}><Ionicons name="camera-outline" size={20} color={c.navy} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.resolvedTitle} numberOfLines={1}>{item.summary || item.extracted_text || 'Scanned document'}</Text>
          <Text style={styles.resolvedSub}>Scanned{date ? ` · ${date}` : ''}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={c.onSurfaceTertiary} />
      </Pressable>
    );
  };

  const Empty = ({ icon, title, sub, cta, onPress }: { icon: any; title: string; sub: string; cta?: string; onPress?: () => void }) => (
    <View style={styles.empty}>
      <Ionicons name={icon} size={30} color={c.onSurfaceTertiary} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySub}>{sub}</Text>
      {cta && onPress && (
        <Pressable style={(s) => [styles.goldBtn, focusRingStyle(s)]} onPress={onPress} accessibilityRole="button">
          <Text style={styles.goldBtnTxt}>{cta}</Text>
        </Pressable>
      )}
    </View>
  );

  // ── Active tab content ────────────────────────────────────────────────────
  const rows = buildRows();
  const filteredCount = getFiltered().length;

  const renderActiveTab = () => {
    if (!filteredCount && filter !== 'All') {
      const emptyLabels: Record<Filter, [string, string]> = {
        All:      ['No cases in progress', 'Start a complaint and DHARA will walk you through it, step by step.'],
        Active:   ['No active cases',      'All your in-progress cases will appear here.'],
        Paused:   ['No paused cases',      'Cases you pause will appear here.'],
        Archived: ['Nothing archived yet', 'Archive completed or old cases to keep things tidy.'],
        Trash:    ['Trash is empty',       'Cases you move to trash will appear here.'],
      };
      const [t, s] = emptyLabels[filter];
      return (
        <Empty
          icon="folder-open-outline"
          title={t}
          sub={s}
          cta={filter === 'All' ? 'Start a complaint' : undefined}
          onPress={filter === 'All' ? () => router.push('/engine') : undefined}
        />
      );
    }
    if (!activeCases.filter((i) => { const st = itemStates[i.session_id]; return !st || st === 'active'; }).length && filter === 'All') {
      return (
        <Empty
          icon="folder-open-outline"
          title="No cases in progress"
          sub="Start a complaint and DHARA will walk you through it, step by step."
          cta="Start a complaint"
          onPress={() => router.push('/engine')}
        />
      );
    }

    return (
      <>
        {rows.map((row) =>
          row.type === 'stack'
            ? renderStack(row.title, row.items)
            : renderCard(row.item),
        )}

        {/* Trash / archive count badge */}
        {filter === 'All' && (activeCases.filter((i) => itemStates[i.session_id] === 'trashed').length > 0 ||
          activeCases.filter((i) => itemStates[i.session_id] === 'archived').length > 0) && (
          <View style={styles.hintRow}>
            <Ionicons name="information-circle-outline" size={14} color={c.muted} />
            <Text style={styles.hintTxt}>
              {[
                activeCases.filter((i) => itemStates[i.session_id] === 'archived').length > 0 &&
                  `${activeCases.filter((i) => itemStates[i.session_id] === 'archived').length} archived`,
                activeCases.filter((i) => itemStates[i.session_id] === 'trashed').length > 0 &&
                  `${activeCases.filter((i) => itemStates[i.session_id] === 'trashed').length} in trash`,
              ].filter(Boolean).join(' · ')}
            </Text>
          </View>
        )}
      </>
    );
  };

  // ── Root render ───────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 16, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.headRow}>
          <Text style={styles.title}>{tr('mf.title', lang)}</Text>
          <View style={styles.pin}>
            <Ionicons name="lock-closed-outline" size={15} color={c.darkGold} />
            <Text style={styles.pinTxt}>{tr('mf.pin', lang)}</Text>
          </View>
        </View>

        {!!user?.is_guest && (
          <View style={styles.guestNotice}>
            <Ionicons name="information-circle-outline" size={16} color={c.darkGold} />
            <Text style={styles.guestNoticeTxt}>
              Guest drafts are tied to this device — if you clear app data or uninstall the app, you{'\u2019'}ll
              lose access to them. Create a free account to keep them permanently.
            </Text>
          </View>
        )}

        {/* Tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {tabsData.map(([id, label, n]) => (
            <Pressable
              key={id}
              style={(s) => [styles.tab, tab === id && styles.tabActive, focusRingStyle(s)]}
              onPress={() => setTab(id)}
              testID={`myfiles-tab-${id}`}
              accessibilityRole="button"
              accessibilityLabel={`${label}, ${n}`}
              accessibilityState={{ selected: tab === id }}
            >
              <Text style={[styles.tabTxt, tab === id && styles.tabTxtActive]}>{label} {n}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Filter bar — active tab only */}
        {tab === 'active' && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {FILTERS.map((f) => (
              <Pressable
                key={f}
                style={[styles.filterChip, filter === f && styles.filterChipActive]}
                onPress={() => setFilter(f)}
                accessibilityRole="button"
                accessibilityState={{ selected: filter === f }}
              >
                {f === 'Trash'    && <Ionicons name="trash-outline"   size={12} color={filter === f ? '#fff' : c.muted} style={{ marginRight: 4 }} />}
                {f === 'Archived' && <Ionicons name="archive-outline" size={12} color={filter === f ? '#fff' : c.muted} style={{ marginRight: 4 }} />}
                <Text style={[styles.filterTxt, filter === f && styles.filterTxtActive]}>{f}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {/* Tab content */}
        {loading ? (
          <View style={styles.loadingWrap}><ActivityIndicator color={c.navy} /></View>
        ) : error ? (
          <View style={styles.empty}>
            <Text style={styles.emptySub}>We couldn{'\u2019'}t load your cases. Please check your connection.</Text>
            <Pressable style={(s) => [styles.goldBtn, styles.retryBtn, focusRingStyle(s)]} onPress={retry} accessibilityRole="button">
              <Text style={[styles.goldBtnTxt, styles.retryTxt]}>Try again</Text>
            </Pressable>
          </View>
        ) : tab === 'active' ? (
          renderActiveTab()
        ) : tab === 'documents' ? (
          (readyCases.length || scans.length) ? (
            <>
              {readyCases.map(renderReadyCase)}
              {scans.map(renderScan)}
              {scansLoading && !scans.length && <View style={styles.loadingWrap}><ActivityIndicator color={c.navy} /></View>}
            </>
          ) : (
            <Empty icon="document-text-outline" title="No drafts yet" sub="Finished complaint drafts and scanned notices will appear here, ready to review or share." />
          )
        ) : (
          evidence.length ? evidence.map(renderEvidence) : (
            <Empty icon="images-outline" title="No evidence attached" sub="Photos, audio or documents you add to a complaint will be listed here." />
          )
        )}
      </ScrollView>

      {/* ── Action menu bottom sheet ─────────────────────────────────────── */}
      <Modal
        visible={!!menuItemId}
        transparent
        animationType="slide"
        onRequestClose={() => setMenuItemId(null)}
        statusBarTranslucent
      >
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => setMenuItemId(null)}
        >
          <View style={[styles.menuSheet, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.menuHandle} />
            <Text style={styles.menuTitle}>File options</Text>

            {actionsFor().map((action, i, arr) => (
              <View key={action.id}>
                <Pressable
                  style={styles.menuRow}
                  onPress={() => handleAction(action.id, menuItemId!)}
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                >
                  <View style={[styles.menuIcon, { backgroundColor: action.color + '18' }]}>
                    <Ionicons name={action.icon as any} size={20} color={action.color} />
                  </View>
                  <Text style={[styles.menuLabel, { color: action.color }]}>{action.label}</Text>
                  <Ionicons name="chevron-forward" size={16} color={c.onSurfaceTertiary} />
                </Pressable>
                {i < arr.length - 1 && <View style={styles.menuDivider} />}
              </View>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root:          { flex: 1, backgroundColor: c.background },
  headRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingRight: 4 },
  title:         { fontFamily: theme.fonts.displayBold, fontSize: 24, color: c.ink },
  pin:           { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.goldMuted, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  pinTxt:        { fontFamily: theme.fonts.bodySemiBold, fontSize: 12, color: c.darkGold },
  guestNotice:   { flexDirection: 'row', gap: 10, backgroundColor: c.goldMuted, borderRadius: 14, padding: 14, marginTop: 14, alignItems: 'flex-start' },
  guestNoticeTxt:{ flex: 1, fontFamily: theme.fonts.body, fontSize: 13, color: c.ink, lineHeight: 16 },

  // Tabs
  tabs:          { gap: 10, paddingVertical: 16 },
  tab:           { backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines, borderRadius: 999, paddingHorizontal: 18, paddingVertical: UI_REVISION_V1 ? 14 : 9 },
  tabActive:     { backgroundColor: c.navy, borderColor: c.navy },
  tabTxt:        { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.ink },
  tabTxtActive:  UI_REVISION_V1 ? { color: '#fff', fontFamily: theme.fonts.bodyBold } : { color: '#fff' },

  // Filter bar
  filterRow:          { gap: 8, paddingBottom: 16, alignItems: 'center' },
  filterChip:         { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: c.lines, backgroundColor: c.surface },
  filterChipActive:   { backgroundColor: c.navy, borderColor: c.navy },
  filterTxt:          { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted },
  filterTxtActive:    { color: '#fff', fontFamily: theme.fonts.bodySemiBold },

  // Card
  fileCard:      { backgroundColor: c.surface, borderRadius: 18, borderWidth: 1, borderColor: c.lines, padding: 18, marginBottom: 14 },
  cardBody:      { flex: 1 },
  numBadge:      { position: 'absolute', top: 12, left: 14, backgroundColor: c.navySoft, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  numBadgeTxt:   { fontFamily: theme.fonts.bodyBold, fontSize: 12, color: c.navy },
  fileHead:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 18 },
  fileTitle:     { fontFamily: theme.fonts.displayBold, fontSize: 16, color: c.ink },
  fileSub:       { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 2 },
  statusPill:    { backgroundColor: c.successSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  statusPillPaused: { backgroundColor: '#FFF3E8' },
  statusTxt:     { fontFamily: theme.fonts.bodySemiBold, fontSize: 12, color: c.verifiedGreen },
  statusTxtPaused:  { color: '#E07B39' },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: c.surfaceTertiary, marginTop: 14, overflow: 'hidden' },
  progressFill:  { height: 6, borderRadius: 3, backgroundColor: c.gold },

  // Card action row
  actionRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  goldBtn:       { backgroundColor: c.gold, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 18 },
  goldBtnTxt:    { fontFamily: theme.fonts.bodyBold, fontSize: 13, color: c.navy },
  // 27 Nov: Try again is navy on light screens everywhere.
  retryBtn:      { backgroundColor: c.navy, borderRadius: 14, minHeight: 48, justifyContent: 'center', paddingHorizontal: 24 },
  retryTxt:      { color: '#fff', fontSize: 14 },
  iconBtn:       { width: 44, height: 44, borderRadius: 12, backgroundColor: c.surfaceSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.lines },

  // Stack
  stackWrap:     { marginBottom: 2 },
  stackShadow2:  { position: 'absolute', top: 7, left: 7, right: 7, zIndex: 0, opacity: 0.5 },
  stackShadow3:  { position: 'absolute', top: 14, left: 14, right: 14, zIndex: -1, opacity: 0.3 },
  stackToggle:   { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', marginBottom: 18, marginTop: -4, paddingVertical: 7, paddingHorizontal: 16, backgroundColor: c.navySoft, borderRadius: 999 },
  stackToggleTxt:{ fontFamily: theme.fonts.bodySemiBold, fontSize: 12, color: c.navy },

  // Hint row
  hintRow:       { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', marginTop: -4, marginBottom: 8 },
  hintTxt:       { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted },

  // Misc
  loadingWrap:   { paddingVertical: 50, alignItems: 'center' },
  empty:         { alignItems: 'center', gap: 10, paddingVertical: 36, paddingHorizontal: 16, backgroundColor: c.surface, borderRadius: 18, borderWidth: 1, borderColor: c.lines },
  emptyTitle:    { fontFamily: theme.fonts.displayBold, fontSize: 15, color: c.ink, textAlign: 'center', marginTop: 4 },
  emptySub:      { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, textAlign: 'center', lineHeight: 17 },
  evidenceRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.lines, padding: 14, marginBottom: 10 },
  evidenceName:  { fontFamily: theme.fonts.bodyBold, fontSize: 13, color: c.ink },
  evidenceMeta:  { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 2 },
  attachChip:    { width: 36, height: 36, borderRadius: 999, backgroundColor: c.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  resolvedCard:  { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.lines, padding: 16, marginBottom: 14 },
  resolvedIcon:  { width: 44, height: 44, borderRadius: 12, backgroundColor: c.navySoft, alignItems: 'center', justifyContent: 'center' },
  resolvedTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.ink },
  resolvedSub:   { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 2 },

  // Action menu sheet
  overlay:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  menuSheet:     { backgroundColor: c.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 12 },
  menuHandle:    { width: 40, height: 4, borderRadius: 2, backgroundColor: c.lines, alignSelf: 'center', marginBottom: 18 },
  menuTitle:     { fontFamily: theme.fonts.displayBold, fontSize: 15, color: c.ink, marginBottom: 16 },
  menuRow:       { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  menuIcon:      { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  menuLabel:     { flex: 1, fontFamily: theme.fonts.bodySemiBold, fontSize: 13 },
  menuDivider:   { height: 1, backgroundColor: c.lines, marginLeft: 56 },
});
