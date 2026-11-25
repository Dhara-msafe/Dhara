import { useEffect } from 'react';
import { ActivityIndicator, Pressable, Text, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { ComplaintCard } from './ComplaintCard';
import { isDraftReady, useComplaints } from './complaints';
import { theme } from '../theme';

const colors = theme.colors;
export function ComplaintsList({ all = false, onEmptyChange }: { all?: boolean; onEmptyChange?: (empty: boolean) => void }) {
  const { items, loading, error, retry } = useComplaints();
  // UI_V22_SWEEP: lets the Complaints screen hide its header "+" while the
  // list is definitely empty (loaded, no error, no items). Optional; Home
  // does not pass it.
  const definitelyEmpty = !loading && !error && items.length === 0;
  useEffect(() => { onEmptyChange?.(definitelyEmpty); }, [definitelyEmpty, onEmptyChange]);
  const router = useRouter();
  const scope = all ? 'complaints' : 'home';
  const active = items.find(item => !isDraftReady(item));
  const preview = active ? [active] : [];
  return <View testID={`${scope}-complaints-list`} style={styles.list}>
    {loading ? <ActivityIndicator testID={`${scope}-complaints-loading`} color={colors.primary} />
      : error ? <View style={styles.empty}>
        <Text testID={`${scope}-complaints-error`} style={styles.body}>We couldn’t load your complaints. Please check your connection.</Text>
        <Pressable testID={`${scope}-complaints-retry`} accessibilityRole="button" onPress={retry} style={styles.button}><Text style={styles.buttonText}>Try again</Text></Pressable>
      </View> : (all ? items : preview).length ? (all ? items : preview).map(item => <ComplaintCard key={item.session_id} item={item} scope={scope} />)
        : !all ? <Pressable testID="home-first-complaint" accessibilityRole="button" onPress={() => router.push('/fir-draft')} style={styles.compactEmpty}><Text testID="home-complaints-empty" style={styles.body}>No complaint in progress</Text><Text style={styles.compactLink}>Start a complaint →</Text></Pressable>
        : <View style={styles.empty}>
          <Text testID={`${scope}-complaints-empty-title`} style={styles.title}>Your first step towards help</Text>
          <Text testID={`${scope}-complaints-empty`} style={styles.body}>You haven’t started a complaint yet. We’ll guide you, one step at a time.</Text>
          <Pressable testID={`${scope}-first-complaint`} accessibilityRole="button" onPress={() => router.push('/fir-draft')} style={styles.button}><Text style={styles.buttonText}>Start a complaint</Text></Pressable>
        </View>}
  </View>;
}
const styles = StyleSheet.create({
  list: { gap: 12 },
  compactEmpty: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, gap: 6, borderWidth: 1, borderColor: colors.divider, minHeight: 54 },
  compactLink: { color: colors.primary, fontFamily: 'InterBold', fontSize: 12 },
  empty: { backgroundColor: colors.surface, borderRadius: 18, padding: 16, gap: 12, borderWidth: 1, borderColor: colors.divider },
  title: { fontSize: 15, fontFamily: 'InterBold', color: colors.primary },
  body: { fontFamily: 'Inter', fontSize: 13, lineHeight: 19, color: colors.onSurfaceSecondary },
  button: { minHeight: 44, padding: 12, alignItems: 'center', borderRadius: 10, backgroundColor: colors.primary },
  buttonText: { color: colors.onBrandPrimary, fontFamily: 'InterBold'},
});