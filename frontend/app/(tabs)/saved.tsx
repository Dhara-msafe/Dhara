import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useAuth, API_BASE } from '@/src/auth';
import { theme } from '@/src/theme';
import { Bookmark, loadLocal, removeBookmark, syncBookmarks } from '@/src/bookmarks';
import { formatDateDMY } from '@/src/dateFormat';

export default function SavedScreen() {
  const { token, user } = useAuth();
  const [items, setItems] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  // Local first (works fully offline), then reconcile with the server.
  const load = useCallback(async () => {
    const local = await loadLocal();
    setItems(local);
    setLoading(false);
    const merged = await syncBookmarks(API_BASE as string, token);
    setItems(merged);
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const onDelete = async (clientId: string) => {
    const next = await removeBookmark(API_BASE as string, token, clientId);
    setItems(next);
  };

  // Guest Mode: saved/bookmarked answers require a registered account.
  if (user?.is_guest) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']} testID="saved-screen">
        <View style={styles.header}>
          <Text style={styles.h1}>Saved answers</Text>
          <Text style={styles.h2}>Kept on this phone — opens without internet</Text>
        </View>
        <View style={styles.empty}>
          <Ionicons name="lock-closed-outline" size={56} color={theme.colors.brandSecondary} />
          <Text style={styles.emptyTitle}>Create a free account</Text>
          <Text style={styles.emptySub}>
            Saving answers is available for registered users. Create a free account to bookmark and keep answers.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']} testID="saved-screen">
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.brand} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="saved-screen">
      <View style={styles.header}>
        <Text style={styles.h1}>Saved answers</Text>
        <Text style={styles.h2}>Kept on this phone — opens without internet</Text>
      </View>

      {items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="bookmark-outline" size={56} color={theme.colors.brandSecondary} />
          <Text style={styles.emptyTitle}>Nothing saved yet</Text>
          <Text style={styles.emptySub}>
            Tap the bookmark icon on any answer to keep it here for offline use.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.client_id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          renderItem={({ item }) => {
            const open = openId === item.client_id;
            return (
              <Pressable
                testID={`saved-${item.client_id}`}
                style={styles.card}
                onPress={() => setOpenId(open ? null : item.client_id)}
              >
                <View style={styles.cardHead}>
                  <Text style={styles.q} numberOfLines={open ? undefined : 2}>{item.question}</Text>
                  <Pressable
                    testID={`saved-delete-${item.client_id}`}
                    hitSlop={12}
                    onPress={() => onDelete(item.client_id)}
                  >
                    <Ionicons name="trash-outline" size={20} color={theme.colors.error} />
                  </Pressable>
                </View>
                <Text style={styles.meta}>
                  {formatDateDMY(item.created_at)}
                  {item.synced ? '' : ' · saved on this phone'}
                </Text>
                <Text style={styles.a} numberOfLines={open ? undefined : 3}>{item.answer}</Text>

                {open && item.citations?.length > 0 && (
                  <View style={styles.cites}>
                    <Text style={styles.citesHead}>📚 Sources</Text>
                    {item.citations.map((c) => (
                      <View key={c.key} style={styles.citeCard}>
                        <View style={styles.citeChip}>
                          <Text style={styles.citeChipText}>{c.short_label}</Text>
                        </View>
                        <Text style={styles.citeTitle}>{c.citation}</Text>
                        <Text style={styles.citeText}>{c.official_text}</Text>
                      </View>
                    ))}
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
  header: { padding: theme.spacing.xl, paddingBottom: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
  h1: { fontFamily: theme.fonts.display, fontSize: 28, color: theme.colors.brand, fontWeight: '700' },
  h2: { color: theme.colors.onSurfaceSecondary, marginTop: 4, fontSize: 13 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xxl },
  emptyTitle: { fontFamily: theme.fonts.display, fontSize: 20, color: theme.colors.brand, marginTop: theme.spacing.lg, fontWeight: '700' },
  emptySub: { color: theme.colors.onSurfaceSecondary, textAlign: 'center', marginTop: theme.spacing.sm, lineHeight: 20 },
  list: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: theme.spacing.xxxl },
  card: { backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.lg, borderWidth: 1, borderColor: theme.colors.border },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.md },
  q: { flex: 1, color: theme.colors.brand, fontWeight: '700', fontSize: 15 },
  meta: { color: theme.colors.onSurfaceTertiary, fontSize: 11, marginTop: 4 },
  a: { color: theme.colors.onSurface, fontSize: 14, lineHeight: 21, marginTop: theme.spacing.sm },
  cites: { marginTop: theme.spacing.md, gap: theme.spacing.sm },
  citesHead: { color: theme.colors.brand, fontWeight: '700', fontSize: 13 },
  citeCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.sm, padding: theme.spacing.md, borderLeftWidth: 3, borderLeftColor: theme.colors.gold },
  citeChip: { alignSelf: 'flex-start', backgroundColor: theme.colors.brand, borderRadius: theme.radius.pill, paddingHorizontal: theme.spacing.md, paddingVertical: 2 },
  citeChipText: { color: theme.colors.onBrandPrimary, fontSize: 11, fontWeight: '800' },
  citeTitle: { color: theme.colors.onSurface, fontWeight: '700', fontSize: 12, marginTop: 6 },
  citeText: { color: theme.colors.onSurfaceSecondary, fontSize: 12, lineHeight: 18, marginTop: 4 },
  expand: { color: theme.colors.brandSecondary, fontSize: 12, fontWeight: '700', marginTop: theme.spacing.md },
});
