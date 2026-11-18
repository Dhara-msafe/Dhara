/**
 * Guest Recovery Modal
 * --------------------
 * Shown once per new guest session when the device holds encrypted recordings
 * from one or more previous guest sessions.
 *
 * Design decisions (Q1–Q3 answers, Jun 2026):
 *   Q1: Show full list (filenames, durations, dates) — not just count.
 *   Q2: Each prior session shown separately; user picks per-session.
 *   Q3: "Keep" → data stays intact under original scope, accessible here.
 *       (The Evidence Locker shows the CURRENT session only; multi-scope
 *        display is a planned future enhancement.)
 *
 * Deletion order inside "Discard":
 *   .enc files → AsyncStorage manifest keys → SecureStore AES key →
 *   registry entry  (key always last, matching evidenceGC.ts contract).
 *
 * This component is intentionally read-only about the evidence contents —
 * it never decrypts or plays back recordings.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, Modal, ScrollView, Pressable, StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { crossAlert } from '@/src/utils/crossAlert';
import { listAllGuestScopes, removeGuestScopeEntry } from '@/src/women/guestScopeRegistry';
import { loadVisibleRecordings, deleteEvidenceScope } from '@/src/women/evidenceStore';
import { deleteEvidenceKey } from '@/src/women/evidenceCrypto';
import type { RecordingItem } from '@/src/women/evidenceStore';
import type { GuestScopeEntry } from '@/src/women/guestScopeRegistry';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return '';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec} sec`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec > 0 ? `${min} min ${sec} sec` : `${min} min`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const day = d.getDate();
    const month = d.toLocaleString('en-GB', { month: 'short' });
    const year = d.getFullYear();
    const h = d.getHours() % 12 || 12;
    const m = String(d.getMinutes()).padStart(2, '0');
    const ampm = d.getHours() < 12 ? 'AM' : 'PM';
    return `${day} ${month} ${year}, ${h}:${m} ${ampm}`;
  } catch {
    return iso.slice(0, 10);
  }
}

function formatSessionDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}

function typeInfo(item: RecordingItem): { icon: string; label: string } {
  if (item.type === 'photo')  return { icon: 'image-outline',    label: 'Photo' };
  if (item.type === 'video')  return { icon: 'videocam-outline',  label: 'Video' };
  return                             { icon: 'mic-outline',        label: 'Voice recording' };
}

// ── Types ─────────────────────────────────────────────────────────────────────

type ScopeData = {
  entry: GuestScopeEntry;
  recordings: RecordingItem[];
};

// ── Sub-components ────────────────────────────────────────────────────────────

function RecordingRow({ item, index }: { item: RecordingItem; index: number }) {
  const { icon, label } = typeInfo(item);
  const duration = item.total_duration_ms ? formatDuration(item.total_duration_ms) : '';
  const dateStr  = formatDate(item.createdAt);
  const displayLabel = duration ? `${label} · ${duration}` : label;

  return (
    <View style={rowStyles.row} testID={`recovery-rec-${item.id}`}>
      <View style={rowStyles.iconWrap}>
        <Ionicons
          name={icon as any}
          size={18}
          color={theme.colors.brandSecondary}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={rowStyles.label} numberOfLines={1}>{displayLabel}</Text>
        <Text style={rowStyles.date}>{dateStr}</Text>
      </View>
      <Text style={rowStyles.index}>#{index + 1}</Text>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.lines,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: theme.colors.surfaceTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 14, fontWeight: '600', color: theme.colors.navy, lineHeight: 20 },
  date:  { fontSize: 12, color: theme.colors.muted, marginTop: 1 },
  index: { fontSize: 11, color: theme.colors.muted, fontVariant: ['tabular-nums'] },
});

// ── Session card ──────────────────────────────────────────────────────────────

function SessionCard({
  scopeData,
  onKept,
  onDiscarded,
}: {
  scopeData: ScopeData;
  onKept: (scope: string) => void;
  onDiscarded: (scope: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const { entry, recordings } = scopeData;
  const count   = recordings.length;
  const typeSet = [...new Set(recordings.map(r => r.type))];
  const typeStr = typeSet.map(t => t === 'audio' ? 'voice' : t).join(', ');

  const handleDiscard = useCallback(() => {
    crossAlert(
      'Delete these recordings?',
      `This will permanently delete ${count} recording${count !== 1 ? 's' : ''} from ${formatSessionDate(entry.createdAt)}.\n\nThis cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete permanently',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              // Deletion order: files → manifest keys → AES key → registry
              await deleteEvidenceScope(entry.scope);
              await deleteEvidenceKey(entry.scope);
              await removeGuestScopeEntry(entry.scope);
              onDiscarded(entry.scope);
            } catch {
              setDeleting(false);
              crossAlert(
                'Could not delete',
                'An error occurred. Please try again.',
              );
            }
          },
        },
      ],
    );
  }, [entry.scope, entry.createdAt, count, onDiscarded]);

  const handleKeep = useCallback(() => {
    onKept(entry.scope);
  }, [entry.scope, onKept]);

  return (
    <View style={cardStyles.card} testID={`recovery-session-${entry.scope.slice(0, 8)}`}>
      {/* ── Card header ── */}
      <View style={cardStyles.header}>
        <View style={cardStyles.headerIcon}>
          <Ionicons name="lock-closed-outline" size={16} color={theme.colors.brandSecondary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={cardStyles.sessionTitle}>
            Session from {formatSessionDate(entry.createdAt)}
          </Text>
          <Text style={cardStyles.sessionMeta}>
            {count} recording{count !== 1 ? 's' : ''}{typeStr ? ` · ${typeStr}` : ''}
          </Text>
        </View>
      </View>

      {/* ── Recording list ── */}
      <View style={cardStyles.list}>
        {recordings.map((rec, idx) => (
          <RecordingRow key={rec.id} item={rec} index={idx} />
        ))}
      </View>

      {/* ── Keep note ── */}
      <Text style={cardStyles.keepNote}>
        These recordings are encrypted and stored only on this device.
        No one else can access them.
      </Text>

      {/* ── Action buttons ── */}
      {deleting ? (
        <View style={cardStyles.deletingRow}>
          <ActivityIndicator color={theme.colors.error} size="small" />
          <Text style={cardStyles.deletingText}>Deleting…</Text>
        </View>
      ) : (
        <View style={cardStyles.actions}>
          <Pressable
            testID={`recovery-keep-${entry.scope.slice(0, 8)}`}
            style={cardStyles.keepBtn}
            onPress={handleKeep}
            accessibilityRole="button"
            accessibilityLabel="Keep these recordings"
          >
            <Ionicons name="shield-checkmark-outline" size={16} color={theme.colors.navy} />
            <Text style={cardStyles.keepBtnText}>Keep</Text>
          </Pressable>
          <Pressable
            testID={`recovery-discard-${entry.scope.slice(0, 8)}`}
            style={cardStyles.discardBtn}
            onPress={handleDiscard}
            accessibilityRole="button"
            accessibilityLabel="Discard and delete these recordings"
          >
            <Ionicons name="trash-outline" size={16} color={theme.colors.error} />
            <Text style={cardStyles.discardBtnText}>Discard</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    marginBottom: theme.spacing.lg,
    borderWidth: 1.5,
    borderColor: theme.colors.lines,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceSecondary,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.lines,
  },
  headerIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: theme.colors.surfaceTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.colors.navy,
    lineHeight: 20,
  },
  sessionMeta: {
    fontSize: 12,
    color: theme.colors.muted,
    marginTop: 2,
  },
  list: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
  },
  keepNote: {
    fontSize: 12,
    color: theme.colors.muted,
    lineHeight: 17,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
  },
  actions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.lg,
  },
  keepBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.navySoft,
    borderWidth: 1,
    borderColor: theme.colors.lines,
    minHeight: 44,
  },
  keepBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.colors.navy,
  },
  discardBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: theme.radius.md,
    backgroundColor: '#FFF1F0',
    borderWidth: 1,
    borderColor: '#FECDD3',
    minHeight: 44,
  },
  discardBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.colors.error,
  },
  deletingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: theme.spacing.lg,
  },
  deletingText: {
    fontSize: 14,
    color: theme.colors.error,
    fontWeight: '600',
  },
});

