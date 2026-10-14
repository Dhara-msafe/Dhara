/**
 * Advocate tab — entry point for Lawyer Mode.
 * • Not registered: shows prompt to register as advocate.
 * • Registered: shows the advocate dashboard.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth, API_BASE } from '@/src/auth';
import { theme } from '@/src/theme';

const NAVY = theme.colors.primary;
const GOLD = theme.colors.gold;

export default function AdvocateTab() {
  const { token, user } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<any | null | 'none'>('loading');

  const loadProfile = useCallback(async () => {
    if (!user?.id || !token) return;
    try {
      const r = await fetch(`${API_BASE}/api/advocate/profile/${user.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        setProfile(await r.json());
      } else {
        setProfile('none');
      }
    } catch {
      setProfile('none');
    }
  }, [user?.id, token]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  if (profile === 'loading') {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.header}>
          <Text style={s.headerTitle}>Lawyer Mode</Text>
        </View>
        <View style={s.center}>
          <ActivityIndicator color={NAVY} />
        </View>
      </SafeAreaView>
    );
  }

  if (profile === 'none') {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.header}>
          <Text style={s.headerTitle}>Lawyer Mode</Text>
        </View>
        <ScrollView contentContainerStyle={s.registerContainer}>
          <View style={s.iconWrap}>
            <Ionicons name="briefcase-outline" size={52} color={NAVY} />
          </View>
          <Text style={s.registerTitle}>Advocate Door</Text>
          <Text style={s.registerSub}>
            Register as a licensed advocate to access professional-grade legal research,
            client intake management, and formal case briefs.
          </Text>

          <View style={s.featureList}>
            {[
              { icon: 'people-outline', text: 'Send secure intake links to clients' },
              { icon: 'document-text-outline', text: 'Receive AI-summarised case briefs' },
              { icon: 'library-outline', text: 'Professional legal research with section citations' },
            ].map(f => (
              <View key={f.text} style={s.featureRow}>
                <Ionicons name={f.icon as any} size={20} color={GOLD} />
                <Text style={s.featureText}>{f.text}</Text>
              </View>
            ))}
          </View>

          <Pressable style={s.registerBtn} onPress={() => router.push('/advocate-register' as any)}>
            <Text style={s.registerBtnText}>Register as Advocate</Text>
            <Ionicons name="arrow-forward" size={18} color={NAVY} />
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Registered advocate dashboard
  const cards = [
    {
      icon: 'people-outline' as const,
      title: 'Client Intakes',
      sub: 'Send a secure link, receive a structured brief',
      onPress: () => router.push('/intakes' as any),
    },
    {
      icon: 'library-outline' as const,
      title: 'Legal Research',
      sub: 'Professional-format answers with section citations',
      onPress: () => router.push({ pathname: '/(tabs)' as any, params: { mode: 'advocate' } }),
    },
    {
      icon: 'git-compare-outline' as const,
      title: 'IPC → BNS Lookup',
      sub: 'Cross-reference old & new criminal code sections',
      onPress: () => router.push('/ipc-bns-lookup' as any),
    },
  ];

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Lawyer Mode</Text>
          {profile?.verified
            ? (
              <View style={s.verifiedBadge}>
                <Ionicons name="checkmark-circle" size={13} color={NAVY} />
                <Text style={s.verifiedText}>Reviewed</Text>
              </View>
            )
            : <Text style={s.pendingText}>Pending Verification</Text>}
        </View>
        <Pressable onPress={() => router.push('/(tabs)/settings' as any)} style={s.settingsBtn}>
          <Ionicons name="person-circle-outline" size={28} color={GOLD} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.dashScroll}>

        {/* Verification pending banner */}
        {!profile?.verified && (
          <View style={s.verifyCard}>
            <Ionicons name="time-outline" size={20} color="#92400E" style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <Text style={[s.verifyCardText, { fontWeight: '700', marginBottom: 2 }]}>
                Verification Pending
              </Text>
              <Text style={s.verifyCardText}>
                Your enrolment no. <Text style={{ fontWeight: '700' }}>{profile?.bar_council_number}</Text> is under review.
                You'll receive a "Reviewed" badge within 24–48 hours.
              </Text>
            </View>
          </View>
        )}

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

        <View style={s.profileCard}>
          <Text style={s.profileLabel}>State Bar</Text>
          <Text style={s.profileValue}>{profile?.state_bar}</Text>
          {profile?.bar_council_number ? (
            <>
              <Text style={[s.profileLabel, { marginTop: 10 }]}>Bar Council Enrolment No.</Text>
              <Text style={s.profileValue}>{profile.bar_council_number}</Text>
            </>
          ) : null}
          {profile?.specializations?.length > 0 && (
            <>
              <Text style={[s.profileLabel, { marginTop: 10 }]}>Specializations</Text>
              <Text style={s.profileValue}>{(profile.specializations as string[]).join(', ')}</Text>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FDFBF7' },
  header: {
    backgroundColor: NAVY, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 14, paddingBottom: 16,
  },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#fff' },
  verifiedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 4, backgroundColor: GOLD, paddingHorizontal: 8,
    paddingVertical: 3, borderRadius: 10, alignSelf: 'flex-start',
  },
  verifiedText: { fontSize: 11, fontWeight: '700', color: NAVY },
  pendingText: { fontSize: 12, color: '#9CA3AF', marginTop: 4 },
  settingsBtn: { padding: 4 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Not-registered state
  registerContainer: { padding: 24, alignItems: 'center', paddingBottom: 40 },
  iconWrap: {
    width: 90, height: 90, borderRadius: 45, backgroundColor: '#EEF2FF',
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  registerTitle: { fontSize: 22, fontWeight: '800', color: NAVY, marginBottom: 10 },
  registerSub: { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  featureList: { width: '100%', gap: 14, marginBottom: 32 },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  featureText: { flex: 1, fontSize: 14, color: '#374151', lineHeight: 21 },
  registerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: GOLD, paddingVertical: 14, paddingHorizontal: 28,
    borderRadius: 12, width: '100%',
  },
  registerBtnText: { fontSize: 16, fontWeight: '700', color: NAVY },

  // Registered dashboard
  dashScroll: { padding: 20, gap: 14, paddingBottom: 40 },
  verifyCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#FEF3C7', borderRadius: 12, padding: 14,
  },
  verifyCardText: { flex: 1, fontSize: 13, color: '#92400E', lineHeight: 19 },
  card: {
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1, borderColor: '#E5E7EB',
    padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardIcon: {
    width: 48, height: 48, borderRadius: 12,
    backgroundColor: '#EEF2FF', alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: NAVY, marginBottom: 3 },
  cardSub: { fontSize: 13, color: '#6B7280', lineHeight: 18 },
  profileCard: {
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1, borderColor: '#E5E7EB', padding: 18, marginTop: 4,
  },
  profileLabel: { fontSize: 11, fontWeight: '700', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.5 },
  profileValue: { fontSize: 14, color: '#1F2937', marginTop: 3, fontWeight: '600' },
});
