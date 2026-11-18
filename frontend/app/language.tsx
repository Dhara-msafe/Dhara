import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth, Language } from '@/src/auth';
import { theme } from '@/src/theme';
import { trackEvent } from '@/src/analytics';
import { focusRingStyle } from '@/src/a11yFocus';

// Mirrors backend /api/reference/languages — hardcoded so the screen works
// before login and without a network round-trip.
const LANGUAGES: Language[] = [
  { code: 'en', name: 'English', native: 'English', tts: 'en-IN' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', tts: 'hi-IN' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা', tts: 'bn-IN' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்', tts: 'ta-IN' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు', tts: 'te-IN' },
  { code: 'mr', name: 'Marathi', native: 'मराठी', tts: 'mr-IN' },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી', tts: 'gu-IN' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ', tts: 'kn-IN' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം', tts: 'ml-IN' },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ', tts: 'pa-IN' },
  { code: 'or', name: 'Odia', native: 'ଓଡ଼ିଆ', tts: 'or-IN' },
  { code: 'as', name: 'Assamese', native: 'অসমীয়া', tts: 'as-IN' },
  { code: 'ur', name: 'Urdu', native: 'اردو', tts: 'ur-IN' },
  { code: 'sd', name: 'Sindhi', native: 'سنڌي', tts: 'sd-IN' },
  { code: 'ks', name: 'Kashmiri', native: 'कॉशुर', tts: 'ks-IN' },
  { code: 'ne', name: 'Nepali', native: 'नेपाली', tts: 'ne-NP' },
  { code: 'sa', name: 'Sanskrit', native: 'संस्कृतम्', tts: 'sa-IN' },
  { code: 'kok', name: 'Konkani', native: 'कोंकणी', tts: 'kok-IN' },
  { code: 'mai', name: 'Maithili', native: 'मैथिली', tts: 'mai-IN' },
  { code: 'mni', name: 'Manipuri', native: 'মৈতৈলোন্', tts: 'mni-IN' },
  { code: 'sat', name: 'Santali', native: 'ᱥᱟᱱᱛᱟᱲᱤ', tts: 'sat-IN' },
  { code: 'doi', name: 'Dogri', native: 'डोगरी', tts: 'doi-IN' },
  { code: 'brx', name: 'Bodo', native: "बर'", tts: 'brx-IN' },
];

