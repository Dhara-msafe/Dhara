import { View, Text, Pressable, StyleSheet, useWindowDimensions, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { theme } from '../theme';
import { useAuth } from '../auth';
import { tr } from '../ui18n';
import { DisclaimerBanner } from './DisclaimerBanner';

const c = theme.colors;

type Slot = { name: string; key: string; icon: any; activeIcon: any };
const LEFT: Slot[] = [
  { name: 'home',   key: 'nav.home',   icon: 'home-outline',   activeIcon: 'home' },
  { name: 'rights', key: 'nav.rights', icon: 'book-outline',   activeIcon: 'book' },
];
const RIGHT: Slot[] = [
  { name: 'myfiles', key: 'nav.myfiles', icon: 'folder-outline', activeIcon: 'folder' },
  { name: 'me',      key: 'nav.me',      icon: 'person-outline', activeIcon: 'person' },
];

export function AppTabBar({ state, navigation }: BottomTabBarProps) {
  const router = useRouter();
  const { language } = useAuth();
  const { width } = useWindowDimensions();
  const lang = language.code;
  const activeName = state.routes[state.index].name;

  // On wide web the DesktopFrame sidebar handles navigation — hide the bar.
  if (Platform.OS === 'web' && width >= 768) return null;

  const renderTab = (slot: Slot) => {
    const route = state.routes.find(r => r.name === slot.name);
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
        onPress={() => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params as any);
        }}
      >
        <Ionicons name={focused ? slot.activeIcon : slot.icon} size={24} color={focused ? c.navy : c.onSurfaceTertiary} />
        <Text style={[styles.label, focused && styles.labelActive]} numberOfLines={1}>{tr(slot.key, lang)}</Text>
      </Pressable>
    );
  };

  return (
    <View testID="app-bottom-navigation" style={styles.wrap}>
      {activeName !== 'home' && <DisclaimerBanner />}
      <View style={styles.tabs}>
        {LEFT.map(renderTab)}
        {/* Raised gold Ask mic */}
        <Pressable
          testID="tab-ask"
          accessibilityRole="button"
          accessibilityLabel={tr('nav.ask', lang)}
          style={styles.askSlot}
          onPress={() => router.push('/ask')}
        >
          <View style={styles.askCircle}>
            <Ionicons name="mic" size={26} color={c.navy} />
          </View>
          <Text style={styles.askLabel} numberOfLines={1}>{tr('nav.ask', lang)}</Text>
        </Pressable>
        {RIGHT.map(renderTab)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: c.surface, flexShrink: 0 },
  tabs: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 4, paddingTop: 8, paddingBottom: 8, borderTopWidth: 1, borderColor: c.lines },
  tab: { flex: 1, minHeight: 52, justifyContent: 'flex-end', alignItems: 'center', gap: 4, paddingHorizontal: 2 },
  label: { color: c.onSurfaceTertiary, fontSize: 11, lineHeight: 15, fontFamily: theme.fonts.bodyMedium, textAlign: 'center' },
  labelActive: { color: c.navy, fontFamily: theme.fonts.bodyBold },
  askSlot: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  askCircle: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: c.gold,
    borderWidth: 4, borderColor: c.surface, alignItems: 'center', justifyContent: 'center', marginTop: -26,
    shadowColor: c.shadow, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 8, elevation: 8,
  },
  askLabel: { color: c.navy, fontSize: 11, lineHeight: 15, fontFamily: theme.fonts.bodyBold, textAlign: 'center' },
});
