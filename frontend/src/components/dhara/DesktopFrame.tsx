import { ReactNode, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, usePathname } from 'expo-router';
import { theme } from '../../theme';
import { useAuth } from '../../auth';
import { tr } from '../../ui18n';
import { useComplaintsPassive, isDraftReady, complaintTitle, complaintProgress } from '../../home/complaints';
import { ADVOCATE_MODE_ENABLED } from '../../advocateMode/flags';
import { UI_V22_P5_HOME, UI_V22_P6, UI_V22_ONE_SOS } from '../../uiV22Flags';
import { InDesktopFrameContext } from './desktopFrameContext';

const c = theme.colors;

/**
 * v2.2 rollout phase 2 (presentation-only, reversible). The v2.2 responsive
 * reference says: no promo rail on onboarding, consent, recording or
 * emergency screens, and one emergency entry, not three. With the flag ON,
 * "calm" routes (safety + onboarding, listed below) hide the right rail
 * ("Start your first case" / "Get the app") and the top-bar SOS chip, leaving
 * the sidebar "SOS · Emergency" as the single emergency entry; /emergency
 * itself also hides the sidebar entry (the user is already there). Flag OFF
 * (the default, including when the env var is unset) renders exactly the
 * pre-phase-2 frame. No navigation, data or safety logic changes either way.
 * Same rollback pattern as src/designRevision.ts.
 */
export const UI_V22_P2 = process.env.EXPO_PUBLIC_UI_V22_P2 === 'true';

/**
 * Safety + onboarding routes that get the calm desktop frame when UI_V22_P2
 * is ON. Prefix match. /consent, /login, /signup, /forgot-password and
 * /delete-account never reach this component at all (B-65 STANDALONE_ROUTES
 * in app/_layout.tsx renders them frameless), so they are not listed here.
 */
export const CALM_ROUTES = [
  '/language',
  '/how-it-helps',
  '/state',
  '/emergency',
  '/women-shield',
  '/women', // /women/head-out, /women/evidence-locker, /women/silent-alert, …
  '/family-journey',
  '/guardian',
] as const;

export function isCalmRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return CALM_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

type NavItem = { label: string; icon: any; route: string; match: string };

/**
 * C9 desktop web shell: left sidebar nav + centered app column + right rail.
 * Only used on wide browsers; the mobile layout is untouched on phones.
 */
