import { Pressable, Text, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useHeaderSosPresent } from '@/src/ui/headerSos';
import { useRouter } from 'expo-router';
import { theme } from '../../theme';
import { UI_V22_ONE_SOS } from '../../uiV22Flags';
import { noteQuickExit } from '@/src/voice/speechGate';
import { useInDesktopFrame } from './desktopFrameContext';

const c = theme.colors;

/** Red SOS pill used in screen headers — routes to the Emergency screen. */
export function SosPill({ onPress, compact }: { onPress?: () => void; compact?: boolean }) {
  const router = useRouter();
  useHeaderSosPresent();
  // UI_V22_ONE_SOS: inside the desktop frame the sidebar SOS is the one entry.
  const inDesktopFrame = useInDesktopFrame();
  if (UI_V22_ONE_SOS && inDesktopFrame) return null;
  return (
    <Pressable
      testID="sos-pill"
      accessibilityRole="button"
      accessibilityLabel="Emergency SOS"
      onPress={onPress || (() => router.push('/emergency'))}
      style={({ pressed }) => [styles.sos, compact && styles.sosCompact, pressed && { opacity: 0.85 }]}
    >
      <Ionicons name="warning-outline" size={16} color="#fff" />
      <Text style={styles.sosTxt}>SOS 112</Text>
    </Pressable>
  );
}

/** White pill "Quick exit" — leaves a sensitive screen to the neutral Home. */
export function QuickExit({ dark }: { dark?: boolean }) {
  const router = useRouter();
  return (
    <Pressable
      testID="quick-exit"
      accessibilityRole="button"
      accessibilityLabel="Quick exit"
      onPress={() => { noteQuickExit(); router.replace('/(tabs)/home'); }}
      style={({ pressed }) => [styles.qe, dark && styles.qeDark, pressed && { opacity: 0.85 }]}
    >
      <Ionicons name="exit-outline" size={16} color={dark ? '#fff' : c.navy} />
      <Text style={[styles.qeTxt, dark && { color: '#fff' }]}>Quick exit</Text>
    </Pressable>
  );
}

/** Rounded chip with icon + label (globe language pill, etc.). */
export function Chip({ icon, label, onPress, light }: { icon: any; label: string; onPress?: () => void; light?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.chip, light && styles.chipLight, pressed && { opacity: 0.8 }]}>
      <Ionicons name={icon} size={14} color={light ? c.navy : '#fff'} />
      <Text style={[styles.chipTxt, light && { color: c.navy }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  sos: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.sosRed, borderWidth: 1, borderColor: c.sosBorder, paddingHorizontal: 16, height: 48, borderRadius: 999 },
  sosCompact: { paddingHorizontal: 14 },
  sosTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 13, letterSpacing: 0.3 },
  qe: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', paddingHorizontal: 16, height: 48, borderRadius: 999 },
  qeDark: { backgroundColor: 'rgba(255,255,255,0.14)' },
  qeTxt: { color: c.navy, fontFamily: theme.fonts.bodyBold, fontSize: 13 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.14)', paddingHorizontal: 12, height: 34, borderRadius: 999 },
  chipLight: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines },
  chipTxt: { color: '#fff', fontFamily: theme.fonts.bodySemiBold, fontSize: 12 },
  divider: { height: 1, backgroundColor: c.lines },
});
