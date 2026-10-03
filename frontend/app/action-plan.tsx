import { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { tr } from '@/src/ui18n';

const c = theme.colors;

export default function ActionPlan() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { language, user } = useAuth();
  const lang = language.code;
  const [answered, setAnswered] = useState(false);

  const steps = [
    { n: 1, title: 'Show this to the officer', body: 'A large-text card with the law, in Hindi and English.', btn: 'Open officer card', icon: 'shield-outline', route: '/emergency' },
    { n: 2, title: 'If they still refuse', body: 'Send your complaint in writing to the Superintendent of Police (BNSS §175).', btn: 'Draft it for me', icon: 'document-text-outline', route: '/drafts' },
    { n: 3, title: 'Keep proof quietly', body: 'Note the time and officer’s name. Recording works even without network.', btn: 'Open evidence locker', icon: 'mic-outline', route: '/women-shield' },
    { n: 4, title: 'Talk to someone free', body: 'Legal aid 15100 · Women’s helpline 181', btn: 'Call now', icon: 'call-outline', route: 'tel:15100' },
  ];

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}><Ionicons name="chevron-back" size={24} color={c.navy} /></Pressable>
        <Text style={styles.headerTitle}>{tr('ap.title', lang)}</Text>
        <Pressable style={styles.listenPill} onPress={() => {}}><Ionicons name="volume-high" size={20} color={c.darkGold} /></Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* Situation chips */}
        <View style={styles.chipRow}>
          <View style={styles.chip}><Ionicons name="sparkles" size={13} color={c.darkGold} /><Text style={styles.chipTxt}>Police refusing complaint</Text></View>
          <View style={styles.chip}><Ionicons name="location-outline" size={13} color={c.darkGold} /><Text style={styles.chipTxt}>{user?.state_name || 'India'}</Text></View>
        </View>
        <Pressable onPress={() => router.push('/ask')}><Text style={styles.notRight}>{tr('ap.notright', lang)}</Text></Pressable>

        {/* Your right card */}
        <View style={styles.rightCard}>
          <Text style={styles.rightLabel}>{tr('ap.yourright', lang)}</Text>
          <Text style={styles.rightTitle}>They must write it down.</Text>
          <Text style={styles.rightBody}>For a serious (cognizable) offence, any police station must record your complaint, even if it happened in another area. This is called a <Text style={{ fontFamily: theme.fonts.bodyBold }}>Zero FIR</Text>.</Text>
          <View style={styles.badgeRow}>
            <View style={styles.badge}><Ionicons name="book-outline" size={13} color="#fff" /><Text style={styles.badgeTxt}>BNSS §173</Text></View>
            <View style={[styles.badge, styles.badgeGreen]}><Ionicons name="checkmark-circle" size={13} color={c.verifiedGreen} /><Text style={[styles.badgeTxt, { color: c.verifiedGreen }]}>{tr('ap.inforce', lang)}</Text></View>
          </View>
          <View style={styles.verifiedBadge}><Ionicons name="ribbon-outline" size={14} color={c.gold} /><Text style={styles.verifiedBadgeTxt}>{tr('ap.verified', lang)}</Text></View>
          <Pressable style={styles.listenBtn} onPress={() => {}}>
            <Ionicons name="volume-high" size={18} color={c.navy} />
            <Text style={styles.listenBtnTxt}>{tr('ap.listen', lang)} {language.native}</Text>
          </Pressable>
        </View>

        {/* One quick question */}
        <View style={styles.qCard}>
          <View style={styles.qHead}><Ionicons name="sparkles" size={15} color={c.darkGold} /><Text style={styles.qLabel}>{tr('ap.question', lang)}</Text></View>
          <Text style={styles.qText}>Is the complaint about violence or harassment against you?</Text>
          <View style={styles.qActions}>
            <Pressable style={[styles.qBtn, answered && styles.qBtnActive]} onPress={() => setAnswered(true)}><Text style={styles.qBtnTxt}>{tr('ap.yes', lang)}</Text></Pressable>
            <Pressable style={styles.qBtn} onPress={() => setAnswered(true)}><Text style={styles.qBtnTxt}>{tr('ap.no', lang)}</Text></Pressable>
            <Pressable onPress={() => setAnswered(true)}><Text style={styles.qSkip}>{tr('ap.skip', lang)}</Text></Pressable>
          </View>
        </View>

        {/* What to do now */}
        <Text style={styles.whatTitle}>{tr('ap.whattodo', lang)}</Text>
        {steps.map(s => (
          <View key={s.n} style={styles.stepCard}>
            <View style={styles.stepNum}><Text style={styles.stepNumTxt}>{s.n}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.stepTitle}>{s.title}</Text>
              <Text style={styles.stepBody}>{s.body}</Text>
              <Pressable style={[styles.stepBtn, s.n === 1 && styles.stepBtnPrimary]} onPress={() => s.route.startsWith('tel:') ? Linking.openURL(s.route) : router.push(s.route as any)}>
                <Ionicons name={s.icon as any} size={16} color={s.n === 1 ? '#fff' : c.navy} />
                <Text style={[styles.stepBtnTxt, s.n === 1 && { color: '#fff' }]}>{s.btn}</Text>
              </Pressable>
            </View>
          </View>
        ))}

        {/* Save */}
        <Pressable style={styles.saveRow} onPress={() => router.push('/(tabs)/myfiles')}>
          <Ionicons name="lock-closed-outline" size={18} color={c.darkGold} />
          <Text style={styles.saveTxt}>{tr('ap.save', lang)}</Text>
          <Ionicons name="chevron-forward" size={18} color={c.onSurfaceTertiary} />
        </Pressable>

        <Text style={styles.footer}>{tr('ap.checkedOn', lang)} 29 Sep 2026. {tr('ap.notlawyer', lang)}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, backgroundColor: c.background, borderBottomWidth: 1, borderBottomColor: c.lines },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: theme.fonts.displayBold, fontSize: 20, color: c.ink },
  listenPill: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.goldMuted, alignItems: 'center', justifyContent: 'center' },
  chipRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.surfaceSecondary, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  chipTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.ink },
  notRight: { fontFamily: theme.fonts.bodyBold, fontSize: 13, color: c.navy, textDecorationLine: 'underline', marginTop: 10 },
  rightCard: { backgroundColor: c.navy, borderRadius: 20, padding: 22, marginTop: 14 },
  rightLabel: { fontFamily: theme.fonts.bodyBold, fontSize: 12, color: c.gold, letterSpacing: 1.5 },
  rightTitle: { fontFamily: theme.fonts.displayBold, fontSize: 30, color: '#fff', marginTop: 8, lineHeight: 36 },
  rightBody: { fontFamily: theme.fonts.body, fontSize: 15, color: c.onNavyMuted, lineHeight: 23, marginTop: 12 },
  badgeRow: { flexDirection: 'row', gap: 10, marginTop: 18, flexWrap: 'wrap' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  badgeGreen: { backgroundColor: c.successSoft },
  badgeTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: '#fff' },
  verifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(211,182,117,0.18)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, alignSelf: 'flex-start', marginTop: 10 },
  verifiedBadgeTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.gold },
  listenBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.gold, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 18, alignSelf: 'flex-start', marginTop: 18 },
  listenBtnTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.navy },
  qCard: { backgroundColor: c.goldMuted, borderRadius: 16, borderWidth: 1, borderColor: c.goldSoft, padding: 18, marginTop: 18 },
  qHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  qLabel: { fontFamily: theme.fonts.bodyBold, fontSize: 12, color: c.darkGold, letterSpacing: 1 },
  qText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 16, color: c.ink, marginTop: 8 },
  qActions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  qBtn: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 22 },
  qBtnActive: { borderColor: c.navy },
  qBtnTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.ink },
  qSkip: { fontFamily: theme.fonts.bodySemiBold, fontSize: 15, color: c.muted },
  whatTitle: { fontFamily: theme.fonts.displayBold, fontSize: 22, color: c.ink, marginTop: 26, marginBottom: 14 },
  stepCard: { flexDirection: 'row', gap: 14, backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.lines, padding: 16, marginBottom: 12 },
  stepNum: { width: 28, height: 28, borderRadius: 14, backgroundColor: c.navy, alignItems: 'center', justifyContent: 'center' },
  stepNumTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 14 },
  stepTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 16, color: c.ink },
  stepBody: { fontFamily: theme.fonts.body, fontSize: 14, color: c.muted, marginTop: 4, lineHeight: 20 },
  stepBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: c.lines, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 16, alignSelf: 'flex-start', marginTop: 12 },
  stepBtnPrimary: { backgroundColor: c.navy, borderColor: c.navy },
  stepBtnTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.navy },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.lines, padding: 16, marginTop: 6 },
  saveTxt: { flex: 1, fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.ink },
  footer: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, lineHeight: 18, marginTop: 18 },
});
