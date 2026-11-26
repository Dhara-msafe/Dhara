import { View, Text, Pressable, StyleSheet, useWindowDimensions, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { EdgeInsets } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { useAuth } from '../auth';
import { tr } from '../ui18n';
import { DisclaimerBanner } from './DisclaimerBanner';
import { FONT_SCALE_CAP } from '../ui/sizeClass';

const c = theme.colors;

// expo-router 58 passes `navigateToTab` instead of `navigation` on its tabBar callback.
// Use a loose structural type so the assignment is compatible with any tabBar prop signature.
type TabBarProps = {
  state: {
    routes: Array<{ key: string; name: string; params?: object }>;
    index: number;
  };
  navigateToTab: (routeKey: string) => void;
  insets: EdgeInsets;
};

type Slot = { name: string; key: string; icon: any; activeIcon: any };
const LEFT: Slot[] = [
  { name: 'home',   key: 'nav.home',   icon: 'home-outline',   activeIcon: 'home' },
  { name: 'rights', key: 'nav.rights', icon: 'book-outline',   activeIcon: 'book' },
];
const RIGHT: Slot[] = [
  { name: 'myfiles', key: 'nav.myfiles', icon: 'folder-outline', activeIcon: 'folder' },
  { name: 'me',      key: 'nav.me',      icon: 'person-outline', activeIcon: 'person' },
];

export function AppTabBar({ state, navigateToTab }: TabBarProps) {
  const router = useRouter();
  const { language } = useAuth();
  const { width } = useWindowDimensions();
  const lang = language.code;
  const activeName = state.routes[state.index].name;
  const askFocused = activeName === 'index';

  // On wide web the DesktopFrame sidebar handles navigation — hide the bar.
  if (Platform.OS === 'web' && width >= 768) return null;

  const renderTab = (slot: Slot) => {
    const route = state.routes.find((r) => r.name === slot.name);
    if (!route) return null;
    const focused = state.routes[state.index].key === route.key;
    return (
      <Pressable
        key={slot.name}
        testID={`tab-${slot.name}`}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={tr(slot.key, lang)}
        style={({ pressed }) => [styles.tab, pressed && { opacity: 0.65 }]}
        onPress={() => { if (!focused) navigateToTab(route.key); }}
      >
        <Ionicons name={focused ? slot.activeIcon : slot.icon} size={23} color={focused ? c.blue : c.tabInactive} />
        <Text style={[styles.label, focused && styles.labelActive]} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE_CAP.chrome}>{tr(slot.key, lang)}</Text>
      </Pressable>
    );
  };

  return (
    <View testID="app-bottom-navigation" style={styles.wrap}>
      {/* Redesign v3: the disclaimer bar shows on Ask only (it used to sit
          above the tab bar on every tab except Home). */}
      {askFocused && <DisclaimerBanner />}
      <View style={styles.tabs}>
        {LEFT.map(renderTab)}
        {/* Redesign v3: Ask is a flat tab like the others (was a raised gold
            circle). Same behaviour: opens Ask and starts the mic. */}
        <Pressable
          testID="tab-ask"
          accessibilityRole="tab"
          accessibilityState={{ selected: askFocused }}
          accessibilityLabel={tr('nav.ask', lang)}
          style={({ pressed }) => [styles.tab, pressed && { opacity: 0.65 }]}
          onPress={() => router.push({ pathname: '/(tabs)', params: { autostartMic: Date.now().toString() } })}
        >
          <Ionicons name={askFocused ? 'mic' : 'mic-outline'} size={23} color={askFocused ? c.blue : c.tabInactive} />
          <Text style={[styles.label, askFocused && styles.labelActive]} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE_CAP.chrome}>{tr('nav.ask', lang)}</Text>
        </Pressable>
        {RIGHT.map(renderTab)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: c.surface, flexShrink: 0 },
  // Redesign v3: five flat tabs, 58 tall (prototype .footer-nav).
  tabs: { flexDirection: 'row', alignItems: 'stretch', minHeight: 50, paddingHorizontal: 6, paddingVertical: 3, borderTopWidth: 1, borderColor: '#E6DFD1' },
  tab: { flex: 1, minHeight: 52, justifyContent: 'center', alignItems: 'center', gap: 2, paddingHorizontal: 2 },
  label: { color: c.tabInactive, fontSize: theme.type.tab, lineHeight: 16, fontFamily: theme.fonts.bodyMedium, textAlign: 'center' },
  labelActive: { color: c.blue, fontFamily: theme.fonts.bodyBold },
});
