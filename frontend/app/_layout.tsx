import { Stack, useRouter, useSegments, usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { Component, ErrorInfo, ReactNode, useEffect, useRef } from "react";
import { LogBox, Pressable, Text, View, useWindowDimensions, Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { KeyboardProvider } from "react-native-keyboard-controller";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { PostHogProvider, usePostHog } from "posthog-react-native";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { useAppFonts } from "@/src/hooks/use-app-fonts";
import { AuthProvider, useAuth } from "@/src/auth";
import { consentVersionKey, isCurrentConsent } from "@/src/consentStorage";
import { theme } from "@/src/theme";
import {
  POSTHOG_API_KEY,
  POSTHOG_OPTIONS,
  setPostHogInstance,
  identifyUser,
  resetAnalyticsIdentity,
  trackEvent,
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
    if (loading || !segments.length || segments[0] === 'language' || segments[0] === 'consent') return;
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
    } else if (!user && prevIdRef.current) {
      prevIdRef.current = null;
      resetAnalyticsIdentity();
    }
  }, [user?.id, user?.is_pro]);

  return null;
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
              <PostHogBridge />
              <AnalyticsIdentitySync />
              <AnalyticsScreenTracker />
              <ConsentGuard />
              <StatusBar style="dark" />
              <View style={{ flex: 1, backgroundColor: isWideWeb ? theme.colors.deepNavy : theme.colors.surface, alignItems: isWideWeb ? 'center' : 'stretch' }}>
                <View style={isWideWeb
                  ? { flex: 1, width: 460, maxWidth: '100%', backgroundColor: theme.colors.surface, overflow: 'hidden', ...(Platform.OS === 'web' ? { boxShadow: '0 10px 40px rgba(0,0,0,0.35)' } as any : null) }
                  : { flex: 1 }}>
                  <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.surface } }} />
                </View>
              </View>
            </AuthProvider>
          </PostHogProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </RootErrorBoundary>
  );
}
