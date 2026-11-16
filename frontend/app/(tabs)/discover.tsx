import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { theme } from '@/src/theme';
import { ADVOCATE_MODE_ENABLED } from '@/src/advocateMode/flags';

const colors = theme.colors;
const allTools = [
  { id: 'vote', title: 'Vote & voter roll', description: 'Voter registration, roll checks and election forms', icon: 'checkbox-outline', route: '/(tabs)/voter-roll' },
  { id: 'sections', title: 'BNS section search', description: 'Find legal sections and IPC–BNS cross-references', icon: 'library-outline', route: '/ipc-bns-lookup' },
  { id: 'cases', title: 'Case-law lookup', description: 'Search court cases by CNR or party name', icon: 'search-outline', route: '/(tabs)/lookup' },
  { id: 'advocate', title: 'Find an advocate', description: 'Connect with legal help near you', icon: 'briefcase-outline', route: '/(tabs)/advocate' },
] as const;
// B-97: advocate/lawyer features are hidden for Wave 1 per D-14.
const tools = allTools.filter(t => t.id !== 'advocate' || ADVOCATE_MODE_ENABLED);

export default function LookupHub() {
  const router = useRouter();
  return <SafeAreaView testID="lookup-hub" edges={['top']} style={styles.safe}>
    <View style={styles.header}><View style={styles.heading}><Text testID="lookup-hub-title" style={styles.title}>Lookup</Text><Text testID="lookup-hub-subtitle" style={styles.subtitle}>Your legal discovery tools</Text></View>
      <Pressable testID="lookup-profile" accessibilityRole="button" accessibilityLabel="Your profile" style={styles.profile} onPress={() => router.push('/(tabs)/settings')}><Ionicons name="person-outline" size={23} color={colors.primary} /></Pressable>
    </View>
    <ScrollView testID="lookup-tools" contentContainerStyle={styles.content}>
      {tools.map(tool => <Pressable key={tool.id} testID={`lookup-${tool.id}`} accessibilityRole="button" onPress={() => router.push(tool.route)} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
        <View style={styles.icon}><Ionicons name={tool.icon} size={24} color={colors.primary} /></View>
        <View style={styles.heading}><Text testID={`lookup-${tool.id}-title`} style={styles.cardTitle}>{tool.title}</Text><Text testID={`lookup-${tool.id}-description`} style={styles.description}>{tool.description}</Text></View>
        <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
      </Pressable>)}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background }, header: { padding: 20, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 12 },
  heading: { flex: 1, minWidth: 0 }, title: { fontSize: 28, fontWeight: '800', color: colors.primary }, subtitle: { fontSize: 14, color: colors.onSurfaceTertiary, marginTop: 6 },
  profile: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.navySoft, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 18, gap: 16 }, card: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.divider },
  icon: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.goldMuted, alignItems: 'center', justifyContent: 'center' }, cardTitle: { color: colors.primary, fontSize: 16, fontWeight: '700' },
  description: { fontSize: 13, lineHeight: 20, color: colors.onSurfaceTertiary, marginTop: 5 }, pressed: { opacity: 0.7 },
});