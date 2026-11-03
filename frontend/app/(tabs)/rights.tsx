import { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { API_BASE, useAuth } from '@/src/auth';
import { theme } from '@/src/theme';
import { useUserProfile } from '@/src/userProfile';

import { openExternal } from '@/src/outbound';
type Citation = { label: string; url: string };
type Topic = {
  id: string; icon: string; title: string; summary: string; law: string; points: string[];
  citations?: Citation[]; verified_at?: string | null; review_note?: string;
  localized?: boolean; fallback_notice?: string | null;
};

const ICON_MAP: Record<string, keyof typeof Ionicons.glyphMap> = {
  shield: 'shield-half-outline',       // Rights during a police stop — authority + protection
  handcuffs: 'lock-closed-outline',    // Rights when arrested — detained/locked
  'file-text': 'document-text-outline', // How to file an FIR — filing a document
  heart: 'heart-outline',              // Women's safety — care and protection
  car: 'car-outline',                  // Traffic law — vehicles
  info: 'eye-outline',                 // RTI — right to *see* information
  'shopping-bag': 'receipt-outline',   // Consumer rights — purchase receipts
  home: 'home-outline',                // Domestic violence — home context
};

export default function Rights() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const router = useRouter();
  const { language } = useAuth();
  const { primaryInterest } = useUserProfile();

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/api/reference/topics?lang=${language.code}`)
      .then(r => r.json())
      .then(setTopics)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [language.code]);

  // Sort topics so the user's primary-interest topic comes first, followed by
  // related topics, then everything else in their original backend order.
  const sortedTopics = useMemo(() => {
    if (!primaryInterest || topics.length === 0) return topics;
    const primary = primaryInterest.rightsTopicId;
    const related = primaryInterest.relatedTopicIds;
    return [...topics].sort((a, b) => {
      const scoreA = a.id === primary ? 2 : related.includes(a.id) ? 1 : 0;
      const scoreB = b.id === primary ? 2 : related.includes(b.id) ? 1 : 0;
      return scoreB - scoreA;
    });
  }, [topics, primaryInterest]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="rights-screen">
      <View style={styles.header}>
        <Text style={styles.h1}>
          {primaryInterest ? `Your ${primaryInterest.label} Rights` : 'Know Your Rights'}
        </Text>
        <Text style={styles.h2}>
          {primaryInterest ? primaryInterest.chatSubline : 'Rights that no one can take from you.'}
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Flagship feature — always shown first, above the topic cards */}
        {primaryInterest?.key === 'women' || primaryInterest?.key === 'domestic' ? (
          <Pressable
            testID="women-entry-card"
            style={[styles.firCard, { backgroundColor: primaryInterest.color }]}
            onPress={() => router.push('/women-shield' as any)}
          >
            <View style={[styles.firIconWrap, { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
              <Ionicons name="shield-checkmark" size={26} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.firCardTitle}>Women&apos;s Shield</Text>
              <Text style={styles.firCardSub}>Evidence locker · Safe journey · Trusted circle</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#fff" />
          </Pressable>
        ) : (
          <Pressable
            testID="fir-entry-card"
            style={styles.firCard}
            onPress={() => router.push('/fir-draft' as any)}
          >
            <View style={styles.firIconWrap}>
              <Ionicons name="document-text" size={26} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.firCardTitle}>File a Police Complaint</Text>
              <Text style={styles.firCardSub}>Get a ready FIR draft in your language — by voice or text</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#fff" />
          </Pressable>
        )}

        {loading && <ActivityIndicator color={theme.colors.brand} />}
        {sortedTopics.map(t => {
          const open = expanded === t.id;
          return (
            <Pressable
              key={t.id}
              testID={`topic-${t.id}`}
              onPress={() => setExpanded(open ? null : t.id)}
              style={styles.card}
            >
              <View style={styles.cardHead}>
                <View style={styles.iconWrap}>
                  <Ionicons name={ICON_MAP[t.icon] || 'library-outline'} size={24} color={theme.colors.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{t.title}</Text>
                  <Text style={styles.cardSummary}>{t.summary}</Text>
                </View>
                <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={theme.colors.onSurfaceSecondary} />
              </View>
              {open && (
                <View style={styles.body}>
                  <View style={styles.lawPill}>
                    <Ionicons name="book-outline" size={14} color={theme.colors.brandSecondary} />
                    <Text style={styles.lawText}>{t.law}</Text>
                  </View>
                  {!t.localized && !!t.fallback_notice && (
                    <View style={styles.noticeBox} testID={`notice-${t.id}`}>
                      <Ionicons name="language-outline" size={14} color={theme.colors.onSurfaceSecondary} />
                      <Text style={styles.noticeText}>{t.fallback_notice}</Text>
                    </View>
                  )}
                  {t.points.map((p, i) => (
                    <View key={i} style={styles.point}>
                      <Text style={styles.bullet}>•</Text>
                      <Text style={styles.pointText}>{p}</Text>
                    </View>
                  ))}
                  {!!t.citations?.length && (
                    <View style={styles.citeWrap}>
                      <Text style={styles.citeHeading}>Official sources</Text>
                      {t.citations.map((c, i) => (
                        <Pressable
                          key={i}
                          testID={`citation-${t.id}-${i}`}
                          onPress={() => openExternal(c.url)}
                          style={styles.citeRow}
                        >
                          <Ionicons name="open-outline" size={13} color={theme.colors.brand} />
                          <Text style={styles.citeText}>{c.label}</Text>
                        </Pressable>
                      ))}
                      {t.verified_at ? (
                        <Text style={styles.verifiedText}>Checked against official text: {t.verified_at}</Text>
                      ) : (
                        <Text style={styles.verifiedText}>Source links added — full line-by-line check pending</Text>
                      )}
                    </View>
                  )}
                  <Pressable
                    testID={`ask-more-${t.id}`}
                    style={styles.askBtn}
                    onPress={() => router.push({ pathname: '/(tabs)', params: { topicId: t.id } })}
                  >
                    <Ionicons name="chatbubbles-outline" size={16} color={theme.colors.onBrandPrimary} />
                    <Text style={styles.askText}>Ask Dhara more</Text>
                  </Pressable>
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.surface },
  header: { padding: theme.spacing.xl, paddingBottom: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
  h1: { fontFamily: theme.fonts.display, fontSize: 28, color: theme.colors.brand, fontWeight: '700' },
  h2: { color: theme.colors.onSurfaceSecondary, marginTop: 4 },
  scroll: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: theme.spacing.xxl },
  firCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    backgroundColor: theme.colors.brand,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  firIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  firCardTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
  firCardSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12.5, marginTop: 2, lineHeight: 17 },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing.lg, marginBottom: theme.spacing.md },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  iconWrap: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: theme.fonts.display, fontSize: 17, fontWeight: '700', color: theme.colors.onSurface },
  cardSummary: { color: theme.colors.onSurfaceSecondary, marginTop: 2, fontSize: 13 },
  body: { marginTop: theme.spacing.lg, paddingTop: theme.spacing.lg, borderTopWidth: 1, borderTopColor: theme.colors.divider },
  lawPill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: theme.colors.surfaceSecondary, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, borderRadius: theme.radius.pill, marginBottom: theme.spacing.md },
  lawText: { color: theme.colors.brandSecondary, fontSize: 12, fontWeight: '600' },
  point: { flexDirection: 'row', gap: theme.spacing.sm, marginBottom: theme.spacing.sm },
  bullet: { color: theme.colors.brandSecondary, fontSize: 18, lineHeight: 22 },
  pointText: { flex: 1, color: theme.colors.onSurface, lineHeight: 22, fontSize: 14 },
  askBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: theme.colors.brand, borderRadius: theme.radius.md, padding: theme.spacing.md, marginTop: theme.spacing.md },
  askText: { color: theme.colors.onBrandPrimary, fontWeight: '700' },
  noticeBox: { flexDirection: 'row', gap: theme.spacing.sm, backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md, marginBottom: theme.spacing.md },
  noticeText: { flex: 1, color: theme.colors.onSurfaceSecondary, fontSize: 12.5, lineHeight: 18 },
  citeWrap: { marginTop: theme.spacing.sm, paddingTop: theme.spacing.sm, borderTopWidth: 1, borderTopColor: theme.colors.divider },
  citeHeading: { fontSize: 11, fontWeight: '700', color: theme.colors.onSurfaceSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 },
  citeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, minHeight: 28 },
  citeText: { color: theme.colors.brand, fontSize: 13, textDecorationLine: 'underline', flex: 1 },
  verifiedText: { color: theme.colors.onSurfaceSecondary, fontSize: 11, marginTop: 4, fontStyle: 'italic' },
});
