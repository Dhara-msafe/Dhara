import { View, Text, ScrollView, Pressable, StyleSheet, Image, useWindowDimensions, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useState, useEffect, useCallback } from 'react';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { tr } from '@/src/ui18n';
import { useComplaints, isDraftReady, complaintTitle, complaintProgress } from '@/src/home/complaints';
import { useUserProfile } from '@/src/userProfile';
import { unreadCount } from '@/src/trustedCircle/api';
import { useFamilyJourneyEnabled } from '@/src/familyJourney/store';

/** Same gate as women-shield.tsx — when Head Out is off, fall back to the shield. */
const HEAD_OUT_ENABLED = process.env.EXPO_PUBLIC_SAFETY_SESSION_V1 === 'true';

const c = theme.colors;
const TRUSTED_CIRCLE_RECIPIENT = process.env.EXPO_PUBLIC_TRUSTED_CIRCLE_RECIPIENT === 'true';

export default function Home() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, language, token } = useAuth();
  const lang = language.code;
  const name = user?.name?.split(' ')[0] || tr('me.guest', lang);
  const place = user?.state_name || 'India';
  const { width } = useWindowDimensions();
  const isWide = Platform.OS === 'web' && width >= 768;
  const [alertCount, setAlertCount] = useState(0);
  const { enabled: familyJourneyEnabled } = useFamilyJourneyEnabled();

  const refreshAlertCount = useCallback(() => {
    if (TRUSTED_CIRCLE_RECIPIENT && token) unreadCount(token).then(setAlertCount);
  }, [token]);
  useEffect(() => { refreshAlertCount(); }, [refreshAlertCount]);

  // Real case data — same source as the old Complaints screen
  // (GET /api/fir/sessions/:user_id) — replaces the hardcoded "File #2" sample.
  const { items: cases, loading: casesLoading } = useComplaints();
  const activeCase = cases.find((i) => !isDraftReady(i));
  const readyCase = !activeCase ? cases.find((i) => isDraftReady(i)) : undefined;
  const primaryCase = activeCase || readyCase || null;
  const primaryProgress = primaryCase ? complaintProgress(primaryCase) : null;
  const openCase = (item: typeof primaryCase) => {
    if (!item) return;
    router.push(
      isDraftReady(item)
        ? ({ pathname: '/fir-draft/result', params: { sessionId: item.session_id } } as any)
        : ({ pathname: '/fir-draft', params: { resumeId: item.session_id } } as any),
    );
  };

  const journeyProfileMap: Record<string, string[]> = {
    women:    ['/women-shield'],
    domestic: ['/women-shield'],
    cyber:    ['/fraud-checklist'],
    police:   ['/fir-draft'],
    motor:    ['/fir-draft'],
    consumer: ['/all-help'],
    rti:      ['/all-help'],
    labor:    ['/all-help'],
  };

  const { interests, primaryInterest, loaded } = useUserProfile();
  const profileRoutes = primaryInterest ? (journeyProfileMap[primaryInterest.key] ?? []) : [];

  const journeys = [
    { key: 'engine.title', sub: 'FIR · नोटिस · मिसिंग', icon: 'construct-outline', route: '/engine', navy: true, isNew: true },
    { key: 'j.shield',   sub: 'महिला सुरक्षा', icon: 'shield-half', route: '/women-shield' },
    { key: 'j.missing',  sub: 'गुमशुदा',      icon: 'people-outline', route: '/missing' },
    { key: 'j.police',   sub: 'पुलिस',        icon: 'ribbon-outline', route: '/fir-draft' },
    { key: 'j.visitor',  sub: 'पर्यटक',       icon: 'globe-outline', route: '/visitor' },
    { key: 'j.cyber',    sub: 'साइबर',        icon: 'desktop-outline', route: '/fraud-checklist' },
    { key: 'j.consumer', sub: 'उपभोक्ता',     icon: 'cart-outline', route: '/all-help' },
    { key: 'j.voter',    sub: 'मतदाता',       icon: 'checkbox-outline', route: '/(tabs)/voter-roll' },
    { key: 'home.allHelp', sub: 'सारी मदद',   icon: 'apps-outline', route: '/all-help', allHelp: true },
  ];

  // Promote profile-matching tiles right after the engine tile (position 1).
  const sortedJourneys = profileRoutes.length > 0
    ? [
        journeys[0], // engine always first
        ...journeys.slice(1).sort((a, b) => {
          const aMatch = profileRoutes.includes(a.route) ? -1 : 0;
          const bMatch = profileRoutes.includes(b.route) ? -1 : 0;
          return aMatch - bMatch;
        }),
      ]
    : journeys;
  // 'engine.title' and 'j.*' are looked up in ui18n.ts; fall back to a plain
  // English label if a language pack hasn't added the key yet.
  const jLabel = (key: string) => (key === 'engine.title' ? 'Dhara Engine' : tr(key, lang));

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
        {/* ── Navy header ─────────────────────────────── */}
        <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
          {!isWide && (
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
              {TRUSTED_CIRCLE_RECIPIENT && (
                <Pressable style={styles.bellBtn} onPress={() => router.push('/alerts' as any)} testID="home-alerts-bell">
                  <Ionicons name="notifications-outline" size={20} color="#fff" />
                  {alertCount > 0 && (
                    <View style={styles.bellBadge}><Text style={styles.bellBadgeTxt}>{alertCount > 9 ? '9+' : alertCount}</Text></View>
                  )}
                </Pressable>
              )}
              <Pressable style={styles.langPill} onPress={() => router.push('/language')}>
                <Ionicons name="globe-outline" size={14} color="#fff" />
                <Text style={styles.langTxt} numberOfLines={1}>{language.native}</Text>
              </Pressable>
            </View>
          </View>
          )}

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
          <Pressable style={styles.micBtn} onPress={() => router.push({ pathname: '/(tabs)', params: { autostartMic: Date.now().toString() } })} testID="home-mic">
            <Ionicons name="mic" size={40} color={c.navy} />
          </Pressable>
          <Text style={styles.holdTxt}>{tr('home.holdToSpeak', lang)}</Text>
          <View style={styles.askActions}>
            <Pressable style={styles.askAction} onPress={() => router.push('/(tabs)')} testID="home-type-button">
              <Ionicons name="create-outline" size={18} color={c.navy} />
              <Text style={styles.askActionTxt}>{tr('home.type', lang)}</Text>
            </Pressable>
            <Pressable style={styles.askAction} onPress={() => router.push('/scan')}>
              <Ionicons name="camera-outline" size={18} color={c.navy} />
              <Text style={styles.askActionTxt}>{tr('home.scan', lang)}</Text>
            </Pressable>
          </View>
          <Text style={styles.tryLabel}>{tr('home.trySaying', lang).toUpperCase()}</Text>
          {(primaryInterest
            ? primaryInterest.homeTryQuestions
            : ['home.try1', 'home.try2', 'home.try3'].map(k => tr(k, lang))
          ).map((q, idx) => (
            <Pressable
              key={idx}
              style={styles.tryChip}
              onPress={() => {
                const clean = q.replace(/^"|"$/g, '');
                router.push({ pathname: '/(tabs)', params: { draft: clean, entry: Date.now().toString() } } as any);
              }}
            >
              <Text style={styles.tryChipTxt}>{q}</Text>
            </Pressable>
          ))}

          {/* ── Onboarding nudge for users who haven't set interests yet ── */}
          {loaded && interests.length === 0 && (
            <Pressable
              style={styles.onboardCard}
              onPress={() => router.push('/(tabs)/me')}
              testID="home-onboarding-card"
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.onboardTitle}>✨ What matters to you?</Text>
                <Text style={styles.onboardBody}>
                  Pick your interests on the Me tab and DHARA will personalize these suggestions for you.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={c.navy} />
            </Pressable>
          )}
        </View>

        {/* ── For you right now ────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.sectionTitleRow}>
            <Ionicons name="sparkles" size={18} color={c.darkGold} />
            <Text style={styles.sectionTitle}>{tr('home.forYou', lang)}</Text>
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
          {primaryCase && primaryProgress ? (
            <View style={[styles.forYouCard, { backgroundColor: c.navy }]}>
              <View style={styles.forYouTag}>
                <Ionicons name="time-outline" size={13} color={c.gold} />
                <Text style={styles.forYouTagTxt}>
                  {isDraftReady(primaryCase) ? 'DRAFT READY' : `STEP ${primaryProgress.step} OF ${primaryProgress.total}`}
                </Text>
              </View>
              <Text style={styles.forYouTitle} numberOfLines={2}>{complaintTitle(primaryCase)}</Text>
              <Text style={styles.forYouBody} numberOfLines={2}>{primaryProgress.label}</Text>
              <Pressable style={styles.goldBtn} onPress={() => openCase(primaryCase)} testID="foryou-case-cta">
                <Text style={styles.goldBtnTxt}>{isDraftReady(primaryCase) ? 'View draft' : 'Continue'}</Text>
              </Pressable>
            </View>
          ) : !casesLoading ? (
            <View style={[styles.forYouCard, { backgroundColor: c.navy }]}>
              <View style={styles.forYouTag}>
                <Ionicons name="add-circle-outline" size={13} color={c.gold} />
                <Text style={styles.forYouTagTxt}>GET STARTED</Text>
              </View>
              <Text style={styles.forYouTitle}>Start your first case</Text>
              <Text style={styles.forYouBody}>Tell DHARA what happened — we’ll help you draft a complaint, step by step.</Text>
              <Pressable style={styles.goldBtn} onPress={() => router.push('/engine')} testID="foryou-start-case">
                <Text style={styles.goldBtnTxt}>Start</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={[styles.forYouCard, styles.forYouCardLight]}>
            <View style={styles.forYouTag}>
              <Ionicons name="navigate-outline" size={13} color={c.darkGold} />
              <Text style={[styles.forYouTagTxt, { color: c.darkGold }]}>TONIGHT</Text>
            </View>
            <Text style={[styles.forYouTitle, { color: c.ink }]}>Heading out?</Text>
            <Text style={[styles.forYouBody, { color: c.muted }]}>Start a safe-journey check-in with your trusted circle.</Text>
            <Pressable
              style={styles.navyBtn}
              onPress={() => router.push(HEAD_OUT_ENABLED ? '/women/head-out' : '/women-shield')}
              testID="home-heading-out-start"
            >
              <Text style={styles.navyBtnTxt}>Start</Text>
            </Pressable>
          </View>

          {/* ── Family Journey (Phase 1 preview) — hidden when switched off ── */}
          {familyJourneyEnabled && (
            <Pressable
              style={[styles.forYouCard, styles.forYouCardLight]}
              onPress={() => router.push('/family-journey')}
              testID="home-family-journey-card"
            >
              <View style={styles.forYouTag}>
                <Ionicons name="people-outline" size={13} color={c.darkGold} />
                <Text style={[styles.forYouTagTxt, { color: c.darkGold }]}>PREVIEW</Text>
              </View>
              <Text style={[styles.forYouTitle, { color: c.ink }]}>Family Journey</Text>
              <Text style={[styles.forYouBody, { color: c.muted }]} numberOfLines={3}>
                Plan a trip and see exactly what a trusted contact would be told. Nothing is sent in this version.
              </Text>
              <View style={styles.navyBtn}>
                <Text style={styles.navyBtnTxt}>Open</Text>
              </View>
            </Pressable>
          )}

          {/* ── Profile-specific card — changes with user interest ─── */}
          {primaryInterest && (
            <Pressable
              style={[styles.forYouCard, { backgroundColor: primaryInterest.bgColor, borderWidth: 1.5, borderColor: primaryInterest.color + '40' }]}
              onPress={() => router.push(primaryInterest.forYouCard.route as any)}
              testID="home-profile-foryou-card"
            >
              <View style={styles.forYouTag}>
                <Text style={[styles.forYouTagTxt, { color: primaryInterest.color }]}>
                  {primaryInterest.forYouCard.tag}
                </Text>
              </View>
              <Text style={[styles.forYouTitle, { color: c.ink }]} numberOfLines={2}>
                {primaryInterest.forYouCard.title}
              </Text>
              <Text style={[styles.forYouBody, { color: c.muted }]} numberOfLines={3}>
                {primaryInterest.forYouCard.body}
              </Text>
              <View style={[styles.navyBtn, { backgroundColor: primaryInterest.color }]}>
                <Text style={styles.navyBtnTxt}>{primaryInterest.forYouCard.cta}</Text>
              </View>
            </Pressable>
          )}
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
            {sortedJourneys.map(j => {
              const isForYou = profileRoutes.includes(j.route);
              return (
                <Pressable
                  key={j.key}
                  style={[styles.tile, j.navy && styles.tileNavy, isForYou && styles.tileForYou]}
                  onPress={() => router.push(j.route as any)}
                  testID={`journey-${j.key}`}
                >
                  {j.isNew && <View style={styles.newBadge}><Text style={styles.newTxt}>{tr('common.new', lang)}</Text></View>}
                  {isForYou && !j.isNew && (
                    <View style={styles.forYouBadge}><Text style={styles.forYouBadgeTxt}>FOR YOU</Text></View>
                  )}
                  <Ionicons name={j.icon as any} size={26} color={j.navy ? c.gold : isForYou ? primaryInterest?.color ?? c.navy : c.navy} />
                  <Text style={[styles.tileTitle, j.navy && { color: '#fff' }, isForYou && { color: primaryInterest?.color ?? c.ink }]} numberOfLines={2}>{jLabel(j.key)}</Text>
                  <Text style={[styles.tileSub, j.navy && { color: c.onNavyMuted }]} numberOfLines={1}>{j.sub}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* ── Rights-reminder banner ───────────────────────────── */}
        {/* DHARA-B024: removed placeholder legal text; replaced with a
            neutral, non-legal message per the acceptance criteria (no
            specific legal claim is asserted here). */}
        <Pressable style={styles.verified} onPress={() => router.push('/(tabs)/rights')} testID="rights-reminder-banner">
          <Ionicons name="shield-checkmark" size={20} color={c.verifiedGreen} />
          <Text style={styles.verifiedTxt}>
            {primaryInterest
              ? `${primaryInterest.chatSubline} — tap to explore your rights.`
              : 'Your rights are protected under Indian law — tap to learn more.'}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={c.muted} />
        </Pressable>

        {/* ── My files preview ─────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.rowBetween}>
            <Text style={styles.h2}>{tr('home.myFiles', lang)}</Text>
            <Pressable onPress={() => router.push('/(tabs)/myfiles')}><Text style={styles.link}>{tr('home.seeAll', lang)}</Text></Pressable>
          </View>
          {primaryCase && primaryProgress ? (
            <Pressable style={styles.fileCard} onPress={() => router.push('/(tabs)/myfiles')} testID="home-myfiles-preview">
              <View style={styles.fileIcon}><Ionicons name="lock-closed-outline" size={20} color={c.darkGold} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fileTitle} numberOfLines={1}>{complaintTitle(primaryCase)}</Text>
                <Text style={styles.fileSub}>
                  {isDraftReady(primaryCase) ? 'Draft ready' : `${primaryProgress.label} · Step ${primaryProgress.step} of ${primaryProgress.total}`}
                </Text>
                {!isDraftReady(primaryCase) && (
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${(primaryProgress.step / primaryProgress.total) * 100}%` }]} />
                  </View>
                )}
              </View>
              <Ionicons name="chevron-forward" size={20} color={c.onSurfaceTertiary} />
            </Pressable>
          ) : (
            <Pressable style={styles.fileCard} onPress={() => router.push('/engine')} testID="home-myfiles-empty">
              <View style={styles.fileIcon}><Ionicons name="add-outline" size={20} color={c.darkGold} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fileTitle}>{casesLoading ? 'Loading your cases…' : 'No cases yet'}</Text>
                <Text style={styles.fileSub}>{casesLoading ? ' ' : 'Tap to start your first complaint'}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={c.onSurfaceTertiary} />
            </Pressable>
          )}
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
  bellBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  bellBadge: { position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: c.error, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  bellBadgeTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 9 },
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
  tileForYou: { borderWidth: 2, borderColor: c.navy + '30' },
  tileTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.ink, marginTop: 4 },
  tileSub: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted },
  newBadge: { position: 'absolute', top: 12, right: 12, backgroundColor: c.goldSoft, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  newTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 9, color: c.darkGold, letterSpacing: 0.5 },
  forYouBadge: { position: 'absolute', top: 12, right: 12, backgroundColor: c.navy, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  forYouBadgeTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 8, color: '#fff', letterSpacing: 0.5 },

  onboardCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#EFF6FF', borderRadius: 14, borderWidth: 1.5, borderColor: c.navy + '30', padding: 16, marginTop: 12, width: '100%' },
  onboardTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.ink, marginBottom: 3 },
  onboardBody: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, lineHeight: 17 },

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
