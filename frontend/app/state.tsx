import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, TextInput, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth, API_BASE } from '@/src/auth';
import { theme } from '@/src/theme';
import { UI_REVISION_V1 } from '@/src/designRevision';
import { focusRingStyle } from '@/src/a11yFocus';
import { PageTitleRow } from '@/src/ui/PageTitleRow';
import { backFromMe, backToMe } from '@/src/meBack';

type StateItem = { code: string; name: string; native: string; type: 'state' | 'ut' };

// Mirrors backend states.py so the screen still works if the network call fails.
const FALLBACK: StateItem[] = [
  { code: 'AP', name: 'Andhra Pradesh', native: 'ఆంధ్రప్రదేశ్', type: 'state' },
  { code: 'AR', name: 'Arunachal Pradesh', native: 'अरुणाचल प्रदेश', type: 'state' },
  { code: 'AS', name: 'Assam', native: 'অসম', type: 'state' },
  { code: 'BR', name: 'Bihar', native: 'बिहार', type: 'state' },
  { code: 'CG', name: 'Chhattisgarh', native: 'छत्तीसगढ़', type: 'state' },
  { code: 'GA', name: 'Goa', native: 'गोवा', type: 'state' },
  { code: 'GJ', name: 'Gujarat', native: 'ગુજરાત', type: 'state' },
  { code: 'HR', name: 'Haryana', native: 'हरियाणा', type: 'state' },
  { code: 'HP', name: 'Himachal Pradesh', native: 'हिमाचल प्रदेश', type: 'state' },
  { code: 'JH', name: 'Jharkhand', native: 'झारखंड', type: 'state' },
  { code: 'KA', name: 'Karnataka', native: 'ಕರ್ನಾಟಕ', type: 'state' },
  { code: 'KL', name: 'Kerala', native: 'കേരളം', type: 'state' },
  { code: 'MP', name: 'Madhya Pradesh', native: 'मध्य प्रदेश', type: 'state' },
  { code: 'MH', name: 'Maharashtra', native: 'महाराष्ट्र', type: 'state' },
  { code: 'MN', name: 'Manipur', native: 'মণিপুর', type: 'state' },
  { code: 'ML', name: 'Meghalaya', native: 'मेघालय', type: 'state' },
  { code: 'MZ', name: 'Mizoram', native: 'मिजोरम', type: 'state' },
  { code: 'NL', name: 'Nagaland', native: 'नागालैंड', type: 'state' },
  { code: 'OD', name: 'Odisha', native: 'ଓଡ଼ିଶା', type: 'state' },
  { code: 'PB', name: 'Punjab', native: 'ਪੰਜਾਬ', type: 'state' },
  { code: 'RJ', name: 'Rajasthan', native: 'राजस्थान', type: 'state' },
  { code: 'SK', name: 'Sikkim', native: 'सिक्किम', type: 'state' },
  { code: 'TN', name: 'Tamil Nadu', native: 'தமிழ்நாடு', type: 'state' },
  { code: 'TG', name: 'Telangana', native: 'తెలంగాణ', type: 'state' },
  { code: 'TR', name: 'Tripura', native: 'ত্রিপুরা', type: 'state' },
  { code: 'UP', name: 'Uttar Pradesh', native: 'उत्तर प्रदेश', type: 'state' },
  { code: 'UK', name: 'Uttarakhand', native: 'उत्तराखंड', type: 'state' },
  { code: 'WB', name: 'West Bengal', native: 'পশ্চিমবঙ্গ', type: 'state' },
  { code: 'AN', name: 'Andaman & Nicobar Islands', native: 'अंडमान और निकोबार', type: 'ut' },
  { code: 'CH', name: 'Chandigarh', native: 'चंडीगढ़', type: 'ut' },
  { code: 'DH', name: 'Dadra & Nagar Haveli and Daman & Diu', native: 'दादरा नगर हवेली और दमन दीव', type: 'ut' },
  { code: 'DL', name: 'Delhi (NCT)', native: 'दिल्ली', type: 'ut' },
  { code: 'JK', name: 'Jammu & Kashmir', native: 'जम्मू और कश्मीर', type: 'ut' },
  { code: 'LA', name: 'Ladakh', native: 'लद्दाख', type: 'ut' },
  { code: 'LD', name: 'Lakshadweep', native: 'लक्षद्वीप', type: 'ut' },
  { code: 'PY', name: 'Puducherry', native: 'புதுச்சேரி', type: 'ut' },
];