// ── Main component ────────────────────────────────────────────────────────────

type Props = {
  visible: boolean;
  currentScope: string;        // current guest session's scope — excluded from list
  onClose: () => void;
};

export function GuestRecoveryModal({ visible, currentScope, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [loading,  setLoading]  = useState(false);
  const [scopes,   setScopes]   = useState<ScopeData[]>([]);
  const loadedRef = useRef(false);

  // Load prior scopes + their recordings on first open
  useEffect(() => {
    if (!visible || loadedRef.current) return;
    loadedRef.current = true;

    setLoading(true);
    void (async () => {
      try {
        const all = await listAllGuestScopes();
        // Filter out the current active session
        const prior = all.filter(e => e.scope !== currentScope);

        const withRecs: ScopeData[] = [];
        for (const entry of prior) {
          try {
            const recs = await loadVisibleRecordings(entry.scope);
            if (recs.length > 0) {
              withRecs.push({ entry, recordings: recs });
            }
          } catch {
            // Scope unreadable — skip silently; never block recovery of others
          }
        }

        // Sort: most recently seen first
        withRecs.sort(
          (a, b) =>
            new Date(b.entry.lastSeenAt).getTime() -
            new Date(a.entry.lastSeenAt).getTime(),
        );

        setScopes(withRecs);
      } catch {
        setScopes([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [visible, currentScope]);

  const handleKept = useCallback((scope: string) => {
    // Keep means do nothing — data remains intact.  Remove from the visible
    // list so the user gets a clean "acknowledged" feeling within this session.
    // The scope stays in the registry, so the prompt will appear on the next
    // new guest session as a reminder.
    setScopes(prev => prev.filter(s => s.entry.scope !== scope));
  }, []);

  const handleDiscarded = useCallback((scope: string) => {
    // Deletion already completed in SessionCard — just remove from view.
    setScopes(prev => prev.filter(s => s.entry.scope !== scope));
  }, []);

  // Auto-close once all sessions have been handled
  useEffect(() => {
    if (!loading && scopes.length === 0 && loadedRef.current) {
      // Brief pause so user sees empty state before dismiss
      const t = setTimeout(onClose, 600);
      return () => clearTimeout(t);
    }
  }, [loading, scopes.length, onClose]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      testID="guest-recovery-modal"
    >
      <SafeAreaView style={modal.safe} edges={['top', 'bottom']}>
        {/* ── Header ── */}
        <View style={modal.topbar}>
          <View style={modal.topbarIcon}>
            <Ionicons name="lock-closed" size={18} color={theme.colors.brandSecondary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={modal.topbarTitle} numberOfLines={1}>
              Prior recordings found
            </Text>
            <Text style={modal.topbarSub} numberOfLines={1}>
              Encrypted · stored only on this device
            </Text>
          </View>
          <Pressable
            testID="recovery-modal-close"
            onPress={onClose}
            style={modal.closeBtn}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={12}
          >
            <Ionicons name="close" size={22} color={theme.colors.muted} />
          </Pressable>
        </View>

        {/* ── Body ── */}
        {loading ? (
          <View style={modal.center}>
            <ActivityIndicator color={theme.colors.brand} size="large" />
            <Text style={modal.loadingText}>Loading prior sessions…</Text>
          </View>
        ) : scopes.length === 0 ? (
          <View style={modal.center} testID="recovery-empty">
            <Ionicons name="checkmark-circle-outline" size={48} color={theme.colors.muted} />
            <Text style={modal.emptyTitle}>All done</Text>
            <Text style={modal.emptyText}>No prior sessions remain.</Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={[modal.scroll, { paddingBottom: insets.bottom + 24 }]}
            showsVerticalScrollIndicator={false}
          >
            <Text style={modal.intro}>
              {scopes.length === 1
                ? 'You have encrypted recordings from 1 previous session on this device.'
                : `You have encrypted recordings from ${scopes.length} previous sessions on this device.`}
              {'\n'}Choose what to do with each one.
            </Text>

            {scopes.map(sd => (
              <SessionCard
                key={sd.entry.scope}
                scopeData={sd}
                onKept={handleKept}
                onDiscarded={handleDiscarded}
              />
            ))}

            <Pressable
              testID="recovery-done-btn"
              style={modal.doneBtn}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Done"
            >
              <Text style={modal.doneBtnText}>Done</Text>
            </Pressable>
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const modal = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: theme.colors.cream,
  },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1.5,
    borderBottomColor: theme.colors.lines,
  },
  topbarIcon: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topbarTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.navy,
    lineHeight: 20,
  },
  topbarSub: {
    fontSize: 12,
    color: theme.colors.muted,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceSecondary,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  loadingText: {
    fontSize: 15,
    color: theme.colors.muted,
    marginTop: theme.spacing.md,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: theme.colors.navy,
  },
  emptyText: {
    fontSize: 15,
    color: theme.colors.muted,
    textAlign: 'center',
  },
  scroll: {
    padding: theme.spacing.lg,
  },
  intro: {
    fontSize: 14,
    color: theme.colors.muted,
    lineHeight: 20,
    marginBottom: theme.spacing.lg,
  },
  doneBtn: {
    backgroundColor: theme.colors.navy,
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
    marginTop: theme.spacing.sm,
  },
  doneBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
