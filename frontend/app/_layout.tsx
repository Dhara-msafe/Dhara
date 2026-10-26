import { Stack, useRouter, useSegments, usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { Component, ErrorInfo, ReactNode, useCallback, useEffect, useRef } from "react";
import { LogBox, Pressable, Text, View, useWindowDimensions, Platform, Modal, AppState } from "react-native";
import { activateCover, isCoverActive, subscribeCover, syncCoverFromStorage, deactivateCover } from "@/src/women/coverState";
import { PrivacyCover } from "@/src/women/PrivacyCover";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { KeyboardProvider } from "react-native-keyboard-controller";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { PostHogProvider, usePostHog } from "posthog-react-native";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { useAppFonts } from "@/src/hooks/use-app-fonts";
import { DesktopFrame } from "@/src/components/dhara/DesktopFrame";
import { GlobalHelpButton } from "@/src/components/dhara/GlobalHelpButton";
import { LanguageOnboardModal } from "@/src/components/LanguageOnboardModal";
import { AuthProvider, useAuth } from "@/src/auth";
import { consentVersionKey, isCurrentConsent } from "@/src/consentStorage";
import { theme } from "@/src/theme";
import { EvidenceRecorderProvider } from "@/src/women/EvidenceRecorderProvider";
import { initSpeechGate } from "@/src/voice/speechGate";
import { usePreventScreenCapture } from "expo-screen-capture";
import { useShakeDetector } from "@/src/women/shakeActivation";
import {
  POSTHOG_API_KEY,
  POSTHOG_OPTIONS,
  setPostHogInstance,
  identifyUser,
  resetAnalyticsIdentity,
  trackEvent,
  loadAnalyticsConsent,
} from "@/src/analytics";

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync();

type BoundaryProps = { children: ReactNode };
type BoundaryState = { hasError: boolean };

/**
 * Keeps a recoverable JavaScript rendering error from terminating the app.
 * Native build configuration errors still require a rebuilt APK, but ordinary
 * provider or screen failures now present a safe recovery action instead of a
 * blank startup screen.
 */
class RootErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.warn("Root render error", error.name, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View testID="root-error-boundary" style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 28, backgroundColor: theme.colors.surface }}>
          <Text testID="root-error-title" style={{ color: theme.colors.primary, fontSize: 24, fontWeight: "700", textAlign: "center" }}>Dhara needs to restart</Text>
          <Text testID="root-error-message" style={{ color: theme.colors.onSurfaceSecondary, fontSize: 16, lineHeight: 24, marginTop: 12, textAlign: "center" }}>A screen could not load safely. Your saved information is not affected.</Text>
          <Pressable testID="root-error-retry" accessibilityRole="button" onPress={() => this.setState({ hasError: false })} style={{ backgroundColor: theme.colors.primary, borderRadius: 12, marginTop: 24, minHeight: 48, justifyContent: "center", paddingHorizontal: 22 }}>
            <Text style={{ color: theme.colors.onBrandPrimary, fontSize: 16, fontWeight: "700" }}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

/** Redirects to /consent if the user hasn't accepted the current notice version. */
function ConsentGuard() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    // 'guardian' handles its own auth state (shows sign-in prompt if unauthenticated)
    // so it must not be redirected to /consent, especially for deep-linked recipients.
    if (loading || !segments.length || segments[0] === 'language' || segments[0] === 'consent' || segments[0] === 'emergency' || segments[0] === 'guardian') return;
    let active = true;
    void (async () => {
      const stored = await AsyncStorage.getItem(consentVersionKey(user?.id)).catch(() => null);
      if (active && !isCurrentConsent(stored, user?.terms_version)) {
        router.replace(user?.id ? { pathname: '/consent', params: { mode: 'update' } } : '/consent');
      }
    })();
    return () => { active = false; };
  }, [loading, user?.id, user?.terms_version, segments, router]);

  return null;
}

/**
 * Wires the PostHog client instance (created by PostHogProvider) into our
 * central analytics module so every trackEvent() call everywhere in the app
 * reaches the same initialised client.
 */
function PostHogBridge() {
  const posthog = usePostHog();
  const wiredRef = useRef(false);
  useEffect(() => {
    if (posthog && !wiredRef.current) {
      wiredRef.current = true;
      setPostHogInstance(posthog as any);
    }
  }, [posthog]);
  return null;
}

/**
 * Fires screen_view to PostHog + GA4 whenever the active route changes.
 * Language code is attached as a property for regional engagement reporting.
 * DPDP: no path parameters that could contain PII are forwarded — only the
 * static route template (e.g. "/(tabs)/home", "/fir-draft") is sent.
 */
