import { View, Text, ScrollView, Pressable, StyleSheet, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { tr } from '@/src/ui18n';

const c = theme.colors;

export default function Home() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, language } = useAuth();
  const lang = language.code;
  const name = user?.name?.split(' ')[0] || tr('me.guest', lang);
  const place = user?.state_name || 'India';

  const journeys = [
    { key: 'j.shield',   sub: 'महिला सुरक्षा', icon: 'shield-half', route: '/women-shield', navy: true, isNew: true },
    { key: 'j.missing',  sub: 'गुमशुदा',      icon: 'people-outline', route: '/missing' },
    { key: 'j.police',   sub: 'पुलिस',        icon: 'ribbon-outline', route: '/fir-draft' },
    { key: 'j.visitor',  sub: 'पर्यटक',       icon: 'globe-outline', route: '/visitor' },
    { key: 'j.cyber',    sub: 'साइबर',        icon: 'desktop-outline', route: '/fraud-checklist' },
    { key: 'j.consumer', sub: 'उपभोक्ता',     icon: 'cart-outline', route: '/all-help' },
    { key: 'j.voter',    sub: 'मतदाता',       icon: 'checkbox-outline', route: '/(tabs)/voter-roll' },
    { key: 'home.allHelp', sub: 'सारी मदद',   icon: 'apps-outline', route: '/all-help', allHelp: true },
  ];

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
        {/* ── Navy header ─────────────────────────────── */}
        <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
          <View style={styles.headerRow}>
            <View style={styles.brandRow}>
              <View style={styles.logo}>
                <Image source={require('../../assets/images/dhara_icon.png')} style={styles.logoImg} resizeMode="cover" />
              </View>
              <View>
                <Text style={styles.brand}>DHARA</Text>
                <Text style={styles.tagline}>धारा · {tr('shell.tagline', lang)}</Text>
              </View>
            </View>
            <View style={styles.headerActions}>
              <Pressable style={styles.langPill} onPress={() => router.push('/language')}>
                <Ionicons name="globe-outline" size={14} color="#fff" />
                <Text style={styles.langTxt} numberOfLines={1}>{language.native}</Text>
              </Pressable>
            </View>
          </View>

          <Text style={styles.greeting}>{tr('home.greeting', lang)}, {name}</Text>
          <View style={styles.metaRow}>
            <View style={styles.metaChip}>
              <Ionicons name="location-outline" size={13} color="#fff" />
              <Text style={styles.metaTxt}>{place}</Text>
            </View>
            <View style={styles.metaChip}>
              <Ionicons name="checkmark-circle-outline" size={13} color="#fff" />
              <Text style={styles.metaTxt}>{tr('home.offline', lang)}</Text>
            </View>
          </View>
        </View>

        {/* ── Ask card ─────────────────────────────────── */}
        <View style={styles.askCard}>
          <Text style={styles.askTitle}>{tr('home.askTitle', lang)}</Text>
          <Text style={styles.askSub}>{tr('home.askSub', lang)}</Text>
          <Pressable style={styles.micBtn} onPress={() => router.push('/ask')} testID="home-mic">
            <Ionicons name="mic" size={40} color={c.navy} />
          </Pressable>
          <Text style={styles.holdTxt}>{tr('home.holdToSpeak', lang)}</Text>
          <View style={styles.askActions}>
            <Pressable style={styles.askAction} onPress={() => router.push('/ask?mode=type')}>
              <Ionicons name="create-outline" size={18} color={c.navy} />
              <Text style={styles.askActionTxt}>{tr('home.type', lang)}</Text>
            </Pressable>
            <Pressable style={styles.askAction} onPress={() => router.push('/scan')}>
              <Ionicons name="camera-outline" size={18} color={c.navy} />
              <Text style={styles.askActionTxt}>{tr('home.scan', lang)}</Text>
            </Pressable>
          </View>
          <Text style={styles.tryLabel}>{tr('home.trySaying', lang).toUpperCase()}</Text>
          {['home.try1', 'home.try2', 'home.try3'].map(k => (
            <Pressable key={k} style={styles.tryChip} onPress={() => router.push('/ask')}>
              <Text style={styles.tryChipTxt}>{tr(k, lang)}</Text>
            </Pressable>
          ))}
        </View>

        {/* ── For you right now ────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.sectionTitleRow}>
            <Ionicons name="sparkles" size={18} color={c.darkGold} />
            <Text style={styles.sectionTitle}>{tr('home.forYou', lang)}</Text>
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
          <View style={[styles.forYouCard, { backgroundColor: c.navy }]}>
            <View style={styles.forYouTag}>
              <Ionicons name="time-outline" size={13} color={c.gold} />
              <Text style={styles.forYouTagTxt}>FILE #2</Text>
            </View>
            <Text style={styles.forYouTitle}>Your next step is due in 3 days</Text>
            <Text style={styles.forYouBody}>Collect your medical report. I can draft the request for you.</Text>
            <Pressable style={styles.goldBtn} onPress={() => router.push('/(tabs)/myfiles')}>
              <Text style={styles.goldBtnTxt}>Review</Text>
            </Pressable>
          </View>
          <View style={[styles.forYouCard, styles.forYouCardLight]}>
            <View style={styles.forYouTag}>
              <Ionicons name="navigate-outline" size={13} color={c.darkGold} />
              <Text style={[styles.forYouTagTxt, { color: c.darkGold }]}>TONIGHT</Text>
            </View>
            <Text style={[styles.forYouTitle, { color: c.ink }]}>Heading out?</Text>
            <Text style={[styles.forYouBody, { color: c.muted }]}>Start a safe-journey check-in with your trusted circle.</Text>
            <Pressable style={styles.navyBtn} onPress={() => router.push('/women-shield')}>
              <Text style={styles.navyBtnTxt}>Start</Text>
            </Pressable>
          </View>
        </ScrollView>

        {/* ── Help journeys ────────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.rowBetween}>
            <View>
              <Text style={styles.h2}>{tr('home.journeys', lang)}</Text>
              <Text style={styles.h2sub}>{tr('home.journeysSub', lang)}</Text>
            </View>
            <Pressable onPress={() => router.push('/all-help')}>
              <Text style={styles.link}>{tr('home.allHelp', lang)}</Text>
            </Pressable>
          </View>
          <View style={styles.grid}>
            {journeys.map(j => (
              <Pressable
                key={j.key}
                style={[styles.tile, j.navy && styles.tileNavy]}
                onPress={() => router.push(j.route as any)}
                testID={`journey-${j.key}`}
              >
                {j.isNew && <View style={styles.newBadge}><Text style={styles.newTxt}>{tr('common.new', lang)}</Text></View>}
                <Ionicons name={j.icon as any} size={26} color={j.navy ? c.gold : c.navy} />
                <Text style={[styles.tileTitle, j.navy && { color: '#fff' }]} numberOfLines={2}>{tr(j.key, lang)}</Text>
                <Text style={[styles.tileSub, j.navy && { color: c.onNavyMuted }]} numberOfLines={1}>{j.sub}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* ── Verified strip ───────────────────────────── */}
        <View style={styles.verified}>
          <Ionicons name="checkmark-circle" size={20} color={c.verifiedGreen} />
          <Text style={styles.verifiedTxt}>
            <Text style={{ fontFamily: theme.fonts.bodyBold, color: c.ink }}>{tr('home.verified', lang)} </Text>
            {tr('home.verifiedSub', lang)}
          </Text>
          <Pressable onPress={() => router.push('/ask')}><Text style={styles.verifiedWhy}>{tr('home.why', lang)}</Text></Pressable>
        </View>

        {/* ── My files preview ─────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.rowBetween}>
            <Text style={styles.h2}>{tr('home.myFiles', lang)}</Text>
            <Pressable onPress={() => router.push('/(tabs)/myfiles')}><Text style={styles.link}>{tr('home.seeAll', lang)}</Text></Pressable>
          </View>
          <Pressable style={styles.fileCard} onPress={() => router.push('/(tabs)/myfiles')}>
            <View style={styles.fileIcon}><Ionicons name="lock-closed-outline" size={20} color={c.darkGold} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fileTitle}>File #2</Text>
              <Text style={styles.fileSub}>{tr('mf.step', lang)} 2 of 6 · updated 27 Sep</Text>
              <View style={styles.progressTrack}><View style={[styles.progressFill, { width: '33%' }]} /></View>
            </View>
            <Ionicons name="chevron-forward" size={20} color={c.onSurfaceTertiary} />
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  header: { backgroundColor: c.navy, paddingHorizontal: 20, paddingBottom: 54, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 44, height: 44, borderRadius: 12, borderWidth: 1.5, borderColor: c.gold, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: '#fff' },
  logoImg: { width: '100%', height: '100%' },
  brand: { color: '#fff', fontFamily: theme.fonts.displayBold, fontSize: 24, letterSpacing: 1 },
  tagline: { color: c.onNavyMuted, fontFamily: theme.fonts.body, fontSize: 11 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginRight: 72 },
  langPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.14)', paddingHorizontal: 12, height: 40, borderRadius: 999, maxWidth: 92 },
  langTxt: { color: '#fff', fontFamily: theme.fonts.bodySemiBold, fontSize: 13 },
  greeting: { color: '#fff', fontFamily: theme.fonts.displayBold, fontSize: 26, marginTop: 18 },
  metaRow: { flexDirection: 'row', gap: 10, marginTop: 12, flexWrap: 'wrap' },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  metaTxt: { color: '#fff', fontFamily: theme.fonts.bodyMedium, fontSize: 12 },

  askCard: { backgroundColor: c.surface, marginHorizontal: 16, marginTop: -36, borderRadius: 24, padding: 22, alignItems: 'center', shadowColor: c.shadow, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 1, shadowRadius: 16, elevation: 4 },
  askTitle: { fontFamily: theme.fonts.displayBold, fontSize: 24, color: c.ink, textAlign: 'center' },
  askSub: { fontFamily: theme.fonts.body, fontSize: 14, color: c.muted, textAlign: 'center', marginTop: 4 },
  micBtn: { width: 110, height: 110, borderRadius: 55, backgroundColor: c.gold, alignItems: 'center', justifyContent: 'center', marginVertical: 20, shadowColor: c.darkGold, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6 },
  holdTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 14, color: c.ink },
  askActions: { flexDirection: 'row', gap: 12, marginTop: 18, width: '100%' },
  askAction: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: c.lines, borderRadius: 14, paddingVertical: 14 },
  askActionTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 15, color: c.navy },
  tryLabel: { alignSelf: 'flex-start', fontFamily: theme.fonts.bodyBold, fontSize: 11, color: c.onSurfaceTertiary, letterSpacing: 1, marginTop: 20, marginBottom: 8 },
  tryChip: { alignSelf: 'flex-start', backgroundColor: c.surfaceSecondary, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10, marginBottom: 8 },
  tryChipTxt: { fontFamily: theme.fonts.body, fontSize: 14, color: c.ink },

  section: { paddingHorizontal: 20, marginTop: 24 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontFamily: theme.fonts.displayBold, fontSize: 22, color: c.ink },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 14 },
  h2: { fontFamily: theme.fonts.displayBold, fontSize: 22, color: c.ink },
  h2sub: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, marginTop: 2 },
  link: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.navy },

  shelf: { paddingHorizontal: 20, paddingTop: 14, gap: 14 },
  forYouCard: { width: 280, borderRadius: 20, padding: 18, justifyContent: 'space-between', minHeight: 170 },
  forYouCardLight: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines },
  forYouTag: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  forYouTagTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 11, color: c.gold, letterSpacing: 1 },
  forYouTitle: { fontFamily: theme.fonts.displayBold, fontSize: 19, color: '#fff' },
  forYouBody: { fontFamily: theme.fonts.body, fontSize: 13, color: c.onNavyMuted, marginTop: 6, marginBottom: 12 },
  goldBtn: { backgroundColor: c.gold, borderRadius: 12, paddingVertical: 11, alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 24 },
  goldBtnTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.navy },
  navyBtn: { backgroundColor: c.navy, borderRadius: 12, paddingVertical: 11, alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 24 },
  navyBtnTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: '#fff' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 },
  tile: { width: '47%', backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.lines, padding: 16, gap: 6, minHeight: 112 },
  tileNavy: { backgroundColor: c.navy, borderColor: c.navy },
  tileTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.ink, marginTop: 4 },
  tileSub: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted },
  newBadge: { position: 'absolute', top: 12, right: 12, backgroundColor: c.goldSoft, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  newTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 9, color: c.darkGold, letterSpacing: 0.5 },

  verified: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.successSoft, marginHorizontal: 20, marginTop: 24, borderRadius: 14, padding: 14 },
  verifiedTxt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, lineHeight: 18 },
  verifiedWhy: { fontFamily: theme.fonts.bodyBold, fontSize: 13, color: c.verifiedGreen, textDecorationLine: 'underline' },

  fileCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.lines, padding: 16 },
  fileIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: c.goldMuted, alignItems: 'center', justifyContent: 'center' },
  fileTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 16, color: c.ink },
  fileSub: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 2 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: c.surfaceTertiary, marginTop: 8, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: c.gold },
});
