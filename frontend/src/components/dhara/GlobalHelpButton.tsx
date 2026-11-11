import { Pressable, Text, StyleSheet } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';

const c = theme.colors;

/**
 * P0-b — a persistent, high-contrast "Help" button reachable from literally
 * every screen in the app, including before login (language picker, login
 * screen, onboarding). It is rendered once at the root, as a floating
 * overlay, so individual screens never need to remember to add it.
 *
 * It only needs useRouter() (not useFocusEffect/useNavigation), which is
 * safe to call from outside a specific Stack.Screen — it does not depend on
 * auth state, so it works with no login.
 */
export function GlobalHelpButton() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  // Don't cover the Emergency screen's own controls with a button that just
  // re-opens the same screen, keep it off the splash/auth-callback route, and
  // keep Home calm/uncluttered — Help lives in the Me tab there instead.
  const isHome = pathname === '/(tabs)/home' || pathname === '/home' || pathname === '/(tabs)' || pathname === '/';
  // Hide on screens where the FAB would overlap primary controls or sensitive content
  const hideScan = pathname === '/scan' || pathname?.startsWith('/scan/');
  // Auth / onboarding screens have NO tab bar, so the bottom-anchored FAB (offset
  // for a tab bar) lands on top of the password eye, consent checkboxes and the
  // language list. Help/emergency is one tap away again the moment the user is in.
  const isAuthOnboarding =
    pathname === '/login' || pathname === '/signup' ||
    pathname === '/consent' || pathname === '/language';
  if (pathname === '/emergency' || pathname?.startsWith('/oauth') || (pathname?.startsWith('/women') && !pathname?.startsWith('/women/head-out')) || pathname?.startsWith('/family-journey') || pathname?.startsWith('/guardian') || pathname?.startsWith('/admin-') || isHome || hideScan || isAuthOnboarding) return null;

  return (
    <Pressable
      testID="global-help-button"
      accessibilityRole="button"
      accessibilityLabel="Help — emergency numbers and what to do next"
      onPress={() => router.push('/emergency')}
      // Tab bar (minHeight 52) + DisclaimerBanner (~64px text + 12px padding = 76px)
      // + safe-area bottom (~34px on iPhone X+) ≈ 162px total from the screen edge.
      // 140 offset gives ~174px on modern iPhones — clears the full disclaimer
      // without rising into the screen content (the previous 180 was 52px too high
      // and overlapped the "Code phrase" ToolRow on the Women's Shield screen).
      style={[styles.btn, { bottom: insets.bottom + 140 }]}
    >
      <Ionicons name="alert-circle" size={18} color="#fff" />
      <Text style={styles.txt}>Help</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    position: 'absolute',
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: c.emergencyRed || '#C62828',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 11,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    zIndex: 999,
  },
  txt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 14 },
});
