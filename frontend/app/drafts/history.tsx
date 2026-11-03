import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { crossAlert } from '@/src/utils/crossAlert';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { theme } from '@/src/theme';
import { draftByType } from '@/src/drafts';
import { DraftHistoryItem, loadHistory, removeFromHistory } from '@/src/draftHistory';

import { shareExternal } from '@/src/outbound';
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
    <SafeAreaView style={styles.safe} edges={['top']} testID="draft-history-screen">
      <View style={styles.header}>
        <Pressable testID="draft-history-back" onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={theme.colors.onBrandPrimary} />
        </Pressable>
        <Text style={styles.h1}>Notice history</Text>
        <View style={{ width: 26 }} />
      </View>

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
            return (
              <Pressable
                testID={`draft-history-${item.id}`}
                style={styles.card}
                onPress={() => setOpenId(open ? null : item.id)}
              >
                <View style={styles.cardHead}>
                  <View style={styles.iconWrap}>
                    <Ionicons name={spec?.icon || 'document-text-outline'} size={18} color={theme.colors.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title}>{item.title}</Text>
                    <Text style={styles.meta}>
                      {new Date(item.created_at).toLocaleDateString()} ·{' '}
                      {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                  <Pressable
                    testID={`draft-history-delete-${item.id}`}
                    hitSlop={12}
                    onPress={(e) => { e.stopPropagation?.(); onDelete(item); }}
                  >
                    <Ionicons name="trash-outline" size={20} color={theme.colors.error} />
                  </Pressable>
                </View>

                <Text style={styles.preview} numberOfLines={open ? undefined : 3}>{item.text}</Text>

                {open && (
                  <View style={styles.actionRow}>
                    <Pressable
                      testID={`draft-history-copy-${item.id}`}
                      style={styles.secondaryBtn}
                      onPress={() => onCopy(item)}
                    >
                      <Ionicons name={copiedId === item.id ? 'checkmark' : 'copy-outline'} size={16} color={theme.colors.brand} />
                      <Text style={styles.secondaryBtnText}>{copiedId === item.id ? 'Copied' : 'Copy'}</Text>
                    </Pressable>
                    <Pressable
                      testID={`draft-history-share-${item.id}`}
                      style={styles.primaryBtn}
                      onPress={() => onShare(item)}
                    >
                      <Ionicons name="share-social-outline" size={16} color={theme.colors.onBrandSecondary} />
                      <Text style={styles.primaryBtnText}>Send again</Text>
                    </Pressable>
                  </View>
                )}

                <Text style={styles.expand}>{open ? 'Tap to collapse' : 'Tap to read in full'}</Text>
              </Pressable>
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
    padding: theme.spacing.lg, backgroundColor: theme.colors.brand,
  },
  h1: { fontFamily: theme.fonts.display, fontSize: 18, color: theme.colors.onBrandPrimary, fontWeight: '700' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xxl },
  emptyTitle: { fontFamily: theme.fonts.display, fontSize: 20, color: theme.colors.brand, marginTop: theme.spacing.lg, fontWeight: '700' },
  emptySub: { color: theme.colors.onSurfaceSecondary, textAlign: 'center', marginTop: theme.spacing.sm, lineHeight: 20 },
  list: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: theme.spacing.xxxl },
  card: { backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.lg, borderWidth: 1, borderColor: theme.colors.border },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  iconWrap: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border,
  },
  title: { color: theme.colors.brand, fontWeight: '700', fontSize: 14 },
  meta: { color: theme.colors.onSurfaceTertiary, fontSize: 11, marginTop: 2 },
  preview: { color: theme.colors.onSurface, fontSize: 13, lineHeight: 19, marginTop: theme.spacing.sm },
  actionRow: { flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.md },
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 2, borderColor: theme.colors.brand, borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md, minHeight: 40, flex: 1,
  },
  secondaryBtnText: { color: theme.colors.brand, fontWeight: '800', fontSize: 13 },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: theme.colors.brandSecondary, borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md, minHeight: 40, flex: 1,
  },
  primaryBtnText: { color: theme.colors.onBrandSecondary, fontWeight: '800', fontSize: 13 },
  expand: { color: theme.colors.brandSecondary, fontSize: 12, fontWeight: '700', marginTop: theme.spacing.md },
});