export function DesktopFrame({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, language } = useAuth();
  const lang = language.code;

  // Same real case data as the Home shelf / My Files — keeps the rail in
  // sync instead of showing its own hardcoded sample.
  const { items: cases } = useComplaintsPassive();
  const activeCase = cases.find((i) => !isDraftReady(i));
  const readyCase = !activeCase ? cases.find((i) => isDraftReady(i)) : undefined;
  const railCase = activeCase || readyCase || null;
  const railProgress = railCase ? complaintProgress(railCase) : null;
  const openRailCase = () => {
    if (!railCase) { router.push('/engine'); return; }
    router.push(
      isDraftReady(railCase)
        ? ({ pathname: '/fir-draft/result', params: { sessionId: railCase.session_id } } as any)
        : ({ pathname: '/fir-draft', params: { resumeId: railCase.session_id } } as any),
    );
  };

  const nav: NavItem[] = [
    { label: tr('nav.home', lang), icon: 'home-outline', route: '/(tabs)/home', match: 'home' },
    { label: tr('nav.rights', lang), icon: 'book-outline', route: '/(tabs)/rights', match: 'rights' },
    { label: tr('nav.ask', lang), icon: 'mic-outline', route: '/(tabs)', match: 'ask' },
    { label: tr('nav.myfiles', lang), icon: 'folder-outline', route: '/(tabs)/myfiles', match: 'myfiles' },
    { label: tr('nav.me', lang), icon: 'person-outline', route: '/(tabs)/me', match: 'me' },
  ];
  const journeys: NavItem[] = [
    { label: 'Dhara Engine', icon: 'construct-outline', route: '/engine', match: 'engine' },
    { label: tr('home.allHelp', lang), icon: 'apps-outline', route: '/all-help', match: 'all-help' },
    { label: tr('j.shield', lang), icon: 'shield-half', route: '/women-shield', match: 'women-shield' },
    { label: tr('j.police', lang), icon: 'ribbon-outline', route: '/fir-draft', match: 'fir-draft' },
    { label: tr('j.cyber', lang), icon: 'desktop-outline', route: '/fraud-checklist', match: 'fraud' },
    { label: tr('all.emergency', lang), icon: 'warning-outline', route: '/emergency', match: 'emergency' },
  ];
  const active = (m: string) => !!pathname && pathname.includes('/' + m);
  // Home has its own calm layout — SOS lives in the Me tab there instead
  // (see app/(tabs)/me.tsx); still shown on every other screen/tab.
  //
  // B-99 fix: '/(tabs)' and '/' are the (tabs) group's own index route --
  // the Ask/chat screen (app/(tabs)/index.tsx), not Home. Matching them
  // here hid the top-bar SOS button and sidebar "SOS · Emergency" link on
  // the Ask screen (same bug, same stale pattern as app/(tabs)/_layout.tsx).
  const isHome = pathname === '/(tabs)/home' || pathname === '/home';
  // v2.2 phase 2: calm frame on safety/onboarding routes (flag-gated).
  const calm = UI_V22_P2 && isCalmRoute(pathname);
  const onEmergencyScreen = !!pathname && (pathname === '/emergency' || pathname.startsWith('/emergency/'));
  // v2.2 phase 5b: Home already shows the help list and the start-a-case
  // card, so on Home the sidebar list and the rail case card are hidden.
  const homeTidy = UI_V22_P5_HOME && isHome;
  // v2.2 phase 6 (manager preview check, 21 Nov): Home desktop must keep
  // exactly one emergency entry — the sidebar "SOS · Emergency" (top chip
  // stays off on Home). And once phase 5b has emptied the Home rail down to
  // the disclaimer, the rail is dropped on Home so the main column uses it.
  const sidebarSosOnHome = UI_V22_P6;
  const hideHomeRail = UI_V22_P6 && homeTidy;
  const [q, setQ] = useState('');

  const Item = ({ it }: { it: NavItem }) => (
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${it.label}`} style={[styles.navItem, active(it.match) && styles.navItemActive]} onPress={() => router.push(it.route as any)}>
      <Ionicons name={it.icon} size={20} color={active(it.match) ? c.navy : c.onNavyMuted} />
      <Text style={[styles.navTxt, active(it.match) && styles.navTxtActive]}>{it.label}</Text>
    </Pressable>
  );

  return (
    <View style={styles.shell}>
      {/* ── Top bar: search + sign-in + SOS ── */}
      <View style={styles.topbar}>
        <View style={styles.search}>
          <Ionicons name="search" size={18} color={c.onNavyMuted} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search help, rights or forms…"
            placeholderTextColor={c.onNavyMuted}
            style={styles.searchInput}
            accessibilityLabel="Search help, rights or forms"
            onSubmitEditing={() => {
              const query = q.trim();
              setQ('');
              router.push(query ? { pathname: '/all-help', params: { q: query } } : '/all-help');
            }}
            returnKeyType="search"
          />
        </View>
        <View style={styles.topRight}>
          {/* B-97: advocate/lawyer features are hidden for Wave 1 per D-14. */}
          {ADVOCATE_MODE_ENABLED && (
            <Pressable accessibilityRole="button" accessibilityLabel="For advocates" style={styles.topLink} onPress={() => router.push('/(tabs)/advocate')}>
              <Text style={styles.topLinkTxt}>For advocates</Text>
            </Pressable>
          )}
          <Pressable accessibilityRole="button" accessibilityLabel={`Change language, currently ${language.native}`} style={styles.langPill} onPress={() => router.push('/language')}>
            <Ionicons name="globe-outline" size={14} color="#fff" />
            <Text style={styles.langTxt}>{language.native}</Text>
          </Pressable>
          {user ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Open your profile, ${user.name || 'Me'}`} style={styles.userPill} onPress={() => router.push('/(tabs)/me')}>
              <View style={styles.userAvatar}><Text style={styles.userAvatarTxt}>{(user.name || 'U').charAt(0).toUpperCase()}</Text></View>
              <Text style={styles.userTxt} numberOfLines={1}>{(user.name || 'Me').split(' ')[0]}</Text>
            </Pressable>
          ) : (
            <Pressable accessibilityRole="button" accessibilityLabel="Sign in" style={styles.signInTop} onPress={() => router.push('/login')}>
              <Text style={styles.signInTopTxt}>Sign in</Text>
            </Pressable>
          )}
          {/* v2.2 phase 2: on calm routes the sidebar "SOS · Emergency" is the
              one emergency entry, so the top chip is hidden there. */}
          {/* UI_V22_ONE_SOS: the sidebar SOS is the one entry on desktop. */}
          {!isHome && !calm && !UI_V22_ONE_SOS && (
          <Pressable accessibilityRole="button" accessibilityLabel="Open emergency help" style={styles.sosTop} onPress={() => router.push('/emergency')}>
            <Ionicons name="warning-outline" size={16} color="#fff" />
            <Text style={styles.sosTopTxt}>SOS</Text>
          </Pressable>
          )}
        </View>
      </View>

      <View style={styles.row}>
      {/* ── Sidebar ── */}
      <View style={styles.sidebar}>
        <Pressable accessibilityRole="button" accessibilityLabel="DHARA home" style={styles.brand} onPress={() => router.push('/(tabs)/home')}>
          <View style={styles.logo}><Image source={require('../../../assets/images/dhara_mark.png')} style={styles.logoImg} resizeMode="contain" /></View>
          <View>
            <Text style={styles.brandTxt}>DHARA</Text>
            <Text style={styles.brandSub}>{tr('shell.tagline', lang)}</Text>
          </View>
        </Pressable>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
          {nav.map(it => <Item key={it.match} it={it} />)}
          {!homeTidy && (
            <>
              <Text style={styles.group}>{tr('home.journeys', lang).toUpperCase()}</Text>
              {journeys.map(it => <Item key={it.match} it={it} />)}
            </>
          )}
        </ScrollView>
        {/* v2.2 phase 2: on /emergency itself the user has arrived — no
            second entry pointing at the screen they are on. */}
        {(!isHome || sidebarSosOnHome) && !(calm && onEmergencyScreen) && (
        <Pressable accessibilityRole="button" accessibilityLabel="Open emergency help" style={styles.sos} onPress={() => router.push('/emergency')}>
          <Ionicons name="warning-outline" size={18} color="#fff" />
          <Text style={styles.sosTxt}>SOS · {tr('all.emergency', lang)}</Text>
        </Pressable>
        )}
      </View>

      {/* ── Centre app column ── */}
      <View style={styles.centerWrap}>
        <View style={styles.center}><InDesktopFrameContext.Provider value={true}>{children}</InDesktopFrameContext.Provider></View>
      </View>

      {/* ── Right rail ── */}
      {/* v2.2 phase 2: no promo rail ("Start your first case", "Get the
          app") on safety and onboarding screens. */}
      {calm || hideHomeRail ? null : (
      <ScrollView style={styles.rail} contentContainerStyle={{ padding: 16, gap: 16 }} showsVerticalScrollIndicator={false}>
        {!homeTidy && (
        <View style={styles.railCard}>
          <View style={styles.railTag}><Ionicons name="sparkles" size={13} color={c.darkGold} /><Text style={styles.railTagTxt}>{tr('home.forYou', lang).toUpperCase()}</Text></View>
          {railCase && railProgress ? (
            <>
              <Text style={styles.railTitle} numberOfLines={2}>{complaintTitle(railCase)}</Text>
              <Text style={styles.railBody}>{isDraftReady(railCase) ? 'Your complaint draft is ready to review.' : railProgress.label}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={isDraftReady(railCase) ? 'View your complaint draft' : 'Continue your case'} style={styles.railBtn} onPress={openRailCase}><Text style={styles.railBtnTxt}>{isDraftReady(railCase) ? 'View draft' : 'Continue'}</Text></Pressable>
            </>
          ) : (
            <>
              <Text style={styles.railTitle}>Start your first case</Text>
              <Text style={styles.railBody}>Tell DHARA what happened — we’ll help you draft a complaint, step by step.</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Start your first case" style={styles.railBtn} onPress={openRailCase}><Text style={styles.railBtnTxt}>Start</Text></Pressable>
            </>
          )}
        </View>
        )}

        {/* v2.2 phase 5b: hidden until launch — "available on Android and
            iOS" is not true yet and the QR is a placeholder icon. */}
        {!UI_V22_P5_HOME && (
        <View style={[styles.railCard, { backgroundColor: c.navy }]}>
          <Text style={styles.getApp}>Get the app</Text>
          <Text style={styles.getAppSub}>Scan to install DHARA on your phone — available on Android and iOS.</Text>
          <View style={styles.qr}><Ionicons name="qr-code-outline" size={84} color={c.navy} /></View>
        </View>
        )}

        <View style={styles.verified}>
          <Ionicons name="information-circle-outline" size={18} color={c.muted} />
          <Text style={styles.verifiedTxt}>Answers draw on the Indian legal corpus (BNS 2023, BNSS, Constitution). Not legal advice.</Text>
        </View>

        {!user && (
          <Pressable accessibilityRole="button" accessibilityLabel="Sign in" style={styles.signIn} onPress={() => router.push('/login')}><Text style={styles.signInTxt}>Sign in</Text></Pressable>
        )}
      </ScrollView>
      )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: c.deepNavy },
  topbar: { flexDirection: 'row', alignItems: 'center', gap: 16, height: 60, paddingHorizontal: 16, backgroundColor: c.navy, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  search: { flex: 1, maxWidth: 520, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 999, paddingHorizontal: 16, height: 40 },
  searchInput: { flex: 1, color: '#fff', fontFamily: theme.fonts.body, fontSize: 13, ...(({ outlineStyle: 'none' }) as any) },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 12, marginLeft: 'auto' },
  topLink: { paddingHorizontal: 6 },
  topLinkTxt: { color: c.onNavyMuted, fontFamily: theme.fonts.bodySemiBold, fontSize: 13 },
  langPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 12, height: 36, borderRadius: 999 },
  langTxt: { color: '#fff', fontFamily: theme.fonts.bodySemiBold, fontSize: 12 },
  userPill: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.1)', paddingLeft: 4, paddingRight: 14, height: 36, borderRadius: 999 },
  userAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: c.gold, alignItems: 'center', justifyContent: 'center' },
  userAvatarTxt: { color: c.navy, fontFamily: theme.fonts.bodyBold, fontSize: 12 },
  userTxt: { color: '#fff', fontFamily: theme.fonts.bodySemiBold, fontSize: 13, maxWidth: 90 },
  signInTop: { backgroundColor: c.gold, borderRadius: 999, paddingHorizontal: 18, height: 36, alignItems: 'center', justifyContent: 'center' },
  signInTopTxt: { color: c.navy, fontFamily: theme.fonts.bodyBold, fontSize: 13 },
  sosTop: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.emergencyRed, borderRadius: 999, paddingHorizontal: 14, height: 36 },
  sosTopTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 13 },
  row: { flex: 1, flexDirection: 'row', backgroundColor: c.deepNavy },
  sidebar: { width: 264, backgroundColor: c.navy, paddingHorizontal: 16, paddingTop: 24, paddingBottom: 16 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 22, paddingHorizontal: 6 },
  logo: { width: 42, height: 42, borderRadius: 11, borderWidth: 1.5, borderColor: c.gold, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  logoImg: { width: '100%', height: '100%' },
  brandTxt: { color: '#fff', fontFamily: theme.fonts.displayBold, fontSize: 17, letterSpacing: 1 },
  brandSub: { color: c.onNavyMuted, fontFamily: theme.fonts.body, fontSize: 12 },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12, marginBottom: 2 },
  navItemActive: { backgroundColor: c.gold },
  navTxt: { color: c.onNavyMuted, fontFamily: theme.fonts.bodySemiBold, fontSize: 13 },
  navTxtActive: { color: c.navy, fontFamily: theme.fonts.bodyBold },
  group: { color: 'rgba(255,255,255,0.4)', fontFamily: theme.fonts.bodyBold, fontSize: 12, letterSpacing: 1.2, marginTop: 20, marginBottom: 8, paddingHorizontal: 12 },
  sos: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.emergencyRed, borderRadius: 12, paddingVertical: 13 },
  sosTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 13 },
  centerWrap: { flex: 1, backgroundColor: c.surface, alignItems: 'center' },
  center: { flex: 1, width: '100%', maxWidth: 600, overflow: 'hidden' },
  rail: { width: 340 },
  railCard: { backgroundColor: c.surface, borderRadius: 18, padding: 18, borderWidth: 1, borderColor: c.lines },
  railTag: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  railTagTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 12, color: c.darkGold, letterSpacing: 1 },
  railTitle: { fontFamily: theme.fonts.displayBold, fontSize: 16, color: c.ink },
  railBody: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 6, lineHeight: 17 },
  railBtn: { backgroundColor: c.navy, borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 12 },
  railBtnTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 13 },
  getApp: { fontFamily: theme.fonts.displayBold, fontSize: 16, color: '#fff' },
  getAppSub: { fontFamily: theme.fonts.body, fontSize: 12, color: c.onNavyMuted, marginTop: 6, lineHeight: 17 },
  qr: { backgroundColor: '#fff', borderRadius: 14, padding: 14, alignItems: 'center', marginTop: 14 },
  verified: { flexDirection: 'row', gap: 10, backgroundColor: c.successSoft, borderRadius: 14, padding: 14 },
  verifiedTxt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, lineHeight: 16 },
  signIn: { borderWidth: 1, borderColor: c.lines, borderRadius: 12, paddingVertical: 12, alignItems: 'center', backgroundColor: c.surface },
  signInTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 13, color: c.navy },
});
