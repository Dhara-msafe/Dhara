import { View, Text, ScrollView, Pressable, StyleSheet, useWindowDimensions, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { AppHeader, Panel, Body, Tile, TileGrid, Button } from '@/src/ui/kit';
import { useSizeClass } from '@/src/ui/useSizeClass';
import { useState, useEffect, useCallback } from 'react';
import { theme } from '@/src/theme';
import { UI_REVISION_V1 } from '@/src/designRevision';
import { focusRingStyle } from '@/src/a11yFocus';
import { useAuth } from '@/src/auth';
import { tr } from '@/src/ui18n';
import { useComplaints, isDraftReady, complaintTitle, complaintProgress } from '@/src/home/complaints';
import { useUserProfile } from '@/src/userProfile';
import { unreadCount } from '@/src/trustedCircle/api';
import { useFamilyJourneyEnabled } from '@/src/familyJourney/store';
import { FJ_SEND_ENABLED } from '@/src/familyJourney/flags';
import { UI_V22_P5_HOME, UI_V22_P8, UI_V22_HOME_SIMPLE } from '@/src/uiV22Flags';

/** Same gate as women-shield.tsx — when Head Out is off, fall back to the shield. */
const HEAD_OUT_ENABLED = process.env.EXPO_PUBLIC_SAFETY_SESSION_V1 === 'true';

const c = theme.colors;
const TRUSTED_CIRCLE_RECIPIENT = process.env.EXPO_PUBLIC_TRUSTED_CIRCLE_RECIPIENT === 'true';

export default function Home() {
  const size = useSizeClass();
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
    // v2.2 phase 5b: with the flag on, this tile is dropped — the "All help"
    // link above the grid is the one way in, not two side by side.
    ...(UI_V22_P5_HOME ? [] : [{ key: 'home.allHelp', sub: 'सारी मदद',   icon: 'apps-outline', route: '/all-help', allHelp: true }]),
    // UI_V22_HOME_SIMPLE: these two lose their cards in "For you right now",
    // so they become tiles here — the grid is where every other destination
    // already lives. Both keep their own gates, so a switched-off feature
    // does not gain an entry point.
    ...(UI_V22_HOME_SIMPLE && HEAD_OUT_ENABLED
      ? [{ key: 'j.headout', sub: 'सुरक्षित यात्रा', icon: 'navigate-outline', route: '/women/head-out' }]
      : []),
    ...(UI_V22_HOME_SIMPLE && familyJourneyEnabled
      ? [{ key: 'j.family', sub: 'परिवार', icon: 'people-circle-outline', route: '/family-journey' }]
      : []),
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


  /**
   * v2.2 Home simplification (UI_V22_HOME_SIMPLE).
   *
   * "For you right now" was a horizontal shelf of fixed 280px cards. On a
   * 390px phone that leaves 76px of the next card showing — too much to read
   * as "swipe for more", too little to read as a card, so it looks broken,
   * and the floating buttons landed on top of exactly that fragment.
   *
   * With the flag on the section shows ONE full-width card: the thing to
   * resume. It does not auto-scroll. A card that says "step 1 of 6" is a task
   * someone came back to finish, and content that slides away while it is
   * being read takes control from the reader — worse in an app used under
   * stress, and it would need a pause control to meet WCAG 2.2.2 anyway.
   *
   * The Head out, Family Journey and interest cards move to the Help
   * journeys grid below, where every other destination already lives.
   */
  const forYouPrimaryCard = primaryCase && primaryProgress ? (
    <View style={[styles.forYouCard, UI_V22_HOME_SIMPLE && styles.forYouCardFull, { backgroundColor: c.navy }]}>
      <View style={styles.forYouTag}>
        <Ionicons name="time-outline" size={13} color={c.gold} />
        <Text style={styles.forYouTagTxt}>
          {isDraftReady(primaryCase) ? 'DRAFT READY' : `STEP ${primaryProgress.step} OF ${primaryProgress.total}`}
        </Text>
      </View>
      <Text style={styles.forYouTitle} numberOfLines={2}>{complaintTitle(primaryCase)}</Text>
      <Text style={styles.forYouBody} numberOfLines={2}>{primaryProgress.label}</Text>
      <Pressable style={styles.goldBtn} onPress={() => openCase(primaryCase)} testID="foryou-case-cta" accessibilityRole="button" accessibilityLabel={isDraftReady(primaryCase) ? 'View your complaint draft' : 'Continue your case'}>
        <Text style={styles.goldBtnTxt}>{isDraftReady(primaryCase) ? 'View draft' : 'Continue'}</Text>
      </Pressable>
    </View>
  ) : !casesLoading ? (
    <View style={[styles.forYouCard, UI_V22_HOME_SIMPLE && styles.forYouCardFull, { backgroundColor: c.navy }]}>
      <View style={styles.forYouTag}>
        <Ionicons name="add-circle-outline" size={13} color={c.gold} />
        <Text style={styles.forYouTagTxt}>GET STARTED</Text>
      </View>
      <Text style={styles.forYouTitle}>Start your first case</Text>
      <Text style={styles.forYouBody}>Tell DHARA what happened — we’ll help you draft a complaint, step by step.</Text>
      <Pressable style={styles.goldBtn} onPress={() => router.push('/engine')} testID="foryou-start-case" accessibilityRole="button" accessibilityLabel="Start your first case">
        <Text style={styles.goldBtnTxt}>Start</Text>
      </Pressable>
    </View>
  ) : null;

  return (
    <View style={styles.root}>
      {/* Redesign v3, stage 3: the shared navy header (wordmark + SOS 112),
          fixed above the scroll. Wide web has the desktop frame instead. */}
      {!isWide && <AppHeader showBack={false} testID="home-header" />}
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
        {/* ── Greeting + voice ─────────────────────────── */}
        <View style={[styles.hero, { paddingHorizontal: size.margin }]}>
          <View style={styles.heroTop}>
            <Text style={styles.eyebrow} numberOfLines={1}>{place}</Text>
            <View style={styles.headerActions}>
              {/* 22 Nov (Vivek): language pill first, then the bell. */}
              <Pressable style={(state) => [styles.langPill, focusRingStyle(state)]} onPress={() => router.push('/language')} accessibilityRole="button" accessibilityLabel={`Change language, currently ${language.native}`} testID="home-language-pill">
                <Ionicons name="globe-outline" size={14} color={c.navy} />
                <Text style={styles.langTxt} numberOfLines={1}>{language.native}</Text>
              </Pressable>
              {TRUSTED_CIRCLE_RECIPIENT && (
                <Pressable style={(state) => [styles.bellBtn, focusRingStyle(state)]} onPress={() => router.push('/alerts' as any)} testID="home-alerts-bell" accessibilityRole="button" accessibilityLabel={alertCount > 0 ? `Alerts, ${alertCount} unread` : 'Alerts'}>
                  <Ionicons name="notifications-outline" size={19} color={c.navy} />
                  {alertCount > 0 && (
                    <View style={styles.bellBadge}><Text style={styles.bellBadgeTxt}>{alertCount > 9 ? '9+' : alertCount}</Text></View>
                  )}
                </Pressable>
              )}
            </View>
          </View>
          <Text style={[styles.greeting, { fontSize: size.title + 1 }]} numberOfLines={2}>{tr('home.greeting', lang)}, {name}</Text>
          <Text style={styles.heroSub}>{tr('home.askSub', lang)}</Text>

          <Pressable style={(state) => [styles.micBtn, size.short && styles.micBtnShort, focusRingStyle(state)]} onPress={() => router.push({ pathname: '/(tabs)', params: { autostartMic: Date.now().toString() } })} testID="home-mic" accessibilityRole="button" accessibilityLabel="Ask DHARA a question by voice">
            <View style={[styles.micCore, size.short && styles.micCoreShort]}>
              <Ionicons name="mic" size={size.short ? 30 : 36} color={c.navy} />
            </View>
          </Pressable>
          <Text style={styles.holdTxt}>{tr('home.holdToSpeak', lang)}</Text>
          <View style={styles.askActions}>
            <Pressable style={(state) => [styles.askAction, focusRingStyle(state)]} onPress={() => router.push('/(tabs)')} testID="home-type-button" accessibilityRole="button" accessibilityLabel="Type your question instead">
              <Ionicons name="create-outline" size={18} color={c.navy} />
              <Text style={styles.askActionTxt}>{tr('home.type', lang)}</Text>
            </Pressable>
            <Pressable style={(state) => [styles.askAction, focusRingStyle(state)]} onPress={() => router.push('/scan')} testID="home-scan-button" accessibilityRole="button" accessibilityLabel="Scan a document">
              <Ionicons name="camera-outline" size={18} color={c.navy} />
              <Text style={styles.askActionTxt}>{tr('home.scan', lang)}</Text>
            </Pressable>
          </View>
        </View>

        {/* ── Women's Shield: the four safety tools, one tap from Home ── */}
        <View style={{ paddingHorizontal: size.margin }}>
          <Panel tone="blue" title="Women’s Shield" testID="home-shield-panel">
            <Body>Safe journeys, trusted people, your records and emergency help.</Body>
            <View style={{ height: 10 }} />
            <TileGrid columns={2} inset={32}>
              <Tile icon="navigate-outline" label="Head Out" hint="Plan a safe check-in" testID="home-tile-headout" onPress={() => router.push(HEAD_OUT_ENABLED ? '/women/head-out' : '/women-shield')} />
              <Tile icon="people-outline" label="Trusted Circle" hint="Choose your people" testID="home-tile-circle" onPress={() => router.push('/women/trusted-circle')} />
              <Tile icon="warning-outline" label="Emergency" hint="112 and other options" alert testID="home-tile-emergency" onPress={() => router.push('/emergency')} />
              <Tile icon="lock-closed-outline" label="Evidence Locker" hint="Keep records private" testID="home-tile-locker" onPress={() => router.push('/women/evidence-locker')} />
            </TileGrid>
            <View style={{ height: 10 }} />
            <Button label="Open Women’s Shield" variant="outline" full testID="home-open-shield" onPress={() => router.push('/women-shield')} />
          </Panel>
        </View>

        {/* ── Try saying ───────────────────────────────── */}
        <View style={[styles.trySection, { paddingHorizontal: size.margin }]}>
          <Text style={styles.tryLabel}>{tr('home.trySaying', lang).toUpperCase()}</Text>
          {(primaryInterest
            ? primaryInterest.homeTryQuestions
            : ['home.try1', 'home.try2', 'home.try3'].map(k => tr(k, lang))
          ).map((q, idx) => (
            <Pressable
              key={idx}
              style={(state) => [styles.tryChip, focusRingStyle(state)]}
              accessibilityRole="button"
              accessibilityLabel={`Ask: ${q.replace(/^"|"$/g, '')}`}
              onPress={() => {
                const clean = q.replace(/^"|"$/g, '');
                router.push({ pathname: '/(tabs)', params: { draft: clean, entry: Date.now().toString() } } as any);
              }}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={15} color={c.blue} />
              <Text style={styles.tryChipTxt}>{q}</Text>
            </Pressable>
          ))}

          {/* ── Onboarding nudge for users who haven't set interests yet ── */}
          {/* UI_V22_HOME_SIMPLE: this belongs on Me, where the interests it
              asks for actually live. */}
          {!UI_V22_HOME_SIMPLE && loaded && interests.length === 0 && (
            <Pressable
              style={styles.onboardCard}
              onPress={() => router.push('/(tabs)/me')}
              testID="home-onboarding-card"
              accessibilityRole="button"
              accessibilityLabel="Set your interests on the Me tab to personalize suggestions"
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.onboardTitle}>What matters to you?</Text>
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
        {UI_V22_HOME_SIMPLE ? (
          <View style={styles.shelfSingle}>{forYouPrimaryCard}</View>
        ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
          {forYouPrimaryCard}
          <View style={[styles.forYouCard, styles.forYouCardLight]}>
            <View style={styles.forYouTag}>
              <Ionicons name="navigate-outline" size={13} color={c.darkGold} />
              <Text style={[styles.forYouTagTxt, { color: c.darkGold }]}>TONIGHT</Text>
            </View>
            {/* v2.2 phase 8: one name for the journey feature. */}
            <Text style={[styles.forYouTitle, { color: c.ink }]}>{UI_V22_P8 ? 'Head out safely' : 'Heading out?'}</Text>
            <Text style={[styles.forYouBody, { color: c.muted }]}>{UI_V22_P8 ? 'Set a check-in timer before you leave.' : 'Start a safe-journey check-in with your trusted circle.'}</Text>
            <Pressable
              style={styles.navyBtn}
              onPress={() => router.push(HEAD_OUT_ENABLED ? '/women/head-out' : '/women-shield')}
              testID="home-heading-out-start"
              accessibilityRole="button"
              accessibilityLabel={UI_V22_P8 ? 'Open Head out safely' : 'Start a safe journey check-in'}
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
              accessibilityRole="button"
              accessibilityLabel="Open Family Journey"
            >
              <View style={styles.forYouTag}>
                <Ionicons name="people-outline" size={13} color={c.darkGold} />
                <Text style={[styles.forYouTagTxt, { color: c.darkGold }]}>{FJ_SEND_ENABLED ? 'YOU PRESS SEND' : 'PREVIEW'}</Text>
              </View>
              <Text style={[styles.forYouTitle, { color: c.ink }]}>Family Journey</Text>
              <Text style={[styles.forYouBody, { color: c.muted }]} numberOfLines={3}>
                {FJ_SEND_ENABLED
                  ? 'Plan a trip and choose who can be told. Your SMS app opens with the text ready — you press Send.'
                  : 'Plan a trip and see exactly what a trusted contact would be told. Nothing is sent in this version.'}
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
              accessibilityRole="button"
              accessibilityLabel={primaryInterest.forYouCard.title}
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
        )}

        {/* ── Help journeys ────────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.rowBetween}>
            <View>
              <Text style={styles.h2}>{tr('home.journeys', lang)}</Text>
              <Text style={styles.h2sub}>{tr('home.journeysSub', lang)}</Text>
            </View>
            <Pressable onPress={() => router.push('/all-help')} accessibilityRole="button" accessibilityLabel="See all help journeys" hitSlop={UI_REVISION_V1 ? { top: 14, bottom: 14, left: 10, right: 10 } : undefined}>
              <Text style={styles.link}>{tr('home.allHelp', lang)}</Text>
            </Pressable>
          </View>
          <View style={styles.grid}>
            {sortedJourneys.map(j => {
              const isForYou = profileRoutes.includes(j.route);
              return (
                <Pressable
                  key={j.key}
                  style={(state) => [styles.tile, j.navy && styles.tileNavy, isForYou && styles.tileForYou, focusRingStyle(state)]}
                  onPress={() => router.push(j.route as any)}
                  testID={`journey-${j.key}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${jLabel(j.key)}`}
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
        {/* UI_V22_HOME_SIMPLE: the Rights tab is one tap away and says this
            better than a banner can. */}
        {!UI_V22_HOME_SIMPLE && (
        <Pressable style={styles.verified} onPress={() => router.push('/(tabs)/rights')} testID="rights-reminder-banner" accessibilityRole="button" accessibilityLabel="Learn about your rights">
          <Ionicons name="shield-checkmark" size={20} color={c.verifiedGreen} />
          <Text style={styles.verifiedTxt}>
            {primaryInterest
              ? `${primaryInterest.chatSubline} — tap to explore your rights.`
              : 'Your rights are protected under Indian law — tap to learn more.'}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={c.muted} />
        </Pressable>
        )}

        {/* ── My files preview ─────────────────────────── */}
        {/* v2.2 phase 5b: with the flag on, the empty card ("No cases yet —
            tap to start your first complaint") is hidden; "Start your first
            case" in "For you right now" is the one start action. The section
            shows as soon as a case exists. */}
        {/* UI_V22_HOME_SIMPLE: dropped. With P5_HOME on it only renders when
            a case exists — and then it repeats the resume card directly
            above it, title and step and all, while the Files tab is one tap
            away. */}
        {!UI_V22_HOME_SIMPLE && (!UI_V22_P5_HOME || (primaryCase && primaryProgress)) && (
        <View style={styles.section}>
          <View style={styles.rowBetween}>
            <Text style={styles.h2}>{tr('home.myFiles', lang)}</Text>
            <Pressable onPress={() => router.push('/(tabs)/myfiles')} accessibilityRole="button" accessibilityLabel="See all your files" hitSlop={UI_REVISION_V1 ? { top: 14, bottom: 14, left: 10, right: 10 } : undefined}><Text style={styles.link}>{tr('home.seeAll', lang)}</Text></Pressable>
          </View>
          {primaryCase && primaryProgress ? (
            <Pressable style={styles.fileCard} onPress={() => router.push('/(tabs)/myfiles')} testID="home-myfiles-preview" accessibilityRole="button" accessibilityLabel={`Open your file, ${complaintTitle(primaryCase)}`}>
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
            <Pressable style={styles.fileCard} onPress={() => router.push('/engine')} testID="home-myfiles-empty" accessibilityRole="button" accessibilityLabel="Start your first complaint">
              <View style={styles.fileIcon}><Ionicons name="add-outline" size={20} color={c.darkGold} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fileTitle}>{casesLoading ? 'Loading your cases…' : 'No cases yet'}</Text>
                <Text style={styles.fileSub}>{casesLoading ? ' ' : 'Tap to start your first complaint'}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={c.onSurfaceTertiary} />
            </Pressable>
          )}
        </View>
        )}

        {/* ── Know your rights ─────────────────────────── */}
        <View style={{ paddingHorizontal: size.margin, marginTop: 8 }}>
          <Panel title="Know your rights" testID="home-rights-panel">
            <Body>Understand your next steps from official sources.</Body>
            <View style={{ height: 10 }} />
            <Button label="Explore rights and next steps" full testID="home-rights-cta" onPress={() => router.push('/(tabs)/rights')} />
          </Panel>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  hero: { paddingTop: 16, paddingBottom: 6 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 },
  eyebrow: { flex: 1, fontFamily: theme.fonts.bodyBold, fontSize: 12, letterSpacing: 1, color: c.goldText, textTransform: 'uppercase' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // Touch targets stay 48 tall (hitSlop makes up the visual 36).
  bellBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.paper, borderWidth: 1, borderColor: c.outlineBorder, alignItems: 'center', justifyContent: 'center' },
  bellBadge: { position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: c.error, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  bellBadgeTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 9 },
  langPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: c.paper, borderWidth: 1, borderColor: c.outlineBorder, paddingHorizontal: 12, height: 40, borderRadius: 999, maxWidth: 120 },
  langTxt: { color: c.navy, fontFamily: theme.fonts.bodySemiBold, fontSize: 12 },
  greeting: { color: c.ink, fontFamily: theme.fonts.displayBold, fontSize: 25 },
  heroSub: { fontFamily: theme.fonts.body, fontSize: 13, lineHeight: 19, color: c.muted, marginTop: 4 },

  // The prototype's gold voice button: pale ring, gold core.
  micBtn: { alignSelf: 'center', width: 128, height: 128, borderRadius: 64, backgroundColor: c.goldLight, alignItems: 'center', justifyContent: 'center', marginTop: 14, marginBottom: 8 },
  micBtnShort: { width: 104, height: 104, borderRadius: 52, marginTop: 10 },
  micCore: { width: 84, height: 84, borderRadius: 42, backgroundColor: c.gold, alignItems: 'center', justifyContent: 'center' },
  micCoreShort: { width: 68, height: 68, borderRadius: 34 },
  holdTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 13, color: c.ink, textAlign: 'center' },
  askActions: { flexDirection: 'row', gap: 9, marginTop: 14 },
  askAction: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.paper, borderWidth: 1, borderColor: c.outlineBorder, borderRadius: 12 },
  askActionTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.navy },
  trySection: { marginTop: 10 },
  tryLabel: { fontFamily: theme.fonts.bodyBold, fontSize: 12, color: c.goldText, letterSpacing: 1, marginBottom: 8 },
  tryChip: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 48, backgroundColor: c.paper, borderWidth: 1, borderColor: c.lines, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8 },
  tryChipTxt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 13, lineHeight: 18, color: c.ink },

  section: { paddingHorizontal: 16, marginTop: 18 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontFamily: theme.fonts.displayBold, fontSize: 19, color: c.ink },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 14 },
  h2: { fontFamily: theme.fonts.displayBold, fontSize: 19, color: c.ink },
  h2sub: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 2 },
  link: { fontFamily: theme.fonts.bodyBold, fontSize: 13, color: c.navy },

  shelf: { paddingHorizontal: 16, paddingTop: 14, gap: 14 },
  // UI_V22_HOME_SIMPLE: one card, full width, no horizontal scroll, so
  // nothing is ever clipped mid-card at 390px.
  shelfSingle: { paddingHorizontal: 16, paddingTop: 14 },
  forYouCard: { width: 280, borderRadius: 17, padding: 16, justifyContent: 'space-between', minHeight: 170 },
  forYouCardFull: { width: '100%' },
  forYouCardLight: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines },
  forYouTag: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  forYouTagTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 12, color: c.gold, letterSpacing: 1 },
  forYouTitle: { fontFamily: theme.fonts.displayBold, fontSize: 16, color: '#fff' },
  forYouBody: { fontFamily: theme.fonts.body, fontSize: 12, color: c.onNavyMuted, marginTop: 6, marginBottom: 12 },
  // UI-revision pilot: paddingVertical 11 (~43px effective height) was below the 48px minimum.
  goldBtn: { backgroundColor: c.gold, borderRadius: 12, paddingVertical: UI_REVISION_V1 ? 14 : 11, alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 18 },
  goldBtnTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 13, color: c.navy },
  navyBtn: { backgroundColor: c.navy, borderRadius: 12, paddingVertical: UI_REVISION_V1 ? 14 : 11, alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 18 },
  navyBtnTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 13, color: '#fff' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 9 },
  tile: { width: '48%', backgroundColor: c.tileBg, borderRadius: 13, borderWidth: 1, borderColor: c.tileBorder, paddingVertical: 14, paddingHorizontal: 12, gap: 4, minHeight: 100 },
  tileNavy: { backgroundColor: c.navy, borderColor: c.navy },
  tileForYou: { borderWidth: 2, borderColor: c.navy + '30' },
  tileTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 13, color: c.ink, marginTop: 4 },
  tileSub: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted },
  newBadge: { position: 'absolute', top: 12, right: 12, backgroundColor: c.goldSoft, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  newTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 11, color: c.darkGold, letterSpacing: 0.5 },
  forYouBadge: { position: 'absolute', top: 12, right: 12, backgroundColor: c.navy, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  forYouBadgeTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 8, color: '#fff', letterSpacing: 0.5 },

  onboardCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.blueBg, borderRadius: 13, borderWidth: 1, borderColor: c.blueBorder, padding: 16, marginTop: 12, width: '100%' },
  onboardTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 13, color: c.ink, marginBottom: 3 },
  onboardBody: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, lineHeight: 17 },

  verified: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.successSoft, marginHorizontal: 20, marginTop: 18, borderRadius: 14, padding: 14 },
  verifiedTxt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, lineHeight: 16 },
  verifiedWhy: { fontFamily: theme.fonts.bodyBold, fontSize: 12, color: c.verifiedGreen, textDecorationLine: 'underline' },

  fileCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.lines, padding: 16 },
  fileIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: c.goldMuted, alignItems: 'center', justifyContent: 'center' },
  fileTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.ink },
  fileSub: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 2 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: c.surfaceTertiary, marginTop: 8, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: c.gold },
});
