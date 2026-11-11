/**
 * Screen 2 — Matter detail: lists consultations within this matter and
 * lets the advocate start a new one.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect, useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { apiGet } from '@/src/notetaker/api';
import { ScreenHeader, StatusPill } from '@/src/notetaker/ui';
import type { Consultation } from '@/src/notetaker/api';

const c = theme.colors;

interface Matter { id: string; title: string; client_ref: string | null; consultation_count: number; }

export default function MatterDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const matterId = String(id);
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [matter, setMatter] = useState<Matter | null>(null);
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token || !matterId) return;
    try {
      const [m, cs] = await Promise.all([
        apiGet<Matter>(token, `/matters/${matterId}`),
        apiGet<Consultation[]>(token, `/matters/${matterId}/consultations`),
      ]);
      setMatter(m);
      setConsultations(cs);
    } catch {
      // keep previous state; list simply stays empty/stale on transient errors
    }
    setLoading(false);
  }, [token, matterId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const goNew = () => router.push({ pathname: '/notetaker/consultation/new', params: { matterId } });

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <ScreenHeader
        title={matter?.title || 'Matter'}
        subtitle={matter?.client_ref || undefined}
        right={
          <Pressable style={styles.newBtn} onPress={goNew} accessibilityLabel="New consultation">
            <Text style={styles.newBtnText}>+ New</Text>
          </Pressable>
        }
      />
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={c.navy} size="large" /></View>
      ) : consultations.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>🗒️</Text>
          <Text style={styles.emptyTitle}>No consultations yet</Text>
          <Text style={styles.emptyBody}>Start a consultation to begin notetaking for this matter.</Text>
          <Pressable style={styles.ctaBtn} onPress={goNew}>
            <Text style={styles.ctaBtnText}>Start a consultation</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={consultations}
          keyExtractor={item => item.id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          renderItem={({ item }) => (
            <Pressable
              style={styles.card}
              onPress={() => router.push(`/notetaker/consultation/${item.id}`)}
              accessibilityLabel={`Open consultation ${item.title}`}
            >
              <View style={styles.cardRow}>
                <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.cardArrow}>›</Text>
              </View>
              <Text style={styles.cardMeta} numberOfLines={1}>{item.date}  ·  {item.purpose}</Text>
              <View style={{ marginTop: 8, alignSelf: 'flex-start' }}>
                <StatusPill state={item.state} />
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  newBtn: { backgroundColor: c.gold, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
  newBtnText: { color: c.navy, fontFamily: theme.fonts.bodySemiBold, fontSize: 13 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontFamily: theme.fonts.bodySemiBold, fontSize: 20, color: c.navy, marginBottom: 8 },
  emptyBody: { fontFamily: theme.fonts.body, fontSize: 15, color: c.muted, textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  ctaBtn: { backgroundColor: c.navy, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12 },
  ctaBtnText: { color: '#fff', fontFamily: theme.fonts.bodySemiBold, fontSize: 16 },
  card: {
    backgroundColor: c.surface, borderRadius: 14, padding: 16,
    shadowColor: c.shadow, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center' },
  cardTitle: { flex: 1, fontFamily: theme.fonts.bodySemiBold, fontSize: 16, color: c.navy },
  cardArrow: { color: c.muted, fontSize: 22 },
  cardMeta: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, marginTop: 6 },
});
