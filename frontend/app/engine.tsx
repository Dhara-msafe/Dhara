/**
 * Dhara Engine — the one place every drafting/complaint tool in the app
 * lives behind. Today "File an FIR", "Report a missing person", "Write a
 * legal notice" and "Scan & reply to a notice" are four separately-built
 * flows with their own entry points scattered across Home, the action plan
 * and the scan screen. This hub doesn't replace any of them — it gives them
 * one shared front door, and surfaces whatever the user already has in
 * progress (real FIR cases + on-device notice history) so "continue" is
 * never a dead end.
 */
import { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { useComplaints, isDraftReady, complaintTitle, complaintProgress } from '@/src/home/complaints';
import { loadHistory, DraftHistoryItem } from '@/src/draftHistory';
import { draftByType } from '@/src/drafts';

const c = theme.colors;

type Tool = {
  key: string; title: string; sub: string; icon: any; route: string; badge?: string;
};

const TOOLS: Tool[] = [
  {
    key: 'fir', title: 'File a police complaint', icon: 'ribbon-outline', route: '/fir-draft',
    sub: 'Speak or type what happened — DHARA interviews you and drafts the FIR.',
  },
  {
    key: 'missing', title: 'Report a missing person', icon: 'people-outline', route: '/missing',
    sub: 'A guided, private interview. Nothing leaves your phone.',
  },
  {
    key: 'notice', title: 'Write a legal notice', icon: 'document-text-outline', route: '/drafts',
    sub: 'Cheque bounce, deposit refund, unpaid salary, police complaint & more.',
  },
  {
    key: 'scan', title: 'Scan & reply to a notice', icon: 'camera-outline', route: '/scan',
    sub: 'Photograph a notice — DHARA reads it and can draft your reply.',
  },
];

export default function DharaEngine() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { items: cases, loading: casesLoading } = useComplaints();
  const [notices, setNotices] = useState<DraftHistoryItem[]>([]);

  useFocusEffect(useCallback(() => { loadHistory().then(setNotices); }, []));

  const activeCases = cases.filter((i) => !isDraftReady(i)).slice(0, 2);
  const recentNotices = notices.slice(0, 2);
  const hasContinue = activeCases.length > 0 || recentNotices.length > 0;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Dhara Engine" subtitle="Every way DHARA can write something for you" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>

        {casesLoading && !hasContinue ? (
          <View style={styles.loadingWrap}><ActivityIndicator color={c.navy} /></View>
        ) : hasContinue ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Continue</Text>
            {activeCases.map((item) => {
              const progress = complaintProgress(item);
              return (
                <Pressable
                  key={item.session_id}
                  style={styles.continueCard}
                  testID={`engine-continue-fir-${item.session_id}`}
                  onPress={() => router.push({ pathname: '/fir-draft', params: { resumeId: item.session_id } } as any)}
                >
                  <View style={styles.continueIcon}><Ionicons name="ribbon-outline" size={18} color={c.navy} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.continueTitle} numberOfLines={1}>{complaintTitle(item)}</Text>
                    <Text style={styles.continueSub}>{progress.label} · Step {progress.step} of {progress.total}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={c.onSurfaceTertiary} />
                </Pressable>
              );
            })}
            {recentNotices.map((item) => {
              const spec = draftByType(item.type);
              return (
                <Pressable
                  key={item.id}
                  style={styles.continueCard}
                  testID={`engine-continue-notice-${item.id}`}
                  onPress={() => router.push('/drafts/history')}
                >
                  <View style={styles.continueIcon}><Ionicons name={spec?.icon || 'document-text-outline'} size={18} color={c.navy} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.continueTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.continueSub}>Notice written on {new Date(item.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={c.onSurfaceTertiary} />
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Start something new</Text>
          {TOOLS.map((t) => (
            <Pressable key={t.key} style={styles.toolCard} testID={`engine-tool-${t.key}`} onPress={() => router.push(t.route as any)}>
              <View style={styles.toolIcon}><Ionicons name={t.icon} size={22} color={c.gold} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.toolTitle}>{t.title}</Text>
                <Text style={styles.toolSub}>{t.sub}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={c.onSurfaceTertiary} />
            </Pressable>
          ))}
        </View>

        <View style={styles.footer}>
          <Ionicons name="shield-checkmark-outline" size={16} color={c.muted} />
          <Text style={styles.footerTxt}>Every draft is explained in plain language before you send it. DHARA does not replace a lawyer.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  loadingWrap: { paddingVertical: 30, alignItems: 'center' },
  section: { marginBottom: 8 },
  sectionTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 13, color: c.onSurfaceTertiary, letterSpacing: 1, marginBottom: 12, textTransform: 'uppercase' },
  continueCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.navySoft, borderRadius: 14, padding: 14, marginBottom: 10 },
  continueIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' },
  continueTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.ink },
  continueSub: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 2 },
  toolCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines, borderRadius: 16, padding: 16, marginBottom: 12 },
  toolIcon: { width: 46, height: 46, borderRadius: 13, backgroundColor: c.navy, alignItems: 'center', justifyContent: 'center' },
  toolTitle: { fontFamily: theme.fonts.displayBold, fontSize: 16, color: c.ink },
  toolSub: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, marginTop: 3, lineHeight: 18 },
  footer: { flexDirection: 'row', gap: 10, marginTop: 10, paddingHorizontal: 4 },
  footerTxt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, lineHeight: 17 },
});
