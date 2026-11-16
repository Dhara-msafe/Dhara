import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { useRightsCard } from '@/src/hooks/useRightsCard';
import { useScreenSpeech } from '@/src/hooks/useScreenSpeech';
import { openPhone } from '@/src/women/helpActions';

const c = theme.colors;

// Human-readable scenario titles mapped from backend keys
const SCENARIO_TITLES: Record<string, string> = {
  police_wont_file:    'Police refusing to file a complaint (FIR)',
  violence_at_home:    'Domestic violence or harassment at home',
  thrown_out_of_home:  'Thrown out of home / shelter needed',
  dowry_demands:       'Dowry demands or harassment',
  harassment_at_work:  'Workplace sexual harassment (POSH)',
  stalking_online_abuse:'Stalking or online abuse',
  private_photos_leaked:'Private photos or videos leaked',
  after_assault:       'After sexual assault — next steps',
  woman_arrested:      'Woman being arrested — your rights',
  children_safety:     'Child safety or custody concern',
};

export default function OfficerCard() {
  const router = useRouter();
  const { language } = useAuth();
  const params = useLocalSearchParams<{ scenario?: string }>();
  const { result: res, loading, error, retry } = useRightsCard(params.scenario || 'police_wont_file', language.code);
  const speech = useScreenSpeech();
  const stopSpeech = speech.stop;
  const insets = useSafeAreaInsets();
  const [callStatus, setCallStatus] = useState('');
  const [showSource, setShowSource] = useState(false);
  const [showRefused, setShowRefused] = useState(false);
  const [silent, setSilent] = useState(false);

  const card = res?.card;

  // A4 — Silent toggle: nothing is ever spoken aloud at a counter unless the
  // citizen explicitly leaves Silent off. Stop immediately if she flips it on.
  useEffect(() => {
    if (silent) stopSpeech();
  }, [silent, stopSpeech]);

  const speakVerdict = () => {
    if (silent || !card) return;
    // B-94/B-79: fixed, canned safety content -- never metered, so this
    // works even for a user with 0 free legal questions left today.
    void speech.listen(card.verdict, 'fixed_screen');
  };

  return (
    <View style={styles.root} testID="officer-card-screen">
      <View style={[styles.bar, { paddingTop: insets.top + 8 }]}>
        <Pressable testID="officer-close" onPress={() => router.back()} style={styles.back}><Ionicons name="close" size={26} color="#fff" /></Pressable>
        <Text style={styles.barTitle}>Officer card</Text>
        <Pressable
          testID="officer-silent-toggle"
          onPress={() => setSilent((v) => !v)}
          style={[styles.silentBtn, silent && styles.silentBtnOn]}
        >
          <Ionicons name={silent ? 'volume-mute' : 'volume-high-outline'} size={16} color={silent ? c.navy : '#fff'} />
          <Text style={[styles.silentTxt, silent && { color: c.navy }]}>Silent</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 22, paddingBottom: insets.bottom + 40 }}>
        <Text style={styles.kicker}>SHOW THIS TO THE OFFICER</Text>
        {loading ? <ActivityIndicator testID="officer-loading" color={c.gold} /> : card ? (
          <>
            <Pressable onPress={speakVerdict} disabled={silent} testID="officer-speak-verdict">
              <Text testID="officer-verdict" style={styles.big}>{card.verdict}</Text>
              <Text testID="officer-speech-status" style={styles.why}>{silent ? 'Silent mode is on' : speech.blocked ? 'Tap to play voice' : speech.speaking ? 'Tap to stop audio' : 'Tap to listen'}</Text>
            </Pressable>
            {card.original?.verdict ? (
              <View style={styles.originalBox}>
                <Text style={styles.originalLabel}>ENGLISH (for the officer)</Text>
                <Text style={styles.originalTxt}>{card.original.verdict}</Text>
              </View>
            ) : null}
            {card.law?.map((l: any, i: number) => (
              <View key={i} style={styles.lawChip}><Ionicons name="book-outline" size={15} color="#fff" /><Text style={styles.lawTxt}>{l.act} {l.section}</Text></View>
            ))}
            {card.why ? <Text style={styles.why}>{card.why}</Text> : null}

            <View style={styles.actionRow}>
              <Pressable style={styles.actionBtn} onPress={() => setShowSource((v) => !v)} testID="officer-show-source">
                <Ionicons name="document-text-outline" size={16} color="#fff" />
                <Text style={styles.actionTxt}>Show source</Text>
              </Pressable>
              {card.if_refused ? (
                <Pressable style={styles.actionBtn} onPress={() => setShowRefused((v) => !v)} testID="officer-what-if-refused">
                  <Ionicons name="help-circle-outline" size={16} color="#fff" />
                  <Text style={styles.actionTxt}>What if they refuse?</Text>
                </Pressable>
              ) : null}
            </View>
            {showSource && (
              <View style={styles.revealBox}>
                <Text style={styles.revealTxt}>
                  {card.law?.length
                    ? card.law.map((l: any, i: number) => `${l.act} ${l.section}${l.status ? ` (${l.status})` : ''}`).join('\n')
                    : 'Source citation is pending advocate review.'}
                </Text>
              </View>
            )}
            {showRefused && card.if_refused && (
              <View style={styles.revealBox}>
                <Text style={styles.revealTxt}>{card.if_refused}</Text>
              </View>
            )}
          </>
        ) : (
          <>
            {/* Show matched scenario name if we got a result but no card */}
            {res?.scenario_key && (
              <View style={styles.scenarioBox}>
                <Ionicons name="search-circle-outline" size={18} color={c.gold} />
                <Text style={styles.scenarioTxt}>
                  {SCENARIO_TITLES[res.scenario_key] || res.scenario_key.replace(/_/g, ' ')}
                </Text>
              </View>
            )}
            <Text testID="officer-unavailable" style={styles.big}>
              {error || 'A rights card for this situation is being reviewed by an advocate.'}
            </Text>
            <View style={styles.pendingChip}>
              <Ionicons name="time-outline" size={14} color={c.navy} />
              <Text style={styles.pendingTxt}>Detailed law citations are pending advocate review before release</Text>
            </View>
            <Text style={styles.why}>
              Ask DHARA your question below — it checks live law before answering, even without a pre-built card.
            </Text>
            {!!error && <Pressable testID="officer-retry" style={styles.askBtn} onPress={retry}><Text style={styles.askTxt}>Try again</Text></Pressable>}
            <Pressable testID="officer-ask-dhara" style={styles.askBtn} onPress={() => router.push({ pathname: '/(tabs)', params: { autostartMic: Date.now().toString() } })}>
              <Ionicons name="mic" size={18} color={c.navy} />
              <Text style={styles.askTxt}>Ask DHARA now</Text>
            </Pressable>
          </>
        )}
        {!!speech.error && <Text testID="officer-speech-error" accessibilityLiveRegion="polite" style={styles.why}>{speech.error}</Text>}
        {!!callStatus && <Text testID="officer-call-status" style={styles.why}>{callStatus}</Text>}

        <View style={styles.hlRow}>
          {(res?.services || []).slice(0, 3).map(s => (
            <Pressable key={s.service_id} testID={`officer-call-${s.number}`} style={styles.hl} onPress={async () => setCallStatus(await openPhone(s.number))}>
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
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
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
  silentBtn: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 5, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  silentBtnOn: { backgroundColor: c.gold },
  silentTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 12 },
  originalBox: { backgroundColor: 'rgba(255,255,255,0.08)', borderLeftWidth: 3, borderLeftColor: c.gold, borderRadius: 10, padding: 14, marginTop: 14 },
  originalLabel: { color: c.gold, fontFamily: theme.fonts.bodyBold, fontSize: 11, letterSpacing: 1 },
  originalTxt: { color: '#fff', fontFamily: theme.fonts.body, fontSize: 15, lineHeight: 22, marginTop: 6 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 20, flexWrap: 'wrap' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10 },
  actionTxt: { color: '#fff', fontFamily: theme.fonts.bodySemiBold, fontSize: 13 },
  revealBox: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, padding: 14, marginTop: 10 },
  revealTxt: { color: '#fff', fontFamily: theme.fonts.body, fontSize: 14, lineHeight: 20 },
  scenarioBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 12, padding: 12, marginBottom: 14 },
  scenarioTxt: { flex: 1, color: c.gold, fontFamily: theme.fonts.bodySemiBold, fontSize: 14, lineHeight: 20 },
});
