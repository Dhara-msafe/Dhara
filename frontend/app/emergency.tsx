import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { tr } from '@/src/ui18n';
import { QuickExit } from '@/src/components/dhara/SosPill';

const c = theme.colors;

export default function Emergency() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { language } = useAuth();
  const lang = language.code;

  const tiles = [
    { id: 'silent-alert', icon: 'people-outline', title: tr('em.silent', lang), sub: tr('em.silent.sub', lang), route: '/women/silent-alert' },
    { id: 'record-now', icon: 'mic-outline', title: tr('em.record', lang), sub: tr('em.record.sub', lang), route: '/women/evidence-locker?record=1' },
    { id: 'officer-card', icon: 'shield-outline', title: tr('em.officer', lang), sub: tr('em.officer.sub', lang), route: '/women/officer-card?scenario=police_wont_file' },
    { id: 'nearest-help', icon: 'location-outline', title: tr('em.nearest', lang), sub: tr('em.nearest.sub', lang), route: '/women/nearest-help' },
  ];

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
        <View style={styles.topRow}>
          <View style={styles.dangerRow}>
            <Ionicons name="warning-outline" size={22} color="#fff" />
            <Text style={styles.danger}>{tr('em.danger', lang)}</Text>
          </View>
          <QuickExit />
        </View>

        <View style={[styles.callCircle, { opacity: 0.6 }]} testID="call-112">
          <Ionicons name="call-outline" size={34} color={c.emergencyRed} />
          <Text style={styles.callNum}>112</Text>
        </View>
        <Text testID="emergency-call-status" style={styles.oneNumber}>Emergency calling is not active in this test version. Dial 112 on your phone if you need help.</Text>

        <Text style={styles.oneNumber}>{tr('em.oneNumber', lang)}</Text>

        <View style={styles.grid}>
          {tiles.map(t => (
            <Pressable key={t.id} testID={`help-${t.id}`} accessibilityRole="button" style={({ pressed }) => [styles.tile, pressed && { opacity: 0.7 }]} onPress={() => router.push(t.route as any)}>
              <Ionicons name={t.icon as any} size={24} color="#fff" />
              <Text testID={`help-${t.id}-title`} style={styles.tileTitle}>{t.title}</Text>
              <Text testID={`help-${t.id}-description`} style={styles.tileSub}>{t.sub}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.tipBox}>
          <Text testID="emergency-device-tip" style={styles.tipTxt}>{tr('em.powerTip', lang)}</Text>
        </View>
      </ScrollView>

      <Pressable style={styles.safeBtn} onPress={() => router.replace('/(tabs)/home')} testID="im-safe">
        <Text style={styles.safeTxt}>{tr('em.safe', lang)}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.emergencyDeep, paddingHorizontal: 20 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  dangerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  danger: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 16, letterSpacing: 0.4, flexShrink: 1 },
  callCircle: { alignSelf: 'center', width: 230, height: 230, borderRadius: 115, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginTop: 28 },
  callNum: { color: c.emergencyRed, fontFamily: theme.fonts.displayBlack, fontSize: 68, lineHeight: 74 },
  callTap: { color: c.emergencyRed, fontFamily: theme.fonts.bodyBold, fontSize: 17 },
  oneNumber: { color: '#fff', fontFamily: theme.fonts.body, fontSize: 17, textAlign: 'center', marginTop: 26 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 14, marginTop: 24 },
  tile: { width: '47%', backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 16, padding: 18, minHeight: 120, justifyContent: 'center', gap: 8 },
  tileTitle: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 17 },
  tileSub: { color: 'rgba(255,255,255,0.82)', fontFamily: theme.fonts.body, fontSize: 13 },
  tipBox: { backgroundColor: 'rgba(0,0,0,0.22)', borderRadius: 14, padding: 16, marginTop: 20 },
  tipTxt: { color: '#fff', fontFamily: theme.fonts.body, fontSize: 15, lineHeight: 22 },
  safeBtn: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.5)', borderRadius: 16, paddingVertical: 18, alignItems: 'center', marginTop: 8 },
  safeTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 18 },
});
