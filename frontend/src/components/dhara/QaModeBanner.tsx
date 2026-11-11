import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
export function QaModeBanner() {
  const insets = useSafeAreaInsets();
  if (OUTBOUND_PROFILE !== 'internal_qa') return null;

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
      <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 11, letterSpacing: 0.5 }}>
        QA MODE — calls, SMS and sharing are simulated
      </Text>
    </View>
  );
}
