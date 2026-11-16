import { Tabs, useRouter, usePathname } from 'expo-router';
import { View, Platform, StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect } from 'react';
import { theme } from '@/src/theme';
import { AppTabBar } from '@/src/components/AppTabBar';
import { SosPill } from '@/src/components/dhara/SosPill';
import { useAuth } from '@/src/auth';
import { addNotificationTapListener } from '@/src/push';

/**
 * Redesigned 5-tab shell: Home · Rights · Ask (raised gold mic) · My files · Me.
 * Every other legacy screen stays reachable (href:null) via navigation / the
 * All help hub / the Me hub, so no functionality is lost.
 */
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
      <View style={styles.content}>
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
        {/* Global persistent SOS — visible on every tab screen except Home
            (moved there into the Me tab, see me.tsx), never scrolls away. */}
        {!onHome && (
          <View style={[styles.sosOverlay, { top: insets.top + 10 }]} pointerEvents="box-none">
            <SosPill />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  content: { flex: 1, minHeight: 0 },
  sosOverlay: { position: 'absolute', right: 16, zIndex: 50 },
});