export default function StateSelect() {
  const { user, token, setUserState } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ onboarding?: string; from?: string }>();
  const onboarding = params.onboarding === '1';
  const [states, setStates] = useState<StateItem[]>(FALLBACK);
  const [selected, setSelected] = useState<string | null>(user?.state || null);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/reference/states`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d) && d.length) setStates(d); })
      .catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return states;
    return states.filter((s) => s.name.toLowerCase().includes(q) || s.native.includes(query.trim()));
  }, [states, query]);

  // 26 Nov: from Me -> always back to Me; otherwise back to where it came
  // from, and to Me when there is nothing behind it (Back used to do nothing).
  const done = () => {
    if (onboarding) router.replace('/(tabs)/home');
    else backFromMe(router, params.from, () => backToMe(router));
  };

  const onSave = async () => {
    if (!selected || !token) return;
    setSaving(true);
    try {
      await setUserState(selected);
      done();
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView edges={['bottom']} style={[styles.safe, !onboarding && styles.safeLight]} testID="state-screen">
      {onboarding ? (
        <View style={styles.header}>
          <Text style={styles.brand}>Where do you live?</Text>
          <Text style={styles.sub}>
            Rent, liquor, stamp duty and traffic fine amounts are decided by your state. Pick it once
            and Dhara adds the local rule to every answer.
          </Text>
        </View>
      ) : (
        // 26 Nov: opened from Me: the shared title row like the other Me screens.
        <PageTitleRow
          title="Where do you live?"
          subtitle="Rent, liquor, stamp duty and traffic fine amounts are decided by your state. Pick it once and Dhara adds the local rule to every answer."
          onBack={done}
          backTestID="state-back"
          testID="state-title"
        />
      )}

      <View style={[styles.searchWrap, !onboarding && styles.cardLight, !onboarding && { marginTop: theme.spacing.md }]}>
        <Ionicons name="search" size={18} color={theme.colors.onSurfaceTertiary} />
        <TextInput
          testID="state-search"
          value={query}
          onChangeText={setQuery}
          placeholder="Search state or UT"
          placeholderTextColor={theme.colors.onSurfaceSecondary}
          style={styles.search}
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(s) => s.code}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          const active = item.code === selected;
          return (
            <Pressable
              testID={`state-${item.code}`}
              style={(s) => [styles.row, !onboarding && !active && styles.cardLight, active && styles.rowActive, focusRingStyle(s)]}
              onPress={() => setSelected(item.code)}
              accessibilityRole="button"
              accessibilityLabel={`${item.name}${item.type === 'ut' ? ', Union Territory' : ''}`}
              accessibilityState={{ selected: active }}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, active && styles.nameActive]}>{item.name}</Text>
                <Text style={styles.native}>{item.native}{item.type === 'ut' ? ' · Union Territory' : ''}</Text>
              </View>
              {active && <Ionicons name="checkmark-circle" size={24} color={theme.colors.brand} />}
            </Pressable>
          );
        }}
      />

      <View style={[styles.footer, !onboarding && styles.footerLight]}>
        <Pressable
          testID="state-save"
          style={(s) => [styles.btn, (!selected || saving) && styles.btnDisabled, focusRingStyle(s)]}
          onPress={onSave}
          disabled={!selected || saving}
          accessibilityRole="button"
          accessibilityLabel="Save my state"
          accessibilityState={{ disabled: !selected || saving, busy: saving }}
        >
          {saving ? (
            <ActivityIndicator color={theme.colors.onBrandSecondary} />
          ) : (
            <Text style={styles.btnText}>Save my state</Text>
          )}
        </Pressable>
        <Pressable
          testID="state-skip"
          style={(s) => [styles.skip, focusRingStyle(s)]}
          onPress={done}
          accessibilityRole="button"
          accessibilityLabel={onboarding ? 'Skip for now' : 'Cancel'}
        >
          <Text style={[styles.skipText, !onboarding && styles.skipTextLight]}>{onboarding ? 'Skip for now' : 'Cancel'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.brand },
  // 26 Nov: opened from Me the page sits under the light title row, so it
  // uses the same cream page as the other Me screens (first run stays navy).
  safeLight: { backgroundColor: theme.colors.background },
  cardLight: { borderWidth: 1, borderColor: theme.colors.border },
  footerLight: { borderTopColor: theme.colors.border },
  skipTextLight: { color: theme.colors.navy },
  header: { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.lg, paddingBottom: theme.spacing.md },
  brand: { fontFamily: theme.fonts.display, fontSize: 22, color: theme.colors.onBrandPrimary, fontWeight: '700', textAlign: 'center' },
  sub: { color: theme.colors.goldSoft, fontFamily: 'Inter', fontSize: 12, textAlign: 'center', marginTop: theme.spacing.sm, lineHeight: 17 },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: theme.spacing.lg, paddingHorizontal: theme.spacing.md,
    backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, minHeight: 48,
  },
  search: { flex: 1, color: theme.colors.onSurface, fontFamily: 'Inter', fontSize: 13, paddingVertical: theme.spacing.md },
  list: { padding: theme.spacing.lg, gap: theme.spacing.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md, minHeight: 50, borderWidth: 2, borderColor: 'transparent',
  },
  rowActive: { borderColor: theme.colors.gold },
  name: { color: theme.colors.onSurface, fontSize: 14, fontFamily: 'InterBold'},
  nameActive: { color: theme.colors.brand },
  native: { color: theme.colors.onSurfaceSecondary, fontFamily: 'Inter', fontSize: 12, marginTop: 2 },
  footer: { padding: theme.spacing.lg, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.15)' },
  btn: { backgroundColor: theme.colors.brandSecondary, padding: theme.spacing.lg, borderRadius: theme.radius.md, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: theme.colors.onBrandSecondary, fontFamily: 'InterBold', fontSize: 14 },
  // UI-revision pilot (reversible via UI_REVISION_V1): 44px met iOS's own
  // minimum but not the stricter 48px target used across this batch.
  skip: { alignItems: 'center', paddingVertical: theme.spacing.md, minHeight: UI_REVISION_V1 ? 48 : 44, justifyContent: 'center' },
  skipText: { color: theme.colors.goldSoft, fontSize: 13, fontFamily: 'InterSemiBold'},
});
