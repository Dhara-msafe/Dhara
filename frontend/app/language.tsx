import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList } from 'react-native';
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
      <View style={styles.header}>
        <Text style={styles.brand}>Dhara</Text>
        <Text style={styles.title}>Choose your language</Text>
        <Text style={styles.sub}>अपनी भाषा चुनें · আপনার ভাষা নির্বাচন করুন · உங்கள் மொழியைத் தேர்ந்தெடுக்கவும்</Text>
      </View>
      <FlatList
        data={LANGUAGES}
        keyExtractor={(l) => l.code}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const active = item.code === selected.code;
          return (
            <Pressable
              testID={`lang-${item.code}`}
              style={(s) => [styles.row, active && styles.rowActive, focusRingStyle(s)]}
              onPress={() => setSelected(item)}
              accessibilityRole="radio"
              accessibilityLabel={`${item.native}, ${item.name}`}
              accessibilityState={{ selected: active }}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.native, active && styles.nativeActive]}>{item.native}</Text>
                <Text style={styles.name}>{item.name}</Text>
              </View>
              {active && <Ionicons name="checkmark-circle" size={24} color={theme.colors.brandSecondary} />}
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
  safe: { flex: 1, backgroundColor: theme.dhara.navy },
  header: { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.lg, paddingBottom: theme.spacing.md },
  brand: { fontFamily: theme.fonts.display, fontSize: 34, color: theme.colors.onBrandPrimary, fontWeight: '700', textAlign: 'center' },
  title: { color: theme.colors.onBrandPrimary, fontSize: 18, fontWeight: '700', textAlign: 'center', marginTop: theme.spacing.md },
  // Sub-header: gold-on-navy — 6.29:1 ✅  — brandSecondary (#9A6E00) on navy was 2.50:1 ❌
  sub: { color: theme.dhara.gold, fontSize: 12, textAlign: 'center', marginTop: 6 },
  list: { paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.lg, gap: theme.spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    minHeight: 56,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  rowActive: { borderColor: theme.colors.brandSecondary },
  // Unselected card: native script uses brand navy (textPrimary) for brand alignment
  native: { color: theme.dhara.textPrimary, fontSize: 17, fontWeight: '700' },
  nativeActive: { color: theme.colors.brand },
  // English translation: textSecondary on surface — 6.81:1 ✅; weight 500 for Indic script legibility
  name: { color: theme.dhara.textSecondary, fontSize: 12, marginTop: 2, fontWeight: '500' },
  footer: { padding: theme.spacing.lg, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.15)' },
  btn: { backgroundColor: theme.colors.brandSecondary, padding: theme.spacing.lg, borderRadius: theme.radius.md, alignItems: 'center', minHeight: 52 },
  btnText: { color: theme.colors.onBrandSecondary, fontWeight: '700', fontSize: 16 },
});
