import React from 'react';
import { View, StyleSheet } from 'react-native';
import { usePathname } from 'expo-router';
import { useSafeAreaInsets, SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { GlobalHelpButton, isGlobalHelpHidden } from './GlobalHelpButton';
import {
  IssueReporterButton, ISSUE_REPORTER_ENABLED, isIssueReporterRouteHidden,
} from '@/src/components/IssueReporterButton';

const c = theme.colors;

/** Should the bottom dock show on this route? Pure, so the root layout can
 *  decide whether to give the screen the bottom safe-area inset. */
export function dockVisible(pathname: string | null | undefined, signedIn: boolean): boolean {
  const showHelp = !isGlobalHelpHidden(pathname);
  const showBug = ISSUE_REPORTER_ENABLED && signedIn && !isIssueReporterRouteHidden(pathname);
  return showHelp || showBug;
}

/**
 * UI_V22_DOCK — the bottom dock. Holds the bug-report button (left, test
 * builds only) and the Help pill (right) in a real strip below the screen.
 * Because the strip takes layout space, the screen above it ends where the
 * dock begins: no row, value or chip can ever sit underneath a floating
 * button, on any screen. It renders nothing on routes where neither button
 * shows (Home, Emergency, Women's Shield, sign-in, onboarding, …).
 */
export function FloatingDock() {
  const pathname = usePathname();
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  if (!dockVisible(pathname, !!token)) return null;
  return (
    <View testID="floating-dock" style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 6) }]}>
      <IssueReporterButton docked />
      <View style={{ flex: 1 }} />
      <GlobalHelpButton docked />
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 6,
    backgroundColor: c.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
  },
});

/**
 * Wraps the app's screen stack (phones / narrow web, UI_V22_DOCK on): the
 * stack takes the space above the dock. While the dock shows, the dock owns
 * the bottom safe-area inset, so screens (and the tab bar) get bottom: 0 and
 * do not add a second gap.
 */
export function DockedStack({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const visible = dockVisible(pathname, !!token);
  return (
    <View style={{ flex: 1 }}>
      <SafeAreaInsetsContext.Provider value={visible ? { ...insets, bottom: 0 } : insets}>
        <View style={{ flex: 1 }}>{children}</View>
      </SafeAreaInsetsContext.Provider>
      <FloatingDock />
    </View>
  );
}
