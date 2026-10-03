import { View, Text, Pressable, StyleSheet, ScrollView, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';

const c = theme.colors;

export default function EvidenceLocker() {
  const router = useRouter();
  return (
    <View style={styles.root}>
      <ScreenHeader title="Evidence locker" subtitle="Sealed · private · works offline" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <View style={styles.hero}>
          <Ionicons name="lock-closed" size={30} color={c.gold} />
          <Text style={styles.heroTitle}>Keep proof safely</Text>
          <Text style={styles.heroSub}>Photos, voice notes and documents are stored privately and time-stamped, so you have an integrity-preserved evidence package when you need it.</Text>
        </View>

        <View style={styles.emptyCard}>
          <Ionicons name="folder-open-outline" size={28} color={c.onSurfaceTertiary} />
          <Text style={styles.emptyTxt}>No items yet</Text>
          <Text style={styles.emptySub}>Add a photo, a voice note or a document to seal it in your locker.</Text>
        </View>

        <Pressable style={styles.addBtn} onPress={() => router.push('/scan')}>
          <Ionicons name="camera-outline" size={18} color="#fff" />
          <Text style={styles.addTxt}>Scan a document</Text>
        </Pressable>
        <Pressable style={styles.addBtnAlt} onPress={() => router.push('/missing/attachments')}>
          <Ionicons name="image-outline" size={18} color={c.navy} />
          <Text style={styles.addTxtAlt}>Add photos</Text>
        </Pressable>

        <View style={styles.tip}>
          <Ionicons name="information-circle-outline" size={18} color={c.navy} />
          <Text style={styles.tipTxt}>Recording audio and tamper-proof sealing run on a full app build; in Expo Go you can still add photos and documents.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  hero: { backgroundColor: c.navy, borderRadius: 18, padding: 22, alignItems: 'center' },
  heroTitle: { fontFamily: theme.fonts.displayBold, fontSize: 20, color: '#fff', marginTop: 10 },
  heroSub: { fontFamily: theme.fonts.body, fontSize: 14, color: c.onNavyMuted, textAlign: 'center', lineHeight: 21, marginTop: 8 },
  emptyCard: { backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.lines, borderStyle: 'dashed', padding: 26, alignItems: 'center', marginTop: 18, gap: 6 },
  emptyTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 16, color: c.ink },
  emptySub: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, textAlign: 'center' },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.navy, borderRadius: 12, paddingVertical: 15, marginTop: 18 },
  addTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 16 },
  addBtnAlt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines, borderRadius: 12, paddingVertical: 15, marginTop: 12 },
  addTxtAlt: { color: c.navy, fontFamily: theme.fonts.bodyBold, fontSize: 16 },
  tip: { flexDirection: 'row', gap: 10, backgroundColor: c.navySoft, borderRadius: 12, padding: 14, marginTop: 16 },
  tipTxt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, lineHeight: 19 },
});
