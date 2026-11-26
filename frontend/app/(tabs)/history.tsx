import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from 'react-native';
import { crossAlert } from '@/src/utils/crossAlert';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { useAuth, API_BASE } from '@/src/auth';
import { theme } from '@/src/theme';
import { tabBackTarget } from '@/src/tabBackTarget';
import { PageTitleRow } from '@/src/ui/PageTitleRow';
import { UI_V22_ONE_SOS } from '@/src/uiV22Flags';
import { focusRingStyle } from '@/src/a11yFocus';
import { formatDateTimeDMY } from '@/src/dateFormat';

type Session = { id: string; title: string; updated_at: string; language: string };

export default function History() {
  const { token, user } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string }>();

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/chat/sessions`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await r.json();
      setSessions(data);
    } catch {}
    finally { setLoading(false); }
  }, [token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const remove = async (id: string) => {
    crossAlert('Delete conversation?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await fetch(`${API_BASE}/api/chat/sessions/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
        setSessions(s => s.filter(x => x.id !== id));
      } },
    ]);
  };

  // Guest Mode: persistent chat history requires a registered account.
  if (user?.is_guest) {
    return (
      <SafeAreaView style={styles.safe} edges={[]} testID="history-screen">
        <PageTitleRow title="Your Conversations" subtitle="Every question you've asked, saved." onBack={() => router.navigate(tabBackTarget(from) as any)} backTestID="history-back" testID="history-title" />
        <View style={styles.empty}>
          <Ionicons name="lock-closed-outline" size={64} color={theme.colors.brandSecondary} />
          <Text style={styles.emptyTitle}>Create a free account</Text>
          <Text style={styles.emptySub}>Saved conversation history is available for registered users.</Text>
          <Pressable testID="guest-history-signup-btn" style={styles.startBtn} onPress={() => router.push('/signup')}>
            <Text style={styles.startBtnText}>Create Free Account</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={[]} testID="history-screen">
      <PageTitleRow title="Your Conversations" subtitle="Every question you've asked, saved." onBack={() => router.navigate(tabBackTarget(from) as any)} backTestID="history-back" testID="history-title" />
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.colors.brand} /></View>
      ) : sessions.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="chatbubbles-outline" size={64} color={theme.colors.brandSecondary} />
          <Text style={styles.emptyTitle}>No conversations yet</Text>
          <Text style={styles.emptySub}>Ask your first legal question on the Ask tab.</Text>
          <Pressable testID="start-chat-btn" style={styles.startBtn} onPress={() => router.push('/(tabs)')}>
            <Text style={styles.startBtnText}>Start asking</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={i => i.id}
          contentContainerStyle={{ padding: theme.spacing.lg }}
          renderItem={({ item }) => (
            <Pressable testID={`session-${item.id}`} style={styles.row} onPress={() => router.push(`/session/${item.id}`)}>
              <Ionicons name="document-text-outline" size={22} color={theme.colors.brand} />
              <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
                <Text style={styles.title} numberOfLines={2}>{item.title || 'Untitled'}</Text>
                <Text style={styles.meta}>{formatDateTimeDMY(item.updated_at)}</Text>
              </View>
              <Pressable testID={`delete-${item.id}`} onPress={() => remove(item.id)} hitSlop={10}>
                <Ionicons name="trash-outline" size={20} color={theme.colors.error} />
              </Pressable>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.surface },
  // 22 Nov (Vivek): this hidden tab had no way back. The arrow goes to the
  // screen that opened it (src/tabBackTarget.ts), Me by default.
  // Keeps the heading clear of the floating top-right SOS, which only shows
  // when UI_V22_ONE_SOS is off (release builds have one SOS, at the bottom).
  titleRow: { flexDirection: 'row', alignItems: 'center', paddingRight: UI_V22_ONE_SOS ? 0 : 92 },
  backBtn: { width: 36, height: 40, marginLeft: -8, alignItems: 'flex-start', justifyContent: 'center' },
  // Subtitle starts under the heading text, not under the arrow.
  h2Indented: { marginLeft: 28 },
  header: { padding: theme.spacing.xl, paddingBottom: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
  h1: { flexShrink: 1, fontFamily: theme.fonts.display, fontSize: 24, color: theme.colors.brand, fontWeight: '700' },
  h2: { color: theme.colors.onSurfaceSecondary, marginTop: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xl },
  emptyTitle: { fontFamily: theme.fonts.display, fontSize: 17, color: theme.colors.onSurface, marginTop: theme.spacing.lg, fontWeight: '700' },
  emptySub: { color: theme.colors.onSurfaceSecondary, marginTop: theme.spacing.sm, textAlign: 'center' },
  startBtn: { backgroundColor: theme.colors.brand, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md, marginTop: theme.spacing.xl },
  startBtnText: { color: theme.colors.onBrandPrimary, fontFamily: 'InterBold'},
  row: { flexDirection: 'row', alignItems: 'center', padding: theme.spacing.lg, backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.md, marginBottom: theme.spacing.sm, borderWidth: 1, borderColor: theme.colors.border },
  title: { color: theme.colors.onSurface, fontSize: 13, fontFamily: 'InterSemiBold'},
  meta: { color: theme.colors.onSurfaceTertiary, fontFamily: 'Inter', fontSize: 12, marginTop: 2 },
});
