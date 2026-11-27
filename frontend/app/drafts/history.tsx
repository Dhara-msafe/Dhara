import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { crossAlert } from '@/src/utils/crossAlert';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { theme } from '@/src/theme';
import { PageTitleRow } from '@/src/ui/PageTitleRow';
import { draftByType } from '@/src/drafts';
import { DraftHistoryItem, loadHistory, removeFromHistory } from '@/src/draftHistory';
import { formatDateDMY } from '@/src/dateFormat';

import { shareExternal } from '@/src/outbound';
// NF-UI-REV-10 (Group I, DHARA UI Revision v2.2.1): presentation-only
// rollback flag + visible keyboard-focus ring + missing a11y labels.
// Also fixes a nested-Pressable structural issue (delete button was a
// Pressable inside the card's toggle Pressable) — restructured as siblings,
// same visual layout, same onCopy/onShare/onDelete/toggle logic.
import { UI_REVISION_V1 } from '@/src/designRevision';
import { focusRingStyle } from '@/src/a11yFocus';
/** Every notice a user generated, kept on-device so it can be reopened,
 * edited (copy → paste into a fresh form) and re-sent later without
 * spending another draft from the free/Pro quota. */
export default function DraftHistoryScreen() {
  const router = useRouter();
  const [items, setItems] = useState<DraftHistoryItem[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setItems(await loadHistory());
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onCopy = async (item: DraftHistoryItem) => {
    await Clipboard.setStringAsync(item.text);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const onShare = async (item: DraftHistoryItem) => {
    try { await shareExternal({ message: item.text }); } catch {}
  };

  const onDelete = (item: DraftHistoryItem) => {
    crossAlert('Delete this notice?', 'This only removes it from your history on this phone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setItems(await removeFromHistory(item.id));
          if (openId === item.id) setOpenId(null);
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={[]} testID="draft-history-screen">
      <PageTitleRow title="Notice history" onBack={() => router.back()} backTestID="draft-history-back" testID="draft-history-title-row" />

      {items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="document-text-outline" size={56} color={theme.colors.brandSecondary} />
          <Text style={styles.emptyTitle}>No notices yet</Text>
          <Text style={styles.emptySub}>
            Every notice you write is saved here on this phone so you can reopen and resend it later.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const open = openId === item.id;
            const spec = draftByType(item.type);
            const toggle = () => setOpenId(open ? null : item.id);
            // B-100: day-first date (14/11/2026), not the browser's month-first default.
            const dateStr = `${formatDateDMY(item.created_at)} · ${new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
            return (
              <View testID={`draft-history-${item.id}`} style={styles.card}>
                <View style={styles.cardHead}>
                  <View style={styles.iconWrap}>
                    <Ionicons name={spec?.icon || 'document-text-outline'} size={18} color={theme.colors.brand} />
                  </View>
                  {/* NF-UI-REV-10: this Pressable and the delete button below are
                      siblings, not nested — fixes a pre-existing nested-button
                      structural issue (the delete button used to live inside
                      this same toggle Pressable). */}
                  <Pressable
                    style={(s) => [{ flex: 1 }, focusRingStyle(s)]}
                    onPress={toggle}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.title}, ${dateStr}. ${open ? 'Tap to collapse' : 'Tap to read in full'}`}
                    accessibilityState={{ expanded: open }}
                  >
                    <Text style={styles.title}>{item.title}</Text>
                    <Text style={styles.meta}>{dateStr}</Text>
                  </Pressable>
                  <Pressable
                    testID={`draft-history-delete-${item.id}`}
                    hitSlop={12}
                    style={(s) => [focusRingStyle(s)]}
                    onPress={() => onDelete(item)}
                    accessibilityRole="button"
                    accessibilityLabel="Delete this notice"
                  >
                    <Ionicons name="trash-outline" size={20} color={theme.colors.error} />
                  </Pressable>
                </View>

                <Pressable onPress={toggle} style={(s) => [focusRingStyle(s)]} accessibilityRole="button" accessibilityLabel={open ? 'Tap to collapse' : 'Tap to read in full'} accessibilityState={{ expanded: open }}>
                  <Text style={styles.preview} numberOfLines={open ? undefined : 3}>{item.text}</Text>

                  <Text style={styles.expand}>{open ? 'Tap to collapse' : 'Tap to read in full'}</Text>
                </Pressable>

                {open && (
                  <View style={styles.actionRow}>
                    <Pressable
                      testID={`draft-history-copy-${item.id}`}
                      style={(s) => [styles.secondaryBtn, focusRingStyle(s)]}
                      onPress={() => onCopy(item)}
                      accessibilityRole="button"
                      accessibilityLabel={copiedId === item.id ? 'Copied' : 'Copy notice text'}
                    >
                      <Ionicons name={copiedId === item.id ? 'checkmark' : 'copy-outline'} size={16} color={theme.colors.brand} />
                      <Text style={styles.secondaryBtnText}>{copiedId === item.id ? 'Copied' : 'Copy'}</Text>
                    </Pressable>
                    <Pressable
                      testID={`draft-history-share-${item.id}`}
                      style={(s) => [styles.primaryBtn, focusRingStyle(s)]}
                      onPress={() => onShare(item)}
                      accessibilityRole="button"
                      accessibilityLabel="Send again"
                    >
                      <Ionicons name="share-social-outline" size={16} color={theme.colors.onBrandSecondary} />
                      <Text style={styles.primaryBtnText}>Send again</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg, paddingVertical: 12, backgroundColor: theme.colors.background, borderBottomWidth: 1, borderBottomColor: theme.colors.lines,
  },
  h1: { fontFamily: theme.fonts.display, fontSize: 16, color: theme.colors.ink, fontWeight: '700' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xxl },
  emptyTitle: { fontFamily: theme.fonts.display, fontSize: 17, color: theme.colors.brand, marginTop: theme.spacing.lg, fontWeight: '700' },
  emptySub: { color: theme.colors.onSurfaceSecondary, textAlign: 'center', marginTop: theme.spacing.sm, lineHeight: 18 },
  list: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: theme.spacing.xxxl },
  card: { backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.lg, borderWidth: 1, borderColor: theme.colors.border },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  iconWrap: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border,
  },
  title: { color: theme.colors.brand, fontFamily: 'InterBold', fontSize: 13 },
  meta: {
    // NF-UI-REV-10: onSurfaceTertiary on this card's surfaceSecondary
    // background measured ~4.03:1 — under 4.5:1. onSurfaceSecondary
    // (the darker token) clears ~6:1.
    color: UI_REVISION_V1 ? theme.colors.onSurfaceSecondary : theme.colors.onSurfaceTertiary,
    fontFamily: 'Inter', fontSize: 12, marginTop: 2,
  },
  preview: { color: theme.colors.onSurface, fontFamily: 'Inter', fontSize: 12, lineHeight: 17, marginTop: theme.spacing.sm },
  actionRow: { flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.md },
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 2, borderColor: theme.colors.brand, borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md, minHeight: UI_REVISION_V1 ? 48 : 40, flex: 1,
  },
  secondaryBtnText: { color: theme.colors.brand, fontFamily: 'InterExtraBold', fontSize: 12 },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: theme.colors.brandSecondary, borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md, minHeight: UI_REVISION_V1 ? 48 : 40, flex: 1,
  },
  primaryBtnText: { color: theme.colors.onBrandSecondary, fontFamily: 'InterExtraBold', fontSize: 12 },
  expand: { color: theme.colors.brandSecondary, fontSize: 12, fontFamily: 'InterBold', marginTop: theme.spacing.md },
});
