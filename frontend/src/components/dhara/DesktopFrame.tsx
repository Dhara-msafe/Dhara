import { ReactNode, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, usePathname } from 'expo-router';
import { theme } from '../../theme';
import { useAuth } from '../../auth';
import { tr } from '../../ui18n';

const c = theme.colors;

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

  const nav: NavItem[] = [
    { label: tr('nav.home', lang), icon: 'home-outline', route: '/(tabs)/home', match: 'home' },
    { label: tr('nav.rights', lang), icon: 'book-outline', route: '/(tabs)/rights', match: 'rights' },
    { label: tr('nav.ask', lang), icon: 'mic-outline', route: '/ask', match: 'ask' },
    { label: tr('nav.myfiles', lang), icon: 'folder-outline', route: '/(tabs)/myfiles', match: 'myfiles' },
    { label: tr('nav.me', lang), icon: 'person-outline', route: '/(tabs)/me', match: 'me' },
  ];
  const journeys: NavItem[] = [
    { label: tr('home.allHelp', lang), icon: 'apps-outline', route: '/all-help', match: 'all-help' },
    { label: tr('j.shield', lang), icon: 'shield-half', route: '/women-shield', match: 'women-shield' },
    { label: tr('j.police', lang), icon: 'ribbon-outline', route: '/fir-draft', match: 'fir-draft' },
    { label: tr('j.cyber', lang), icon: 'desktop-outline', route: '/fraud-checklist', match: 'fraud' },
    { label: tr('all.emergency', lang), icon: 'warning-outline', route: '/emergency', match: 'emergency' },
  ];
  const active = (m: string) => !!pathname && pathname.includes('/' + m);
  const [q, setQ] = useState('');

  const Item = ({ it }: { it: NavItem }) => (
    <Pressable style={[styles.navItem, active(it.match) && styles.navItemActive]} onPress={() => router.push(it.route as any)}>
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
            onSubmitEditing={() => router.push('/all-help')}
            returnKeyType="search"
          />
        </View>
        <View style={styles.topRight}>
          <Pressable style={styles.topLink} onPress={() => router.push('/(tabs)/advocate')}>
            <Text style={styles.topLinkTxt}>For advocates</Text>
          </Pressable>
          <Pressable style={styles.langPill} onPress={() => router.push('/language')}>
            <Ionicons name="globe-outline" size={14} color="#fff" />
            <Text style={styles.langTxt}>{language.native}</Text>
          </Pressable>
          {user ? (
            <Pressable style={styles.userPill} onPress={() => router.push('/(tabs)/me')}>
              <View style={styles.userAvatar}><Text style={styles.userAvatarTxt}>{(user.name || 'U').charAt(0).toUpperCase()}</Text></View>
              <Text style={styles.userTxt} numberOfLines={1}>{(user.name || 'Me').split(' ')[0]}</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.signInTop} onPress={() => router.push('/login')}>
              <Text style={styles.signInTopTxt}>Sign in</Text>
            </Pressable>
          )}
          <Pressable style={styles.sosTop} onPress={() => router.push('/emergency')}>
            <Ionicons name="warning-outline" size={16} color="#fff" />
            <Text style={styles.sosTopTxt}>SOS</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.row}>
      {/* ── Sidebar ── */}
      <View style={styles.sidebar}>
        <Pressable style={styles.brand} onPress={() => router.push('/(tabs)/home')}>
          <View style={styles.logo}><Ionicons name="shield-checkmark" size={22} color={c.gold} /></View>
          <View>
            <Text style={styles.brandTxt}>DHARA</Text>
            <Text style={styles.brandSub}>{tr('shell.tagline', lang)}</Text>
          </View>
        </Pressable>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
          {nav.map(it => <Item key={it.match} it={it} />)}
          <Text style={styles.group}>{tr('home.journeys', lang).toUpperCase()}</Text>
          {journeys.map(it => <Item key={it.match} it={it} />)}
        </ScrollView>
        <Pressable style={styles.sos} onPress={() => router.push('/emergency')}>
          <Ionicons name="warning-outline" size={18} color="#fff" />
          <Text style={styles.sosTxt}>SOS · {tr('all.emergency', lang)}</Text>
        </Pressable>
      </View>

      {/* ── Centre app column ── */}
      <View style={styles.centerWrap}>
        <View style={styles.center}>{children}</View>
      </View>

      {/* ── Right rail ── */}
      <ScrollView style={styles.rail} contentContainerStyle={{ padding: 20, gap: 16 }} showsVerticalScrollIndicator={false}>
        <View style={styles.railCard}>
          <View style={styles.railTag}><Ionicons name="sparkles" size={13} color={c.darkGold} /><Text style={styles.railTagTxt}>{tr('home.forYou', lang).toUpperCase()}</Text></View>
          <Text style={styles.railTitle}>Your next step is due in 3 days</Text>
          <Text style={styles.railBody}>Collect your medical report. DHARA can draft the request for you.</Text>
          <Pressable style={styles.railBtn} onPress={() => router.push('/(tabs)/myfiles')}><Text style={styles.railBtnTxt}>Review</Text></Pressable>
        </View>

        <View style={[styles.railCard, { backgroundColor: c.navy }]}>
          <Text style={styles.getApp}>Get the app</Text>
          <Text style={styles.getAppSub}>Scan to install DHARA on your phone — works offline.</Text>
          <View style={styles.qr}><Ionicons name="qr-code-outline" size={84} color={c.navy} /></View>
        </View>

        <View style={styles.verified}>
          <Ionicons name="checkmark-circle" size={18} color={c.verifiedGreen} />
          <Text style={styles.verifiedTxt}>Every answer is checked against current Indian law before you see it.</Text>
        </View>

        {!user && (
          <Pressable style={styles.signIn} onPress={() => router.push('/login')}><Text style={styles.signInTxt}>Sign in</Text></Pressable>
        )}
      </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: c.deepNavy },
  topbar: { flexDirection: 'row', alignItems: 'center', gap: 16, height: 60, paddingHorizontal: 20, backgroundColor: c.navy, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  search: { flex: 1, maxWidth: 520, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 999, paddingHorizontal: 16, height: 40 },
  searchInput: { flex: 1, color: '#fff', fontFamily: theme.fonts.body, fontSize: 15, ...(({ outlineStyle: 'none' }) as any) },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 12, marginLeft: 'auto' },
  topLink: { paddingHorizontal: 6 },
  topLinkTxt: { color: c.onNavyMuted, fontFamily: theme.fonts.bodySemiBold, fontSize: 14 },
  langPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 12, height: 36, borderRadius: 999 },
  langTxt: { color: '#fff', fontFamily: theme.fonts.bodySemiBold, fontSize: 13 },
  userPill: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.1)', paddingLeft: 4, paddingRight: 14, height: 36, borderRadius: 999 },
  userAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: c.gold, alignItems: 'center', justifyContent: 'center' },
  userAvatarTxt: { color: c.navy, fontFamily: theme.fonts.bodyBold, fontSize: 13 },
  userTxt: { color: '#fff', fontFamily: theme.fonts.bodySemiBold, fontSize: 14, maxWidth: 90 },
  signInTop: { backgroundColor: c.gold, borderRadius: 999, paddingHorizontal: 18, height: 36, alignItems: 'center', justifyContent: 'center' },
  signInTopTxt: { color: c.navy, fontFamily: theme.fonts.bodyBold, fontSize: 14 },
  sosTop: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.emergencyRed, borderRadius: 999, paddingHorizontal: 14, height: 36 },
  sosTopTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 14 },
  row: { flex: 1, flexDirection: 'row', backgroundColor: c.deepNavy, justifyContent: 'center' },
  sidebar: { width: 264, backgroundColor: c.navy, paddingHorizontal: 16, paddingTop: 24, paddingBottom: 16 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 22, paddingHorizontal: 6 },
  logo: { width: 42, height: 42, borderRadius: 11, borderWidth: 1.5, borderColor: c.gold, alignItems: 'center', justifyContent: 'center' },
  brandTxt: { color: '#fff', fontFamily: theme.fonts.displayBold, fontSize: 20, letterSpacing: 1 },
  brandSub: { color: c.onNavyMuted, fontFamily: theme.fonts.body, fontSize: 11 },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12, marginBottom: 2 },
  navItemActive: { backgroundColor: c.gold },
  navTxt: { color: c.onNavyMuted, fontFamily: theme.fonts.bodySemiBold, fontSize: 15 },
  navTxtActive: { color: c.navy, fontFamily: theme.fonts.bodyBold },
  group: { color: 'rgba(255,255,255,0.4)', fontFamily: theme.fonts.bodyBold, fontSize: 11, letterSpacing: 1.2, marginTop: 20, marginBottom: 8, paddingHorizontal: 12 },
  sos: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.emergencyRed, borderRadius: 12, paddingVertical: 13 },
  sosTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 14 },
  centerWrap: { width: 480, maxWidth: '100%', backgroundColor: c.surface },
  center: { flex: 1, overflow: 'hidden' },
  rail: { width: 320 },
  railCard: { backgroundColor: c.surface, borderRadius: 18, padding: 18, borderWidth: 1, borderColor: c.lines },
  railTag: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  railTagTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 11, color: c.darkGold, letterSpacing: 1 },
  railTitle: { fontFamily: theme.fonts.displayBold, fontSize: 18, color: c.ink },
  railBody: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, marginTop: 6, lineHeight: 19 },
  railBtn: { backgroundColor: c.navy, borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 12 },
  railBtnTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 14 },
  getApp: { fontFamily: theme.fonts.displayBold, fontSize: 18, color: '#fff' },
  getAppSub: { fontFamily: theme.fonts.body, fontSize: 13, color: c.onNavyMuted, marginTop: 6, lineHeight: 19 },
  qr: { backgroundColor: '#fff', borderRadius: 14, padding: 14, alignItems: 'center', marginTop: 14 },
  verified: { flexDirection: 'row', gap: 10, backgroundColor: c.successSoft, borderRadius: 14, padding: 14 },
  verifiedTxt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, lineHeight: 18 },
  signIn: { borderWidth: 1, borderColor: c.lines, borderRadius: 12, paddingVertical: 12, alignItems: 'center', backgroundColor: c.surface },
  signInTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.navy },
});
