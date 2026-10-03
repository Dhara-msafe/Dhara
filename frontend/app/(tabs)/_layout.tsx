import { Tabs, useRouter } from 'expo-router';
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
  const insets = useSafeAreaInsets();

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
        {/* Global persistent SOS — always visible on every tab screen, never
            scrolls away (fixes "SOS is hidden"). Emergency help on every screen
            per the brief. */}
        <View style={[styles.sosOverlay, { top: insets.top + 10 }]} pointerEvents="box-none">
          <SosPill />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  content: { flex: 1, minHeight: 0 },
  sosOverlay: { position: 'absolute', right: 16, zIndex: 50 },
});
