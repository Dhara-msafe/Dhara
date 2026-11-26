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
import { useRouter, Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { PageTitleRow } from '@/src/ui/PageTitleRow';
import { useAuth, API_BASE } from '@/src/auth';
import { theme } from '@/src/theme';
import { ADVOCATE_MODE_ENABLED } from '@/src/advocateMode/flags';
import { v22SectionLabel } from '@/src/v22SectionLabel';

const NAVY = theme.colors.primary;
const GOLD = theme.colors.gold;

export default function AdvocateTab() {
  const { token, user } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<any | null | 'none'>('loading');

  // B-97: advocate/lawyer features are hidden for Wave 1 per D-14 -- this
  // must hold even on a direct URL hit or a refresh, not just when reached
  // via the (now-hidden) in-app links.
  if (!ADVOCATE_MODE_ENABLED) return <Redirect href="/(tabs)/home" />;

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
      <SafeAreaView style={s.safe} edges={[]}>
        <PageTitleRow title="Lawyer Mode" onBack={() => router.navigate('/(tabs)/me' as any)} backTestID="advocate-back" testID="advocate-title" />
        <View style={s.center}>
          <ActivityIndicator color={NAVY} />
        </View>
      </SafeAreaView>
    );
  }

  if (profile === 'none') {
    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <PageTitleRow title="Lawyer Mode" onBack={() => router.navigate('/(tabs)/me' as any)} backTestID="advocate-back" testID="advocate-title" />
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
      icon: 'mic-outline' as const,
      title: 'Consultation Notes',
      sub: 'Record consent, capture notes, and get an AI-structured draft',
      onPress: () => router.push('/notetaker' as any),
    },
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
    <SafeAreaView style={s.safe} edges={[]}>
      <PageTitleRow
        title="Lawyer Mode"
        subtitle={profile?.verified ? 'Reviewed' : 'Pending Verification'}
        onBack={() => router.navigate('/(tabs)/me' as any)}
        backTestID="advocate-back"
        testID="advocate-title"
        right={(
          <Pressable onPress={() => router.push('/(tabs)/settings?from=me' as any)} style={s.settingsBtn} accessibilityRole="button" accessibilityLabel="Your profile and settings">
            <Ionicons name="person-circle-outline" size={28} color={GOLD} />
          </Pressable>
        )}
      />

      <ScrollView contentContainerStyle={s.dashScroll}>

        {/* Verification pending banner */}
        {!profile?.verified && (
          <View style={s.verifyCard}>
            <Ionicons name="time-outline" size={20} color="#8A6A1E" style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <Text style={[s.verifyCardText, { fontFamily: 'InterBold', marginBottom: 2 }]}>
                Verification Pending
              </Text>
              <Text style={s.verifyCardText}>
                Your enrolment no. <Text style={{ fontFamily: 'InterBold'}}>{profile?.bar_council_number}</Text> is under review.
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
            <Ionicons name="chevron-forward" size={20} color="#64788A" />
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
  safe: { flex: 1, backgroundColor: '#FFFAF2' },
  header: {
    backgroundColor: NAVY, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16,
  },
  headerTitle: { fontSize: 19, fontFamily: 'InterExtraBold', color: '#fff' },
  verifiedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 4, backgroundColor: GOLD, paddingHorizontal: 8,
    paddingVertical: 3, borderRadius: 10, alignSelf: 'flex-start',
  },
  verifiedText: { fontSize: 12, fontFamily: 'InterBold', color: NAVY },
  pendingText: { fontFamily: 'Inter', fontSize: 12, color: '#64788A', marginTop: 4 },
  settingsBtn: { padding: 4 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Not-registered state
  registerContainer: { padding: 18, alignItems: 'center', paddingBottom: 40 },
  iconWrap: {
    width: 90, height: 90, borderRadius: 45, backgroundColor: '#EEF5FF',
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  registerTitle: { fontSize: 19, fontFamily: 'InterExtraBold', color: NAVY, marginBottom: 10 },
  registerSub: { fontFamily: 'Inter', fontSize: 13, color: '#64788A', textAlign: 'center', lineHeight: 19, marginBottom: 18 },
  featureList: { width: '100%', gap: 14, marginBottom: 24 },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  featureText: { flex: 1, fontFamily: 'Inter', fontSize: 13, color: '#102A45', lineHeight: 18 },
  registerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: GOLD, paddingVertical: 14, paddingHorizontal: 28,
    borderRadius: 12, width: '100%',
  },
  registerBtnText: { fontSize: 14, fontFamily: 'InterBold', color: NAVY },

  // Registered dashboard
  dashScroll: { padding: 16, gap: 14, paddingBottom: 40 },
  verifyCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#FFF4E6', borderRadius: 12, padding: 14,
  },
  verifyCardText: { flex: 1, fontFamily: 'Inter', fontSize: 12, color: '#8A6A1E', lineHeight: 17 },
  card: {
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1, borderColor: '#E6DFD1',
    padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardIcon: {
    width: 48, height: 48, borderRadius: 12,
    backgroundColor: '#EEF5FF', alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontSize: 14, fontFamily: 'InterBold', color: NAVY, marginBottom: 3 },
  cardSub: { fontFamily: 'Inter', fontSize: 12, color: '#64788A', lineHeight: 16 },
  profileCard: {
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1, borderColor: '#E6DFD1', padding: 18, marginTop: 4,
  },
  profileLabel: v22SectionLabel({ fontSize: 12, fontFamily: 'InterBold', color: '#64788A', textTransform: 'uppercase', letterSpacing: 0.5 }),
  profileValue: { fontSize: 13, color: '#102A45', marginTop: 3, fontFamily: 'InterSemiBold'},
});
