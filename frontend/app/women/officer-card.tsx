import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Linking } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { safetyRoute, type RouteResult } from '@/src/women/api';

const c = theme.colors;

export default function OfficerCard() {
  const router = useRouter();
  const { language } = useAuth();
  const params = useLocalSearchParams<{ scenario?: string }>();
  const [res, setRes] = useState<RouteResult | null>(null);

  useEffect(() => {
    safetyRoute({ scenario_key: params.scenario || 'police_wont_file', lang: language.code }).then(setRes);
  }, [params.scenario, language.code]);

  const card = res?.card;

  return (
    <View style={styles.root}>
      <View style={styles.bar}>
        <Pressable onPress={() => router.back()} style={styles.back}><Ionicons name="close" size={26} color="#fff" /></Pressable>
        <Text style={styles.barTitle}>Officer card</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 22, paddingBottom: 40 }}>
        <Text style={styles.kicker}>SHOW THIS TO THE OFFICER</Text>
        {card ? (
          <>
            <Text style={styles.big}>{card.verdict}</Text>
            {card.law?.map((l: any, i: number) => (
              <View key={i} style={styles.lawChip}><Ionicons name="book-outline" size={15} color="#fff" /><Text style={styles.lawTxt}>{l.act} {l.section}</Text></View>
            ))}
            {card.why ? <Text style={styles.why}>{card.why}</Text> : null}
          </>
        ) : (
          <>
            <Text style={styles.big}>I have the right to be heard, and my complaint must be recorded.</Text>
            <View style={styles.pendingChip}><Ionicons name="time-outline" size={14} color={c.navy} /><Text style={styles.pendingTxt}>Detailed law is being advocate-verified</Text></View>
            <Text style={styles.why}>Open DHARA and ask your question to get the exact section and procedure, checked against current law before you see it.</Text>
            <Pressable style={styles.askBtn} onPress={() => router.push('/(tabs)')}>
              <Ionicons name="mic" size={18} color={c.navy} />
              <Text style={styles.askTxt}>Ask DHARA now</Text>
            </Pressable>
          </>
        )}

        <View style={styles.hlRow}>
          {(res?.services || []).slice(0, 3).map(s => (
            <Pressable key={s.service_id} style={styles.hl} onPress={() => Linking.openURL(`tel:${s.number}`)}>
              <Text style={styles.hlNum}>{s.number}</Text>
              <Text style={styles.hlName} numberOfLines={1}>{s.name}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.navy },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 44, paddingHorizontal: 12, paddingBottom: 10 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  barTitle: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 17 },
  kicker: { color: c.gold, fontFamily: theme.fonts.bodyBold, fontSize: 13, letterSpacing: 1.5, marginBottom: 14 },
  big: { color: '#fff', fontFamily: theme.fonts.displayBold, fontSize: 32, lineHeight: 42 },
  lawChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, alignSelf: 'flex-start', marginTop: 16 },
  lawTxt: { color: '#fff', fontFamily: theme.fonts.bodySemiBold, fontSize: 15 },
  why: { color: c.onNavyMuted, fontFamily: theme.fonts.body, fontSize: 17, lineHeight: 26, marginTop: 18 },
  pendingChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.gold, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, alignSelf: 'flex-start', marginTop: 18 },
  pendingTxt: { color: c.navy, fontFamily: theme.fonts.bodySemiBold, fontSize: 13 },
  askBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.gold, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 20, alignSelf: 'flex-start', marginTop: 20 },
  askTxt: { color: c.navy, fontFamily: theme.fonts.bodyBold, fontSize: 16 },
  hlRow: { flexDirection: 'row', gap: 12, marginTop: 34 },
  hl: { flex: 1, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  hlNum: { color: '#fff', fontFamily: theme.fonts.displayBold, fontSize: 22 },
  hlName: { color: c.onNavyMuted, fontFamily: theme.fonts.body, fontSize: 11, marginTop: 2 },
});
