import { Tabs, useRouter, usePathname } from 'expo-router';
import { View, Platform, StyleSheet, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets, SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useEffect } from 'react';
import { theme } from '@/src/theme';
import { AppTabBar } from '@/src/components/AppTabBar';
import { AppHeader } from '@/src/ui/kit';
import { SosPill } from '@/src/components/dhara/SosPill';
import { UI_V22_ONE_SOS } from '@/src/uiV22Flags';
import { WEB_CHAT_MAX_WIDTH } from '@/src/chat/chatStyles';
import { useAuth } from '@/src/auth';
import { addNotificationTapListener } from '@/src/push';

/**
 * Redesigned 5-tab shell: Home · Rights · Ask (raised gold mic) · My files · Me.
 * Every other legacy screen stays reachable (href:null) via navigation / the
 * All help hub / the Me hub, so no functionality is lost.
 */
const HEADER_TAB_PATHS = new Set([
  '/rights', '/myfiles', '/me', '/(tabs)/rights', '/(tabs)/myfiles', '/(tabs)/me',
]);

export default function TabsLayout() {
  const { token, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  // Home has its own calm, uncluttered layout — SOS/Help live in the Me tab
  // instead of floating over Home. Still shown on every other tab.
  //
  // B-99 fix: '/(tabs)' and '/' are NOT Home — they're the (tabs) group's
  // own index route, which is the Ask/chat screen (app/(tabs)/index.tsx,
  // the one AppTabBar's raised gold mic button navigates to — see
  // src/components/AppTabBar.tsx's router.push({ pathname: '/(tabs)', ... })).
  // Home is a separate screen, app/(tabs)/home.tsx, at '/home' /
  // '/(tabs)/home'. Matching '/(tabs)'/'/' here as "home" silently hid the
  // persistent SOS pill on the Ask screen — exactly the reported bug (no
  // header SOS, no sidebar "SOS - Emergency" on "/").
  const onHome = pathname === '/(tabs)/home' || pathname === '/home';
  // Redesign v3, stage 2: Rights, My files and Me get the shared navy header
  // (wordmark + SOS 112). Its colour runs behind the status bar, so those
  // screens are told the top inset is already taken (top: 0 below). Home and
  // Ask keep their own headers until they are rebuilt. On wide web the
  // desktop frame's sidebar is the navigation, so no header there.
  const { width } = useWindowDimensions();
  const showHeader = HEADER_TAB_PATHS.has(pathname ?? '') && !(Platform.OS === 'web' && width >= 768);
  // UI_V22_ONE_SOS: on phones the tab SOS never floats over a screen (the
  // 390px sweep found it covering headings and cards on Ask (B-122), Rights,
  // My files, Me and Settings). Each tab keeps one red emergency entry that
  // covers nothing: Ask — SOS in its header row; Me / Settings — their own
  // SOS in the content; every other tab — the red Help button (opens
  // Emergency), which sits in the bottom dock when UI_V22_DOCK is on.
  // Desktop is unaffected (SosPill steps aside there; sidebar SOS).

  useEffect(() => {
    if (loading) return;
    if (!token) router.replace('/login');
  }, [token, loading, router]);

  useEffect(() => {
    if (Platform.OS === 'web' || !token) return undefined;
    const sub = addNotificationTapListener((actionUrl) => {
      if (actionUrl) router.push(actionUrl as any);
    });
    return () => sub.remove();
  }, [token, router]);

  if (!token) return null;

  const hidden = { href: null as null };

  return (
    <SafeAreaView style={styles.root} edges={['bottom']} testID="tabs-layout">
      {showHeader && <AppHeader showBack={false} testID="tabs-header" />}
      <View style={styles.content}>
        <SafeAreaInsetsContext.Provider value={showHeader ? { ...insets, top: 0 } : insets}>
        <Tabs
          initialRouteName="home"
          tabBar={props => <AppTabBar {...props} />}
          safeAreaInsets={{ bottom: 0 }}
          screenOptions={{ headerShown: false }}
        >
          <Tabs.Screen name="home" options={{ title: 'Home' }} />
          <Tabs.Screen name="rights" options={{ title: 'Rights' }} />
          <Tabs.Screen name="myfiles" options={{ title: 'My files' }} />
          <Tabs.Screen name="me" options={{ title: 'Me' }} />
          {/* Legacy screens — reachable, not shown as tabs */}
          <Tabs.Screen name="index" options={hidden} />
          <Tabs.Screen name="complaints" options={hidden} />
          <Tabs.Screen name="discover" options={hidden} />
          <Tabs.Screen name="lookup" options={hidden} />
          <Tabs.Screen name="voter-roll" options={hidden} />
          <Tabs.Screen name="saved" options={hidden} />
          <Tabs.Screen name="advocate" options={hidden} />
          <Tabs.Screen name="settings" options={hidden} />
          <Tabs.Screen name="history" options={hidden} />
        </Tabs>
        </SafeAreaInsetsContext.Provider>
        {/* Global persistent SOS — visible on every tab screen except Home
            (moved there into the Me tab, see me.tsx), never scrolls away.
            B-122: on web this used to anchor to the raw browser-window edge
            (`right: 16` against the full-width screen), while the chat
            header's New Chat / History buttons anchor to the edge of the
            centered, width-capped chat column (webContentWrap, capped at
            WEB_CHAT_MAX_WIDTH). Those are two different "right edges" on
            web — at window widths where the column's edge happens to land
            near the real window edge (common half-screen-snapped desktop
            widths), the SOS pill sat on top of the header buttons. Fixed by
            giving the overlay the *same* centered, capped frame as the chat
            column, so its own right edge always lines up with the header's,
            at every window width, on every platform. */}
        {!onHome && !UI_V22_ONE_SOS && (
          <View style={[styles.sosOverlayFrame, { top: insets.top + 10 }]} pointerEvents="box-none">
            <View style={styles.sosOverlayInner} pointerEvents="box-none">
              <SosPill />
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Same colour as the tab bar, so the space beside the phone's gesture bar
  // reads as part of the tab bar instead of an empty cream band.
  root: { flex: 1, backgroundColor: theme.colors.surface },
  content: { flex: 1, minHeight: 0 },
  // B-122: an outer full-width frame that centers its child on web (same
  // pattern as chatStyles' `safe`), so the inner, width-capped box below
  // lines up with the chat column rather than the raw viewport.
  sosOverlayFrame: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 50,
    ...(Platform.OS === 'web' ? { alignItems: 'center' } : {}),
  },
  // The inner box mirrors webContentWrap's own cap, then right-aligns the
  // pill within it with the same 16px inset the old flat `right: 16` used —
  // so native (which never hits the web branch, and is narrower than the
  // cap anyway) renders pixel-identical to before.
  sosOverlayInner: {
    width: '100%',
    alignItems: 'flex-end',
    paddingRight: 16,
    ...(Platform.OS === 'web' ? { maxWidth: WEB_CHAT_MAX_WIDTH } : {}),
  },
});
