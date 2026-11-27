import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ComplaintsList } from '@/src/home/ComplaintsList';
import { UI_V22_SWEEP } from '@/src/uiV22Flags';
import { theme } from '@/src/theme';
import { PageTitleRow } from '@/src/ui/PageTitleRow';
import { MissingDraftShortcut } from '@/src/missing/MissingDraftShortcut';

const colors = theme.colors;
export default function Complaints() {
  const router = useRouter();
  // UI_V22_SWEEP (owner, 22 Nov): while there are no complaints the big
  // "Start a complaint" button is the one way in; the header "+" returns
  // as soon as there is one complaint (or while loading / on error).
  const [listEmpty, setListEmpty] = useState(false);
  const hideHeaderAdd = UI_V22_SWEEP && listEmpty;
  return <SafeAreaView style={styles.safe} edges={[]} testID="complaints-screen">
    <PageTitleRow
      title="Your complaints"
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/home'))}
      backTestID="complaints-back"
      testID="complaints-title"
      right={hideHeaderAdd ? undefined : (
        <Pressable testID="complaints-create" accessibilityRole="button" accessibilityLabel="Start a complaint" style={styles.icon} onPress={() => router.push('/fir-draft')}><Ionicons name="add" size={26} color={colors.primary} /></Pressable>
      )}
    />
    <ScrollView testID="complaints-scroll" contentContainerStyle={styles.content}><MissingDraftShortcut /><ComplaintsList all onEmptyChange={setListEmpty} /></ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8, backgroundColor: colors.surface },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 19, fontFamily: 'InterBold', color: colors.primary },
  content: { padding: 18, paddingBottom: 32 },
});