function AnalyticsScreenTracker() {
  const pathname = usePathname();
  const { language } = useAuth();
  const prevRef = useRef<string>('');

  useEffect(() => {
    // Strip dynamic segments that might carry IDs (e.g. /session/abc123 → /session)
    const screen = pathname.replace(/\/[0-9a-f-]{8,}$/i, '').replace(/\/[0-9]+$/i, '') || '/';
    if (screen === prevRef.current) return;
    prevRef.current = screen;
    trackEvent('screen_view', { screen_name: screen, language: language.code });
  }, [pathname, language.code]);

  return null;
}

/**
 * Identifies the signed-in user in PostHog and GA4 using a SHA-256 hashed
 * user ID (DPDP Act 2023 compliance — no raw PII leaves the device).
 * Calls reset() when the user signs out so subsequent events are anonymous.
 */
function AnalyticsIdentitySync() {
  const { user } = useAuth();
  const prevIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (user?.id && user.id !== prevIdRef.current) {
      prevIdRef.current = user.id;
      // Fire-and-forget; hash is async but the user session is already set.
      identifyUser(user.id, { is_pro: user.is_pro ?? false }).catch(() => {});
      // Load analytics consent into the in-memory cache so trackEvent
      // respects the user's DPDP preference from this point forward.
      loadAnalyticsConsent(user.id).catch(() => {});
    } else if (!user && prevIdRef.current) {
      prevIdRef.current = null;
      resetAnalyticsIdentity();
    }
  }, [user?.id, user?.is_pro]);

  return null;
}

const TRUSTED_CIRCLE_RECIPIENT = process.env.EXPO_PUBLIC_TRUSTED_CIRCLE_RECIPIENT === 'true';

/** Prevents the OS from capturing a screenshot or showing DHARA content as a
 *  thumbnail in the app-switcher.  Uses FLAG_SECURE on Android and the iOS
 *  secure-display equivalent.  Has no visible effect in Expo Go — requires a
 *  native build to validate.  Safe to call unconditionally on web (no-op). */
function ScreenCaptureLock() {
  // expo-screen-capture throws UnavailabilityError on web — only render the
  // native lock on a native platform.
  if (Platform.OS === 'web') return null;
  return <NativeCaptureLock />;
}
/** Inner component so the hook runs only when rendered (i.e. on native). */
function NativeCaptureLock() {
  usePreventScreenCapture();
  return null;
}

const PRIVACY_COVER_ENABLED = process.env.EXPO_PUBLIC_PRIVACY_COVER_V1 === 'true';

/** Detects a physical shake gesture and activates the privacy cover.
 *  Shake is opt-in: enabled via Safety phrases screen (ws_shake_opt_in_<uid>).
 *  Only active when EXPO_PUBLIC_PRIVACY_COVER_V1 === 'true'.
 *  NOTE: shake behaviour is UNVERIFIED — not tested on a real Android device. */
function ShakeGuard() {
  const { user } = useAuth();
  const [shakeOptIn, setShakeOptIn] = React.useState(false);

  React.useEffect(() => {
    if (!PRIVACY_COVER_ENABLED) return;
    const key = `ws_shake_opt_in_${user?.id ?? 'device'}`;
    AsyncStorage.getItem(key).then(v => setShakeOptIn(v === 'true')).catch(() => {});
  }, [user?.id]);

  const onShake = useCallback(async () => {
    if (!PRIVACY_COVER_ENABLED) return;
    const scope = user?.id || 'device';
    if (user?.id) {
      try { await AsyncStorage.setItem(`ws_discreet_${user.id}`, '1'); } catch {}
    }
    await activateCover(scope);
    // router.push removed — PrivacyCoverGate handles the visual overlay.
  }, [user?.id]);

  useShakeDetector({
    onShake,
    enabled: PRIVACY_COVER_ENABLED && shakeOptIn && Platform.OS !== 'web',
  });
  return null;
}

/** Part P4 — routes a tapped push notification's `action_url`
 * (e.g. /alerts/{id} or /invite/{id}) into the app. Inert while the
 * Trusted Circle Recipient flag is off — no behavior change otherwise. */
function NotificationTapBridge() {
  const router = useRouter();
  useEffect(() => {
    if (!TRUSTED_CIRCLE_RECIPIENT) return;
    let remove: (() => void) | undefined;
    import("@/src/push").then(({ addNotificationTapListener }) => {
      remove = addNotificationTapListener((actionUrl) => {
        if (actionUrl) router.push(actionUrl as any);
      });
    }).catch(() => {});
    return () => remove?.();
  }, [router]);
  return null;
}

