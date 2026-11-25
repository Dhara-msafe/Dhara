import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';
import { UI_V22_S2 } from '../../uiV22Flags';

const c = theme.colors;

/** Shared navy screen header with a back button + title. */
export function ScreenHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
      <Pressable onPress={() => router.back()} style={styles.back} testID="screen-back" accessibilityRole="button" accessibilityLabel="Go back">
        <Ionicons name="chevron-back" size={24} color="#fff" />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.sub} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.navy, paddingHorizontal: 12, paddingBottom: 16 },
  // v2.2 (UI_V22_S2): component-specifications.md's "Min 48px target" —
  // the shared back button was 40x40 across every screen that uses it.
  back: { width: UI_V22_S2 ? 48 : 40, height: UI_V22_S2 ? 48 : 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontFamily: theme.fonts.displayBold, fontSize: 19 },
  sub: { color: c.onNavyMuted, fontFamily: theme.fonts.body, fontSize: 12, marginTop: 2 },
});
