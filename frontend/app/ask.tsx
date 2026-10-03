import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, TextInput, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { tr } from '@/src/ui18n';
import { SosPill, QuickExit } from '@/src/components/dhara/SosPill';

const c = theme.colors;

export default function Ask() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { language } = useAuth();
  const lang = language.code;
  const params = useLocalSearchParams<{ mode?: string }>();
  const [phase, setPhase] = useState<'idle' | 'listening' | 'heard' | 'type'>(
    params.mode === 'type' ? 'type' : 'idle',
  );
  const [typed, setTyped] = useState('');
  const pulse = useRef(new Animated.Value(0)).current;
  const bars = useRef(Array.from({ length: 13 }, () => new Animated.Value(0.3))).current;

  useEffect(() => {
    if (phase !== 'listening') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    const barLoops = bars.map((b, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(b, { toValue: 1, duration: 300 + (i % 5) * 90, useNativeDriver: false }),
          Animated.timing(b, { toValue: 0.25, duration: 300 + (i % 4) * 90, useNativeDriver: false }),
        ]),
      ),
    );
    barLoops.forEach(l => l.start());
    // Auto-advance to the confirmation after a short "listen" window.
    const t = setTimeout(() => setPhase('heard'), 2600);
    return () => { loop.stop(); barLoops.forEach(l => l.stop()); clearTimeout(t); };
  }, [phase]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.topRow}>
        <QuickExit dark />
        <Pressable style={styles.langPill} onPress={() => router.push('/language')}>
          <Ionicons name="globe-outline" size={14} color="#fff" />
          <Text style={styles.langTxt}>{language.native} · {tr('listen.auto', lang)}</Text>
        </Pressable>
      </View>

      {phase === 'type' ? (
        <View style={styles.typeWrap}>
          <Text style={styles.typeLabel}>{tr('home.askTitle', lang)}</Text>
          <TextInput
            value={typed}
            onChangeText={setTyped}
            placeholder={tr('all.search', lang)}
            placeholderTextColor={c.onNavyMuted}
            style={styles.input}
            multiline
            autoFocus
          />
          <Pressable style={styles.goldWide} onPress={() => router.push('/action-plan')}>
            <Text style={styles.goldWideTxt}>{tr('ap.title', lang)}</Text>
          </Pressable>
          <Pressable style={styles.switchRow} onPress={() => setPhase('idle')}>
            <Ionicons name="mic-outline" size={18} color={c.gold} />
            <Text style={styles.switchTxt}>{tr('home.holdToSpeak', lang)}</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.center} showsVerticalScrollIndicator={false}>
          <Pressable
            onPressIn={() => setPhase('listening')}
            onPressOut={() => phase === 'listening' && setPhase('heard')}
            testID="ask-orb"
          >
            <Animated.View style={[styles.ring3, phase === 'listening' && { transform: [{ scale }] }]}>
              <View style={styles.ring2}>
                <View style={styles.orb}>
                  <Ionicons name="mic" size={46} color={c.navy} />
                </View>
              </View>
            </Animated.View>
          </Pressable>

          {phase === 'listening' && (
            <View style={styles.waveRow}>
              {bars.map((b, i) => (
                <Animated.View key={i} style={[styles.bar, { height: b.interpolate({ inputRange: [0, 1], outputRange: [8, 44] }) }]} />
              ))}
            </View>
          )}

          <Text style={styles.status}>
            {phase === 'listening' ? tr('listen.listening', lang) : tr('listen.hold', lang)}
          </Text>

          {phase === 'heard' && (
            <View style={styles.heardCard}>
              <Text style={styles.heardLabel}>{tr('listen.weheard', lang)}</Text>
              <Text style={styles.heardText}>“पुलिस वाले मेरी शिकायत नहीं लिख रहे, कह रहे हैं दूसरे थाने जाओ।”</Text>
              <Text style={styles.heardTranslate}>The police won’t write my complaint; they say go to another station.</Text>
              <View style={styles.heardActions}>
                <Pressable style={styles.goldBtn} onPress={() => router.push('/action-plan')}>
                  <Text style={styles.goldBtnTxt}>{tr('listen.yes', lang)}</Text>
                </Pressable>
                <Pressable style={styles.ghostBtn} onPress={() => setPhase('type')}>
                  <Text style={styles.ghostTxt}>{tr('listen.edit', lang)}</Text>
                </Pressable>
                <Pressable style={styles.ghostBtn} onPress={() => setPhase('idle')}>
                  <Text style={styles.ghostTxt}>{tr('listen.again', lang)}</Text>
                </Pressable>
              </View>
            </View>
          )}
        </ScrollView>
      )}

      <View style={styles.bottomRow}>
        <View style={styles.notStored}>
          <Ionicons name="lock-closed-outline" size={14} color={c.onNavyMuted} />
          <Text style={styles.notStoredTxt}>{tr('listen.notstored', lang)}</Text>
        </View>
        <SosPill />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.deepNavy, paddingHorizontal: 20 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  langPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 14, height: 40, borderRadius: 999 },
  langTxt: { color: '#fff', fontFamily: theme.fonts.bodySemiBold, fontSize: 13 },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 20 },
  ring3: { width: 230, height: 230, borderRadius: 115, backgroundColor: 'rgba(211,182,117,0.12)', alignItems: 'center', justifyContent: 'center' },
  ring2: { width: 170, height: 170, borderRadius: 85, backgroundColor: 'rgba(211,182,117,0.18)', alignItems: 'center', justifyContent: 'center' },
  orb: { width: 118, height: 118, borderRadius: 59, backgroundColor: c.gold, alignItems: 'center', justifyContent: 'center' },
  waveRow: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 48, marginTop: 28 },
  bar: { width: 5, borderRadius: 3, backgroundColor: c.gold },
  status: { color: c.gold, fontFamily: theme.fonts.bodyBold, fontSize: 16, marginTop: 24, textAlign: 'center' },
  heardCard: { width: '100%', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 20, padding: 20, marginTop: 28 },
  heardLabel: { color: c.onNavyMuted, fontFamily: theme.fonts.bodyBold, fontSize: 12, letterSpacing: 1 },
  heardText: { color: '#fff', fontFamily: theme.fonts.displayBold, fontSize: 21, lineHeight: 30, marginTop: 10 },
  heardTranslate: { color: c.onNavyMuted, fontFamily: theme.fonts.body, fontSize: 14, fontStyle: 'italic', marginTop: 10 },
  heardActions: { flexDirection: 'row', gap: 10, marginTop: 20, flexWrap: 'wrap' },
  goldBtn: { backgroundColor: c.gold, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 22, flexGrow: 1, alignItems: 'center' },
  goldBtnTxt: { color: c.navy, fontFamily: theme.fonts.bodyBold, fontSize: 16 },
  ghostBtn: { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 20, alignItems: 'center' },
  ghostTxt: { color: '#fff', fontFamily: theme.fonts.bodySemiBold, fontSize: 15 },
  bottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  notStored: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  notStoredTxt: { color: c.onNavyMuted, fontFamily: theme.fonts.body, fontSize: 13 },
  typeWrap: { flex: 1, justifyContent: 'center' },
  typeLabel: { color: '#fff', fontFamily: theme.fonts.displayBold, fontSize: 24, marginBottom: 16 },
  input: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 16, padding: 16, color: '#fff', fontFamily: theme.fonts.body, fontSize: 16, minHeight: 120, textAlignVertical: 'top' },
  goldWide: { backgroundColor: c.gold, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 16 },
  goldWideTxt: { color: c.navy, fontFamily: theme.fonts.bodyBold, fontSize: 16 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 20 },
  switchTxt: { color: c.gold, fontFamily: theme.fonts.bodySemiBold, fontSize: 14 },
});
