import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth, API_BASE } from '@/src/auth';
import { theme } from '@/src/theme';
import { ADVOCATE_MODE_ENABLED } from '@/src/advocateMode/flags';

const NAVY = theme.colors.primary;
const GOLD = theme.colors.gold;

export default function LawyerHome() {
  // B-97: advocate/lawyer features are hidden for Wave 1 per D-14 -- this
  // must hold even on a direct URL hit or a refresh, not just when reached
  // via the (now-hidden) in-app links.
  if (!ADVOCATE_MODE_ENABLED) return <Redirect href="/(tabs)/home" />;

  const { token, user } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id || !token) return;
    fetch(`${API_BASE}/api/advocate/profile/${user.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(setProfile)
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, [user?.id, token]);

  const cards = [
    {
      icon: 'people-outline' as const,
      title: 'Client Intakes',
      sub: 'Send a link, receive a structured brief',
      onPress: () => router.push('/intakes' as any),
    },
    {
      icon: 'library-outline' as const,
      title: 'Legal Research',
      sub: 'Professional-format answers from the full corpus',
      onPress: () => router.push({ pathname: '/(tabs)' as any, params: { mode: 'pro' } }),
    },
    {
      icon: 'checkmark-circle-outline' as const,
      title: 'Verify an Answer',
      sub: 'Review flagged answers in your specialization',
      onPress: () => router.push('/verify-queue' as any),
    },
  ];

  return (
    <SafeAreaView style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Lawyer Mode</Text>
          {loading
            ? null
            : profile?.verified
              ? <View style={s.badge}><Text style={s.badgeText}>✓ Reviewed</Text></View>
              : <Text style={s.pending}>Pending Review</Text>}
        </View>
        <Pressable onPress={() => router.push('/(tabs)/settings' as any)} style={s.settingsBtn}>
          <Ionicons name="person-circle-outline" size={28} color={GOLD} />
        </Pressable>
      </View>

      {loading && !profile ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color={NAVY} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.scroll}>
          {cards.map(card => (
            <Pressable key={card.title} style={s.card} onPress={card.onPress}>
              <View style={s.cardIcon}>
                <Ionicons name={card.icon} size={26} color={NAVY} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle}>{card.title}</Text>
                <Text style={s.cardSub}>{card.sub}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
            </Pressable>
          ))}

          <Pressable style={s.backBtn} onPress={() => router.push('/(tabs)' as any)}>
            <Ionicons name="arrow-back-outline" size={18} color={NAVY} />
            <Text style={s.backBtnText}>Back to Citizen Mode</Text>
          </Pressable>
        </ScrollView>
      )}

      {/* Custom bottom tabs */}
      <View style={s.tabBar}>
        <Pressable style={s.tabItem}>
          <Ionicons name="home" size={22} color={NAVY} />
          <Text style={[s.tabLabel, { color: NAVY }]}>Lawyer Mode</Text>
        </Pressable>
        <Pressable style={s.tabItem} onPress={() => router.push('/(tabs)/settings' as any)}>
          <Ionicons name="person-outline" size={22} color="#9CA3AF" />
          <Text style={s.tabLabel}>Account</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#FDFBF7' },
  header: { backgroundColor: NAVY, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 14, paddingBottom: 16 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#fff' },
  badge: { marginTop: 4, backgroundColor: GOLD, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '700', color: NAVY },
  pending: { fontSize: 12, color: '#9CA3AF', marginTop: 4 },
  settingsBtn: { padding: 4 },
  scroll: { padding: 20, gap: 14, paddingBottom: 80 },
  card: {
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1, borderColor: '#E5E7EB',
    padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardIcon: { width: 48, height: 48, borderRadius: 12, backgroundColor: '#EEF2FF', alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 16, fontWeight: '700', color: NAVY, marginBottom: 3 },
  cardSub:   { fontSize: 13, color: '#6B7280', lineHeight: 18 },
  backBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12, paddingVertical: 12 },
  backBtnText: { fontSize: 14, color: NAVY, fontWeight: '600' },
  tabBar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#E5E7EB', backgroundColor: '#fff', paddingBottom: 20, paddingTop: 8 },
  tabItem: { flex: 1, alignItems: 'center', gap: 3 },
  tabLabel: { fontSize: 11, fontWeight: '600', color: '#9CA3AF' },
});
