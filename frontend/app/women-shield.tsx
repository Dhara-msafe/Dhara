import { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Switch, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { tr } from '@/src/ui18n';
import { SosPill, Divider } from '@/src/components/dhara/SosPill';

const c = theme.colors;

const RIGHTS: { key: string; icon: any }[] = [
  { key: 'ws.r.police', icon: 'ribbon-outline' },
  { key: 'ws.r.violence', icon: 'home-outline' },
  { key: 'ws.r.thrown', icon: 'exit-outline' },
  { key: 'ws.r.dowry', icon: 'card-outline' },
  { key: 'ws.r.work', icon: 'briefcase-outline' },
  { key: 'ws.r.stalking', icon: 'eye-off-outline' },
  { key: 'ws.r.photos', icon: 'image-outline' },
  { key: 'ws.r.assault', icon: 'heart-outline' },
  { key: 'ws.r.arrested', icon: 'shield-outline' },
  { key: 'ws.r.children', icon: 'people-outline' },
];

const HELPLINES = [
  { num: '112', key: 'hl.emergency' },
  { num: '181', key: 'hl.women' },
  { num: '14490', key: 'hl.ncw' },
  { num: '1930', key: 'hl.cyber' },
  { num: '15100', key: 'hl.legalaid' },
  { num: '14416', key: 'hl.talk' },
];

export default function WomenShield() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { language } = useAuth();
  const lang = language.code;
  const [discreet, setDiscreet] = useState(true);
  const [checkin, setCheckin] = useState(true);

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <View style={styles.topRow}>
            <Pressable onPress={() => router.back()} style={styles.backBtn} testID="ws-back">
              <Ionicons name="chevron-back" size={24} color="#fff" />
            </Pressable>
            <SosPill />
          </View>
          <View style={styles.titleRow}>
            <View style={styles.shieldBox}><Ionicons name="shield-half" size={28} color={c.navy} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{tr('ws.title', lang)}</Text>
              <Text style={styles.subtitle}>{tr('ws.subtitle', lang)}</Text>
            </View>
          </View>
          <View style={styles.discreet}>
            <Ionicons name="eye-off-outline" size={22} color="#fff" />
            <View style={{ flex: 1 }}>
              <Text style={styles.discreetTitle}>{tr('ws.discreet', lang)}</Text>
              <Text style={styles.discreetSub}>{tr('ws.discreet.sub', lang)}</Text>
            </View>
            <Switch value={discreet} onValueChange={setDiscreet} trackColor={{ true: c.gold, false: '#334' }} thumbColor="#fff" />
          </View>
        </View>

        {/* Know your rights */}
        <View style={styles.section}>
          <Text style={styles.h2}>{tr('ws.rights', lang)}</Text>
          <Text style={styles.h2sub}>{tr('ws.rights.sub', lang)}</Text>
          <View style={styles.grid}>
            {RIGHTS.map(r => (
              <Pressable key={r.key} style={styles.rightCard} onPress={() => router.push('/action-plan')} testID={`ws-${r.key}`}>
                <View style={styles.rightIcon}><Ionicons name={r.icon} size={18} color={c.darkGold} /></View>
                <Text style={styles.rightTxt} numberOfLines={2}>{tr(r.key, lang)}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Safety tools */}
        <View style={styles.section}>
          <Text style={styles.h2}>{tr('ws.tools', lang)}</Text>
          <View style={styles.toolCard}>
            <ToolRow icon="people-outline" title={tr('ws.circle', lang)} sub={tr('ws.circle.sub', lang)} action={tr('ws.manage', lang)} onPress={() => {}} />
            <Divider />
            <View style={styles.toolRow}>
              <View style={styles.toolIcon}><Ionicons name="navigate-outline" size={20} color={c.navy} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.toolTitle}>{tr('ws.checkin', lang)}</Text>
                <Text style={styles.toolSub}>{tr('ws.checkin.sub', lang)}</Text>
              </View>
              <Switch value={checkin} onValueChange={setCheckin} trackColor={{ true: c.navy, false: c.surfaceTertiary }} thumbColor="#fff" />
            </View>
            <Divider />
            <ToolRow icon="lock-closed-outline" title={tr('ws.locker', lang)} sub={tr('ws.locker.sub', lang)} action={tr('ws.open', lang)} onPress={() => {}} />
            <Divider />
            <ToolRow icon="mic-outline" title={tr('ws.code', lang)} sub={tr('ws.code.sub', lang)} action={tr('ws.setup', lang)} onPress={() => {}} />
          </View>
        </View>

        {/* Talk to someone */}
        <View style={styles.section}>
          <Text style={styles.h2}>{tr('ws.talk', lang)}</Text>
          <Text style={styles.h2sub}>{tr('ws.talk.sub', lang)}</Text>
          <View style={styles.hlGrid}>
            {HELPLINES.map(h => (
              <Pressable key={h.num} style={styles.hlCard} onPress={() => Linking.openURL(`tel:${h.num}`)} testID={`hl-${h.num}`}>
                <Text style={styles.hlNum}>{h.num}</Text>
                <Text style={styles.hlLabel}>{tr(h.key, lang)}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Safety plan */}
        <View style={styles.section}>
          <View style={styles.planCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.planTitle}>{tr('ws.plan', lang)}</Text>
              <Text style={styles.planSub}>{tr('ws.plan.sub', lang)}</Text>
            </View>
            <Pressable style={styles.planBtn} onPress={() => router.push('/action-plan')}>
              <Text style={styles.planBtnTxt}>{tr('ws.start', lang)}</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function ToolRow({ icon, title, sub, action, onPress }: { icon: any; title: string; sub: string; action: string; onPress: () => void }) {
  return (
    <View style={styles.toolRow}>
      <View style={styles.toolIcon}><Ionicons name={icon} size={20} color={c.navy} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.toolTitle}>{title}</Text>
        <Text style={styles.toolSub}>{sub}</Text>
      </View>
      <Pressable onPress={onPress}><Text style={styles.toolAction}>{action}</Text></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  header: { backgroundColor: c.navy, paddingHorizontal: 20, paddingBottom: 18 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10 },
  shieldBox: { width: 52, height: 52, borderRadius: 14, backgroundColor: c.gold, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontFamily: theme.fonts.displayBold, fontSize: 26 },
  subtitle: { color: c.onNavyMuted, fontFamily: theme.fonts.body, fontSize: 13, marginTop: 2 },
  discreet: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 16, padding: 14, marginTop: 18 },
  discreetTitle: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 15 },
  discreetSub: { color: c.onNavyMuted, fontFamily: theme.fonts.body, fontSize: 12, marginTop: 2 },

  section: { paddingHorizontal: 20, marginTop: 24 },
  h2: { fontFamily: theme.fonts.displayBold, fontSize: 22, color: c.ink },
  h2sub: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, marginTop: 2, marginBottom: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 },
  rightCard: { width: '47.5%', flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.lines, padding: 12, minHeight: 64 },
  rightIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: c.goldMuted, alignItems: 'center', justifyContent: 'center' },
  rightTxt: { flex: 1, fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.ink },

  toolCard: { backgroundColor: c.surface, borderRadius: 18, borderWidth: 1, borderColor: c.lines, paddingHorizontal: 16 },
  toolRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16 },
  toolIcon: { width: 40, height: 40, borderRadius: 11, backgroundColor: c.navySoft, alignItems: 'center', justifyContent: 'center' },
  toolTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.ink },
  toolSub: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 2 },
  toolAction: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.navy },

  hlGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 },
  hlCard: { width: '31%', backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.lines, paddingVertical: 16, alignItems: 'center' },
  hlNum: { fontFamily: theme.fonts.displayBold, fontSize: 22, color: c.navy },
  hlLabel: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 2 },

  planCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: c.goldMuted, borderRadius: 18, borderWidth: 1, borderColor: c.goldSoft, padding: 18 },
  planTitle: { fontFamily: theme.fonts.displayBold, fontSize: 18, color: c.ink },
  planSub: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, marginTop: 4, lineHeight: 18 },
  planBtn: { backgroundColor: c.navy, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 22 },
  planBtnTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 15 },
});
