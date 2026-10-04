import { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { tr } from '@/src/ui18n';
import { useScreenSpeech } from '@/src/hooks/useScreenSpeech';
import { useRightsCard } from '@/src/hooks/useRightsCard';

const c = theme.colors;

// Maps each "Know your rights" scenario to the i18n key used for its chip
// label — keeps the situation chip and the loaded rights card in sync with
// whichever tile the woman actually tapped on women-shield.tsx.
const SCENARIO_LABEL_KEY: Record<string, string> = {
  police_wont_file: 'ws.r.police',
  violence_at_home: 'ws.r.violence',
  thrown_out_of_home: 'ws.r.thrown',
  dowry_demands: 'ws.r.dowry',
  harassment_at_work: 'ws.r.work',
  stalking_online_abuse: 'ws.r.stalking',
  private_photos_leaked: 'ws.r.photos',
  after_assault: 'ws.r.assault',
  woman_arrested: 'ws.r.arrested',
  children_safety: 'ws.r.children',
};

export default function ActionPlan() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { language, user } = useAuth();
  const lang = language.code;
  const params = useLocalSearchParams<{ scenario?: string }>();
  const scenarioKey = params.scenario || 'police_wont_file';
  const [answered, setAnswered] = useState(false);
  const { speaking, blocked, error: speechError, listen } = useScreenSpeech();
  const { result, loading, error: cardError, retry } = useRightsCard(scenarioKey, lang);
  const card = result?.card;
  const onListen = useCallback(() => { if (card) void listen(`${card.verdict} ${card.why}`); }, [card, listen]);

  const steps = [
    { n: 1, title: 'Show this to the officer', body: 'A large-text card with the law in your selected language.', btn: 'Open officer card', icon: 'shield-outline', route: '/women/officer-card' },
    { n: 2, title: 'If they still refuse', body: card?.if_refused || 'Open the released rights card for the applicable procedure.', btn: 'Prepare my complaint', icon: 'document-text-outline', route: '/fir-draft' },
    { n: 3, title: 'Keep proof safely', body: 'Record only when safe. Save local audio before leaving the recording screen.', btn: 'Open evidence locker', icon: 'mic-outline', route: '/women/evidence-locker' },
    { n: 4, title: 'Talk to someone free', body: 'Legal aid 15100 · Women’s helpline 181', btn: 'Call now', icon: 'call-outline', route: 'tel:15100' },
  ];

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable testID="action-plan-back" onPress={() => router.back()} style={styles.iconBtn}><Ionicons name="chevron-back" size={24} color={c.navy} /></Pressable>
        <Text style={styles.headerTitle}>{tr('ap.title', lang)}</Text>
        <Pressable testID="action-plan-listen-header" disabled={!card} style={styles.listenPill} onPress={onListen}><Ionicons name={speaking ? 'stop' : 'volume-high'} size={20} color={c.darkGold} /></Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* Situation chips */}
        <View style={styles.chipRow}>
          <View style={styles.chip}><Ionicons name="sparkles" size={13} color={c.darkGold} /><Text style={styles.chipTxt}>{tr(SCENARIO_LABEL_KEY[scenarioKey] || 'ws.r.police', lang)}</Text></View>
          <View style={styles.chip}><Ionicons name="location-outline" size={13} color={c.darkGold} /><Text style={styles.chipTxt}>{user?.state_name || 'India'}</Text></View>
        </View>
        <Pressable testID="action-plan-change-question" onPress={() => router.push('/(tabs)')}><Text style={styles.notRight}>{tr('ap.notright', lang)}</Text></Pressable>

        {/* Your right card */}
        <View style={styles.rightCard}>
          <Text style={styles.rightLabel}>{tr('ap.yourright', lang)}</Text>
          <Text testID="action-plan-verdict" style={styles.rightTitle}>{card?.verdict || (loading ? 'Loading your rights…' : cardError || 'No released rights card is available yet.')}</Text>
          {!!card?.why && <Text testID="action-plan-explanation" style={styles.rightBody}>{card.why}</Text>}
          {!!cardError && <Pressable testID="action-plan-retry" style={styles.listenBtn} onPress={retry}><Text style={styles.listenBtnTxt}>Try again</Text></Pressable>}
          {!!card && <View style={styles.badgeRow}>
            {card.law.map((law, index) => <View key={index} style={styles.badge}><Ionicons name="book-outline" size={13} color={c.onBrandPrimary} /><Text testID={`action-plan-law-${index}`} style={styles.badgeTxt}>{law.act} {law.section}</Text></View>)}
          </View>}
          <Pressable testID="action-plan-listen" disabled={!card} style={styles.listenBtn} onPress={onListen}>
            <Ionicons name={speaking ? 'stop' : 'volume-high'} size={18} color={c.navy} />
            <Text testID="action-plan-speech-status" style={styles.listenBtnTxt}>{blocked ? 'Tap to play voice' : speaking ? 'Stop' : tr('ap.listen', lang)} {language.native}</Text>
          </Pressable>
          {!!speechError && <Text testID="action-plan-speech-error" accessibilityLiveRegion="polite" style={styles.rightBody}>{speechError}</Text>}
        </View>

        {/* One quick question */}
        <View style={styles.qCard}>
          <View style={styles.qHead}><Ionicons name="sparkles" size={15} color={c.darkGold} /><Text style={styles.qLabel}>{tr('ap.question', lang)}</Text></View>
          <Text style={styles.qText}>Is the complaint about violence or harassment against you?</Text>
          <View style={styles.qActions}>
            <Pressable testID="action-plan-answer-yes" style={[styles.qBtn, answered && styles.qBtnActive]} onPress={() => setAnswered(true)}><Text style={styles.qBtnTxt}>{tr('ap.yes', lang)}</Text></Pressable>
            <Pressable testID="action-plan-answer-no" style={styles.qBtn} onPress={() => setAnswered(true)}><Text style={styles.qBtnTxt}>{tr('ap.no', lang)}</Text></Pressable>
            <Pressable testID="action-plan-answer-skip" onPress={() => setAnswered(true)}><Text style={styles.qSkip}>{tr('ap.skip', lang)}</Text></Pressable>
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
              <Pressable testID={`action-plan-step-${s.n}`} style={[styles.stepBtn, s.n === 1 && styles.stepBtnPrimary]} onPress={() => s.route.startsWith('tel:') ? Linking.openURL(s.route) : router.push(s.route === '/women/officer-card' ? { pathname: s.route, params: { scenario: scenarioKey } } as any : s.route as any)}>
                <Ionicons name={s.icon as any} size={16} color={s.n === 1 ? '#fff' : c.navy} />
                <Text style={[styles.stepBtnTxt, s.n === 1 && { color: '#fff' }]}>{s.btn}</Text>
              </Pressable>
            </View>
          </View>
        ))}

        {/* Save */}
        <Pressable testID="action-plan-myfiles" style={styles.saveRow} onPress={() => router.push('/(tabs)/myfiles')}>
          <Ionicons name="lock-closed-outline" size={18} color={c.darkGold} />
          <Text style={styles.saveTxt}>{tr('ap.save', lang)}</Text>
          <Ionicons name="chevron-forward" size={18} color={c.onSurfaceTertiary} />
        </Pressable>

        <Text testID="action-plan-disclaimer" style={styles.footer}>{tr('ap.notlawyer', lang)}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, backgroundColor: c.background, borderBottomWidth: 1, borderBottomColor: c.lines },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: theme.fonts.displayBold, fontSize: 20, color: c.ink },
  listenPill: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.goldMuted, alignItems: 'center', justifyContent: 'center' },
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
