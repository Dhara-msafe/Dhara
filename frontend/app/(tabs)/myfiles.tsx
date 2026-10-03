import { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { tr } from '@/src/ui18n';

const c = theme.colors;

const TIMELINE = [
  { title: 'Rights explained', meta: '25 Sep · listened in Hindi', state: 'done' },
  { title: 'Evidence sealed (3 items)', meta: '26 Sep · anchored 26 Sep 22:40', state: 'done' },
  { title: 'Complaint to Superintendent of Police', meta: 'Draft ready · needs your confirmation', state: 'current' },
  { title: 'Follow up if no reply', meta: 'Reminder set for 14 Oct', state: 'todo' },
  { title: 'Legal aid appointment', meta: 'Optional · 15100', state: 'todo' },
];

export default function MyFiles() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { language } = useAuth();
  const lang = language.code;
  const [tab, setTab] = useState('active');

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        <View style={styles.headRow}>
          <Text style={styles.title}>{tr('mf.title', lang)}</Text>
          <View style={styles.pin}><Ionicons name="lock-closed-outline" size={15} color={c.darkGold} /><Text style={styles.pinTxt}>{tr('mf.pin', lang)}</Text></View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {[['active', tr('mf.active', lang), 2], ['evidence', tr('mf.evidence', lang), 3], ['documents', tr('mf.documents', lang), 4]].map(([id, label, n]) => (
            <Pressable key={id as string} style={[styles.tab, tab === id && styles.tabActive]} onPress={() => setTab(id as string)}>
              <Text style={[styles.tabTxt, tab === id && styles.tabTxtActive]}>{label} {n}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* File #2 */}
        <View style={styles.fileCard}>
          <View style={styles.fileHead}>
            <View>
              <Text style={styles.fileTitle}>File #2</Text>
              <Text style={styles.fileSub}>{tr('mf.namedby', lang)} · {tr('mf.step', lang)} 2 of 6</Text>
            </View>
            <View style={styles.statusPill}><Text style={styles.statusTxt}>{tr('mf.ontrack', lang)}</Text></View>
          </View>

          <View style={styles.nextStep}>
            <View style={styles.nextHead}>
              <Ionicons name="sparkles" size={14} color={c.gold} />
              <Text style={styles.nextLabel}>{tr('mf.nextstep', lang)} · {tr('mf.due', lang)}</Text>
            </View>
            <Text style={styles.nextBody}>Get a copy of your medical report before 2 Oct. Want me to draft the request letter?</Text>
            <View style={styles.nextBtns}>
              <Pressable style={styles.goldBtn} onPress={() => router.push('/drafts')}><Text style={styles.goldBtnTxt}>{tr('mf.draftit', lang)}</Text></Pressable>
              <Pressable style={styles.ghostBtn} onPress={() => {}}><Text style={styles.ghostTxt}>{tr('mf.remind', lang)}</Text></Pressable>
            </View>
          </View>

          <View style={styles.timeline}>
            {TIMELINE.map((item, i) => (
              <View key={i} style={styles.tlRow}>
                <View style={styles.tlLeft}>
                  <View style={[styles.tlDot, item.state === 'done' && styles.tlDotDone, item.state === 'current' && styles.tlDotCurrent]}>
                    {item.state === 'done' && <Ionicons name="checkmark" size={13} color="#fff" />}
                  </View>
                  {i < TIMELINE.length - 1 && <View style={[styles.tlLine, item.state === 'done' && { backgroundColor: c.navy }]} />}
                </View>
                <View style={{ flex: 1, paddingBottom: 18 }}>
                  <Text style={[styles.tlTitle, item.state === 'todo' && { color: c.muted }]}>{item.title}</Text>
                  <Text style={styles.tlMeta}>{item.meta}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={styles.attachments}>
            {[['document-text-outline', 'Complaint draft.pdf'], ['mic-outline', 'Audio 04:12'], ['image-outline', '2 photos']].map(([icon, label]) => (
              <View key={label} style={styles.attachChip}>
                <Ionicons name={icon as any} size={15} color={c.navy} />
                <Text style={styles.attachTxt}>{label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Resolved file */}
        <Pressable style={styles.resolvedCard} onPress={() => {}}>
          <View style={styles.resolvedIcon}><Ionicons name="cart-outline" size={20} color={c.navy} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.resolvedTitle}>File #1 · Refund</Text>
            <Text style={styles.resolvedSub}>Resolved 12 Sep</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={c.onSurfaceTertiary} />
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingRight: 72 },
  title: { fontFamily: theme.fonts.displayBold, fontSize: 28, color: c.ink },
  pin: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.goldMuted, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  pinTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.darkGold },
  tabs: { gap: 10, paddingVertical: 16 },
  tab: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 9 },
  tabActive: { backgroundColor: c.navy, borderColor: c.navy },
  tabTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 14, color: c.ink },
  tabTxtActive: { color: '#fff' },
  fileCard: { backgroundColor: c.surface, borderRadius: 18, borderWidth: 1, borderColor: c.lines, padding: 18 },
  fileHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  fileTitle: { fontFamily: theme.fonts.displayBold, fontSize: 22, color: c.ink },
  fileSub: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, marginTop: 2 },
  statusPill: { backgroundColor: c.successSoft, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  statusTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.verifiedGreen },
  nextStep: { backgroundColor: c.navy, borderRadius: 16, padding: 16, marginTop: 16 },
  nextHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nextLabel: { fontFamily: theme.fonts.bodyBold, fontSize: 11, color: c.gold, letterSpacing: 1 },
  nextBody: { fontFamily: theme.fonts.bodyMedium, fontSize: 16, color: '#fff', lineHeight: 23, marginTop: 10 },
  nextBtns: { flexDirection: 'row', gap: 12, marginTop: 16 },
  goldBtn: { backgroundColor: c.gold, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 },
  goldBtnTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.navy },
  ghostBtn: { backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 },
  ghostTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: '#fff' },
  timeline: { marginTop: 20 },
  tlRow: { flexDirection: 'row', gap: 14 },
  tlLeft: { alignItems: 'center', width: 26 },
  tlDot: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  tlDotDone: { backgroundColor: c.navy, borderColor: c.navy },
  tlDotCurrent: { backgroundColor: c.gold, borderColor: c.gold },
  tlLine: { width: 2, flex: 1, backgroundColor: c.border, marginVertical: 2 },
  tlTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.ink },
  tlMeta: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 2 },
  attachments: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  attachChip: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: c.surfaceSecondary, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  attachTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.ink },
  resolvedCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.lines, padding: 16, marginTop: 16 },
  resolvedIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: c.navySoft, alignItems: 'center', justifyContent: 'center' },
  resolvedTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 16, color: c.ink },
  resolvedSub: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 2 },
});