export default function LanguageSelect() {
  const { language, setLanguage } = useAuth();
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const [selected, setSelected] = useState<Language>(language);
  const [query,    setQuery]    = useState('');

  const normalise = (s: string) => s.toLowerCase().normalize('NFC');
  const q = normalise(query.trim());
  const filtered = q.length === 0
    ? LANGUAGES
    : LANGUAGES.filter(
        l =>
          normalise(l.name).includes(q) ||
          normalise(l.native).includes(q) ||
          normalise(l.code).includes(q),
      );

  const onContinue = async () => {
    if (selected.code !== language.code) {
      trackEvent('language_changed', { from_lang: language.code, to_lang: selected.code });
    }
    await setLanguage(selected);
    if (from === 'home') {
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)/home');
    } else router.replace('/how-it-helps');
  };

  return (
    <SafeAreaView style={styles.safe} testID="language-screen">
      {/* ── Top bar: shows back button when reached from home ── */}
      <View style={styles.topbar}>
        {from === 'home' ? (
          <Pressable
            onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/home')}
            style={(s) => [styles.iconBtn, focusRingStyle(s)]}
            accessibilityRole="button"
            accessibilityLabel="Back"
            testID="language-back"
          >
            <Ionicons name="arrow-back" size={20} color={theme.colors.navy} />
          </Pressable>
        ) : <View style={styles.iconBtnPlaceholder} />}
        <Text style={styles.topbarTitle} numberOfLines={1}>Choose language</Text>
        <View style={styles.iconBtnPlaceholder} />
      </View>
      {/* ── Step + heading + subtitle ── */}
      <View style={styles.header}>
        <Text style={styles.eyebrow}>STEP 1 OF 4</Text>
        <Text style={styles.title}>Choose your language</Text>
        <Text style={styles.sub}>
          DHARA speaks in the language you prefer. Which features work in each language is shown after you choose.
        </Text>
      </View>
      {/* ── Search field ── */}
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={18} color={theme.colors.muted} style={styles.searchIcon} />
        <TextInput
          testID="language-search"
          style={styles.searchInput}
          placeholder="Search language…"
          placeholderTextColor={theme.colors.muted}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          accessibilityLabel="Search languages"
        />
        {query.length > 0 && (
          <Pressable
            onPress={() => setQuery('')}
            hitSlop={8}
            accessibilityLabel="Clear search"
          >
            <Ionicons name="close-circle" size={18} color={theme.colors.muted} />
          </Pressable>
        )}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(l) => l.code}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={styles.emptyWrap} testID="language-no-results">
            <Text style={styles.emptyText}>{`No results for "${query}"`}</Text>
          </View>
        }
        renderItem={({ item }) => {
          const active = item.code === selected.code;
          return (
            <Pressable
              testID={`lang-${item.code}`}
              style={(s) => [styles.row, active && styles.rowActive, focusRingStyle(s)]}
              onPress={() => setSelected(item)}
              accessibilityRole="radio"
              accessibilityLabel={`${item.native}, ${item.name}`}
              accessibilityState={{ checked: active }}
              // aria-checked is explicit because React Native Web does not
              // forward accessibilityState.checked to aria-checked on Pressable.
              aria-checked={active}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.native, active && styles.nativeActive]}>{item.native}</Text>
                <Text style={styles.name}>{item.name}</Text>
              </View>
              {active && <Text style={styles.selectedLabel}>Selected</Text>}
            </Pressable>
          );
        }}
      />
      <View style={styles.footer}>
        <Pressable
          testID="language-continue"
          style={(s) => [styles.btn, focusRingStyle(s)]}
          onPress={onContinue}
          accessibilityRole="button"
          accessibilityLabel="Continue"
        >
          <Text style={styles.btnText}>Continue · जारी रखें</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.cream },

  // ── Top bar ──────────────────────────────────────────────────────────────
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1.5,
    borderBottomColor: theme.colors.lines,
  },
  topbarTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: theme.fonts.display,
    fontSize: 18,
    color: theme.colors.navy,
  },
  iconBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.surface,
    borderWidth: 1.5,
    borderColor: theme.colors.lines,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnPlaceholder: { width: 48, height: 48 },

  // ── Header (step + heading + subtitle) ───────────────────────────────────
  header: {
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
    backgroundColor: theme.colors.cream,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: theme.colors.muted,
    marginBottom: 8,
  },
  title: {
    fontFamily: theme.fonts.display,
    fontSize: 28,
    color: theme.colors.navy,
    marginBottom: 10,
  },
  // Descriptive subtitle replacing the multilingual hint
  sub: { color: theme.colors.muted, fontSize: 15, lineHeight: 22 },

  // ── Search field ─────────────────────────────────────────────────────────
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderWidth: 1.5,
    borderColor: theme.colors.lines,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    minHeight: 44,
    gap: 8,
  },
  searchIcon: { opacity: 0.7 },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: theme.colors.navy,
    paddingVertical: theme.spacing.sm,
    // No hardcoded height — flex fills available space naturally
  },

  // ── Empty state ───────────────────────────────────────────────────────────
  emptyWrap: {
    paddingVertical: theme.spacing.xxxl,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
    color: theme.colors.muted,
    textAlign: 'center',
  },

  // ── Language list items ───────────────────────────────────────────────────
  list: { paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.lg, gap: theme.spacing.sm },  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    minHeight: 60,
    borderWidth: 1.5,
    borderColor: theme.colors.lines,
  },
  // Selected: gold border (#8A6A1E) + warm tinted background — matches design token
  rowActive: { borderWidth: 2.5, borderColor: '#8A6A1E', backgroundColor: '#FFF8E7' },
  native: { color: theme.dhara.textPrimary, fontSize: 18, fontWeight: '600' },
  nativeActive: { color: theme.colors.navy },
  // English translation: textSecondary on surface — 6.81:1 ✅; weight 500 for Indic script legibility
  name: { color: theme.dhara.textSecondary, fontSize: 13, marginTop: 2, fontWeight: '500' },
  selectedLabel: {
    fontFamily: theme.fonts.bodyBold,
    fontSize: 13,
    color: '#6B4F10',
  },

  // ── Sticky footer ─────────────────────────────────────────────────────────
  footer: { padding: theme.spacing.lg, borderTopWidth: 1.5, borderTopColor: theme.colors.lines, backgroundColor: theme.colors.cream },
  btn: {
    backgroundColor: theme.colors.navy,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
  btnText: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 16 },
});
