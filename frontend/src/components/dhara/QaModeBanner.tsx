import React from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets, SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { theme } from '@/src/theme';
import { OUTBOUND_PROFILE } from '@/src/outbound';

const c = theme.colors;

/**
 * B-06 — a persistent, always-visible strip across the top of every screen
 * while this build's EXPO_PUBLIC_OUTBOUND_PROFILE is "internal_qa".
 *
 * Before this fix, the ONLY place that said "QA mode" was a one-off Alert
 * shown reactively inside outbound.ts's showSimulated(), fired only at the
 * moment a tester actually triggered a simulated dial/SMS/share. A tester (or
 * anyone screenshotting/recording the app, or anyone handed a QA device who
 * never happens to trigger an outbound action) had no way to tell an
 * internal_qa build apart from a real one just by looking at it — exactly
 * the gap D-01 calls out: "Internal QA builds simulate emergency calls (QA
 * MODE banner, `-qa` version name, build check, release preflight)."
 * Only the banner is added here — the "-qa" version name and build check
 * are B-02's responsibility (see app.config.js); release preflight is
 * tracked separately, not part of either item.
 *
 * Deliberately NOT dismissible and NOT per-screen opt-in: it must be
 * impossible to navigate away from or forget it's there, since its whole
 * purpose is to stop a tester from mistaking simulated-dial behavior for a
 * real failure (or vice versa). Rendered once at the root, like
 * GlobalHelpButton, so no screen can omit it.
 */
// v2.2.1 Stage 1 item 2: a second, distinct banner for OUTBOUND_PROFILE
// "closed_testing" — approved by the owner (2026-11-14) alongside the
// DEPLOYMENT_ENV=production proposal this depends on (see OPEN_ITEMS.md).
// Wording deliberately still says "simulated": OUTBOUND_MODE stays
// "simulate" per standing instruction, so even though closed_testing's
// policy table marks dialler/SMS/share "live", the master-switch gate in
// outbound.ts's shouldDispatch() still blocks every real dispatch — the
// banner must not claim otherwise.
/** Height of the test-build strip (12 text + 4 + 4 padding, rounded up). */
export const QA_BANNER_HEIGHT = 24;

/** True in the two test profiles that show the strip. */
export const QA_BANNER_SHOWN = OUTBOUND_PROFILE === 'internal_qa' || OUTBOUND_PROFILE === 'closed_testing';

/**
 * Redesign v3: the strip floats over the top of every screen and used to
 * cover the first 24 of each header. In test builds this tells the screens
 * below that the top inset is 24 taller, so headers start under the strip.
 * Production builds have no strip and are untouched.
 */
export function QaInsetFrame({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  if (!QA_BANNER_SHOWN) return <>{children}</>;
  return (
    <SafeAreaInsetsContext.Provider value={{ ...insets, top: insets.top + QA_BANNER_HEIGHT }}>
      {children}
    </SafeAreaInsetsContext.Provider>
  );
}

export function QaModeBanner() {
  const insets = useSafeAreaInsets();
  if (OUTBOUND_PROFILE === 'production') return null;
  const isClosedTest = OUTBOUND_PROFILE === 'closed_testing';
  if (!isClosedTest && OUTBOUND_PROFILE !== 'internal_qa') return null;

  return (
    <View
      testID="qa-mode-banner"
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: insets.top,
        left: 0,
        right: 0,
        zIndex: 9999,
        backgroundColor: c.warning,
        paddingVertical: 4,
        alignItems: 'center',
      }}
    >
      <Text style={{ color: '#FFFFFF', fontFamily: 'InterBold', fontSize: 12, letterSpacing: 0.5 }}>
        {isClosedTest
          ? 'CLOSED TEST — calls, SMS and sharing are simulated during this test'
          : 'QA MODE — calls, SMS and sharing are simulated'}
      </Text>
    </View>
  );
}
