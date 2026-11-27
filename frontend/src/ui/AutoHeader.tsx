/**
 * Auto header (redesign v3, stage 5).
 *
 * About thirty screens never had the navy header: each drew its own light
 * title row, so the status bar, the brand and SOS looked different from the
 * rest of the app. Rather than rewrite each one, the root layout shows the
 * shared header (wordmark + SOS 112) above them. Each screen keeps its own
 * title row and back button underneath, so nothing about how it works changes.
 *
 * The header colour runs behind the status bar, so the screens below are told
 * the top inset is already used (top: 0). Screens in this list must not pad
 * the top edge with <SafeAreaView> themselves: that component measures the
 * real inset and would leave an empty band under the header.
 */
import React from 'react';
import { View, Platform, useWindowDimensions } from 'react-native';
import { usePathname } from 'expo-router';
import { useSafeAreaInsets, SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { AppHeader } from './kit';
import { useAuth } from '../auth';
import { HEADER_TITLE_IN_BAR, HeaderBarContext, useHeaderTitleEntry } from './headerTitle';

/** A route matches when it equals an entry or sits under it. */
export const AUTO_HEADER_ROUTES: readonly string[] = [
  '/advocate-register', '/complaints', '/fir-draft', '/intakes',
  '/ipc-bns-lookup', '/lawyer-home', '/lookup-results', '/lookup-webview', '/missing',
  '/settings/data-privacy', '/state', '/voter-roll/form', '/women/officer-card',
  '/action-plan', '/all-help', '/drafts', '/fraud-checklist', '/grievance', '/my-data', '/session',
  // 26 Nov (Vivek): screens opened from Me that only had their own navy
  // title bar. Their title bar turns into a light title row under the shared
  // header (useAutoHeaderShown in ScreenHeader / JourneyHeader).
  '/edit-profile', '/women/trusted-circle', '/alerts', '/family-journey',
];

/** Only for a signed-in person: Language is also the first-launch screen,
 *  which keeps its own setup layout (no app header before sign-in). */
export const AUTO_HEADER_SIGNED_IN: readonly string[] = ['/language'];

/** Matched exactly: screens underneath these have the navy header already. */
export const AUTO_HEADER_EXACT: readonly string[] = ['/notetaker'];

export function autoHeaderFor(pathname: string | null | undefined, signedIn = false): boolean {
  if (!pathname) return false;
  if (AUTO_HEADER_EXACT.includes(pathname)) return true;
  if (signedIn && AUTO_HEADER_SIGNED_IN.some((r) => pathname === r || pathname.startsWith(r + '/'))) return true;
  return AUTO_HEADER_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'));
}

/** True when the shared header is drawn above the current screen, so a
 *  screen's own navy title bar should step down to a light title row. */
export function useAutoHeaderShown(): boolean {
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const { token } = useAuth();
  // Wide web has the desktop frame's sidebar instead.
  return autoHeaderFor(pathname, !!token) && !(Platform.OS === 'web' && width >= 768);
}

/** The DHARA bar. On an inner page it shows that page's back arrow and
 *  title (27 Nov, src/ui/headerTitle.ts); otherwise the brand and tagline. */
export function PageAwareHeader({ testID }: { testID: string }) {
  const page = useHeaderTitleEntry();
  if (HEADER_TITLE_IN_BAR && page) {
    return <AppHeader showBack onBack={page.onBack} title={page.title} backTestID={page.backTestID} right={page.right} testID={testID} />;
  }
  return <AppHeader showBack={false} testID={testID} />;
}

export function AutoHeaderFrame({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const show = useAutoHeaderShown();
  return (
    <View style={{ flex: 1 }}>
      {show && <PageAwareHeader testID="auto-header" />}
      <HeaderBarContext.Provider value={show}>
      <SafeAreaInsetsContext.Provider value={show ? { ...insets, top: 0 } : insets}>
        <View style={{ flex: 1 }}>{children}</View>
      </SafeAreaInsetsContext.Provider>
      </HeaderBarContext.Provider>
    </View>
  );
}
