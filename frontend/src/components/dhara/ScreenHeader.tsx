import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';
import { UI_V22_S2 } from '../../uiV22Flags';
import { SosPill112, useLightStatusBar } from '../../ui/kit';

const c = theme.colors;

/** Shared navy screen header with a back button + title. */
export function ScreenHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  useLightStatusBar();
  return (
    <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
      <Pressable onPress={() => router.back()} style={styles.back} testID="screen-back" accessibilityRole="button" accessibilityLabel="Go back">
        <Ionicons name="chevron-back" size={24} color="#fff" />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        {subtitle ? <Text style={styles.sub} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {/* Redesign v3: SOS lives in the header on every screen (was a strip
          at the bottom of the screen). */}
      <SosPill112 testID="screen-header-sos" />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.navy, paddingLeft: 8, paddingRight: 14, paddingBottom: 12 },
  // v2.2 (UI_V22_S2): component-specifications.md's "Min 48px target" —
  // the shared back button was 40x40 across every screen that uses it.
  back: { width: UI_V22_S2 ? 48 : 40, height: UI_V22_S2 ? 48 : 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontFamily: theme.fonts.displayBold, fontSize: 17, lineHeight: 21 },
  sub: { color: c.onNavyMuted, fontFamily: theme.fonts.body, fontSize: 12, marginTop: 2 },
});