/**
 * PrivacyCoverGate — full-screen opaque Modal overlay managed inside AuthProvider
 * so useAuth() is available for the account-scoped AsyncStorage key.
 * Stacks above all other Modals (last-visible-on-top order in React Native).
 * Amendment 2: Modal starts visible (cold-start-pending) so no app content is
 * briefly exposed during the async AsyncStorage read.
 * NOTE: app-switcher background→foreground behaviour is UNVERIFIED on real device.
 */
function PrivacyCoverGate() {
  if (!PRIVACY_COVER_ENABLED) return null;
  return <PrivacyCoverGateInner />;
}

function PrivacyCoverGateInner() {
  const { user } = useAuth();
  const scope = user?.id || 'device';

  const [coldPending, setColdPending] = React.useState(true);
  const [showCover,   setShowCover]   = React.useState(isCoverActive());

  React.useEffect(() => {
    let alive = true;
    syncCoverFromStorage(scope)
      .then(active => { if (alive) setShowCover(active); })
      .catch(() => { /* keep cover on read failure (privacy-first) */ })
      .finally(() => { if (alive) setColdPending(false); });
    return () => { alive = false; };
  }, [scope]);

  React.useEffect(() => subscribeCover(active => setShowCover(active)), []);

  React.useEffect(() => {
    const sub = AppState.addEventListener('change', async appState => {
      if (appState === 'background' || appState === 'inactive') {
        if (isCoverActive()) setShowCover(true);
      } else if (appState === 'active' && !coldPending) {
        const active = await syncCoverFromStorage(scope);
        setShowCover(active);
      }
    });
    return () => sub.remove();
  }, [scope, coldPending]);

  const handleReveal = useCallback(async () => {
    await deactivateCover(scope);
    setShowCover(false);
  }, [scope]);

  return (
    <Modal
      visible={coldPending || showCover}
      animationType="none"
      statusBarTranslucent
      hardwareAccelerated
      onRequestClose={() => { /* back button must not dismiss */ }}
      transparent={false}
    >
      {coldPending
        ? <View style={{ flex: 1, backgroundColor: '#F8F7F4' }} />
        : <PrivacyCover onReveal={handleReveal} />
      }
    </Modal>
  );
}

export default function RootLayout() {
  const [iconsLoaded, iconError] = useIconFonts();
  const [brandLoaded, brandError] = useAppFonts();
  const loaded = iconsLoaded && brandLoaded;
  const error = iconError || brandError;
  const { width } = useWindowDimensions();
  // C9 adaptive web: on a wide browser, center the app in a phone-width column
  // instead of stretching the mobile layout edge-to-edge (which looked broken).
  const isWideWeb = Platform.OS === 'web' && width >= 768;
  // Safety net: never block app boot forever on a font fetch. If icons
  // haven't resolved within 4s (e.g. a stalled network request), render the
  // app anyway — icons repaint themselves the instant the font does arrive,
  // which is a far better failure mode than an indefinite blank splash.
  const [timedOut, setTimedOut] = React.useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 4000);
    return () => clearTimeout(t);
  }, []);

  // Talk to DHARA — load persisted Quiet + attach lifecycle listeners. Inert
  // (canSpeakNow() returns true) while the voice-companion flag is OFF.
  useEffect(() => { void initSpeechGate(); }, []);

  useEffect(() => {
    if (loaded || error || timedOut) SplashScreen.hideAsync();
  }, [loaded, error, timedOut]);

  if (!loaded && !error && !timedOut) return null;

  return (
    <RootErrorBoundary>
      <SafeAreaProvider>
        <KeyboardProvider preserveEdgeToEdge>
          {/* PostHogProvider must wrap AuthProvider so PostHogBridge can reach
              the client while AuthProvider still owns the user state. */}
          <PostHogProvider
            apiKey={POSTHOG_API_KEY}
            options={POSTHOG_OPTIONS as any}
          >
            <AuthProvider>
              <EvidenceRecorderProvider>
              <PostHogBridge />
              <AnalyticsIdentitySync />
              <AnalyticsScreenTracker />
              <ConsentGuard />
              <ShakeGuard />
              <PrivacyCoverGate />
              <ScreenCaptureLock />
              <NotificationTapBridge />
              <LanguageOnboardModal />
              <StatusBar style="dark" />
              {isWideWeb ? (
                <DesktopFrame>
                  <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.surface } }} />
                </DesktopFrame>
              ) : (
                <View style={{ flex: 1 }}>
                  <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.surface } }} />
                  <GlobalHelpButton />
                </View>
              )}
              {isWideWeb && <GlobalHelpButton />}
              </EvidenceRecorderProvider>
            </AuthProvider>
          </PostHogProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </RootErrorBoundary>
  );
}
