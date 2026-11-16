import React, { useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet,
  ActivityIndicator, Modal, FlatList, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth, API_BASE } from '@/src/auth';
import { theme } from '@/src/theme';
import { STATE_BAR_COUNCILS } from '@/src/courtData';
import { ADVOCATE_MODE_ENABLED } from '@/src/advocateMode/flags';

const SPECIALIZATIONS = [
  'Criminal', 'Civil', 'Family', 'Property', 'Consumer',
  'Labour', 'Constitutional', 'Corporate', 'RTI', 'Other',
];

const NAVY  = theme.colors.primary;
const GOLD  = theme.colors.gold;

export default function AdvocateRegister() {
  // B-97: advocate/lawyer features are hidden for Wave 1 per D-14 -- this
  // must hold even on a direct URL hit or a refresh, not just when reached
  // via the (now-hidden) in-app links.
  if (!ADVOCATE_MODE_ENABLED) return <Redirect href="/(tabs)/home" />;

  const { token, user } = useAuth();
  const router = useRouter();
  const [stateBar, setStateBar]       = useState('');
  const [barCouncil, setBarCouncil]   = useState('');
  const [specs, setSpecs]             = useState<string[]>([]);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [showBarPicker, setShowBarPicker] = useState(false);

  const toggleSpec = (s: string) =>
    setSpecs(prev => prev.includes(s) ? prev.filter(x => x !== s) : prev.length < 5 ? [...prev, s] : prev);

  const submit = async () => {
    if (!stateBar || !barCouncil.trim() || specs.length === 0) {
      setError('Please fill in all required fields: State Bar Council, Enrolment Number, and at least one specialization.');
      return;
    }
    setLoading(true); setError(null);
    try {
      const r = await fetch(`${API_BASE}/api/advocate/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_id: user?.id, bar_council_number: barCouncil.trim().toUpperCase(), state_bar: stateBar, specializations: specs }),
      });
      if (!r.ok) throw new Error((await r.json()).detail ?? 'Registration failed');
      // Land on the full Lawyer Mode tab (not the legacy /lawyer-home screen)
      // so the advocate immediately sees their submitted enrolment number and
      // the "Verification Pending" banner — confirming what they just submitted.
      router.replace('/(tabs)/advocate' as any);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={{ marginRight: 12 }}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={s.headerTitle}>Register as Advocate</Text>
      </View>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <Text style={[s.label, { marginTop: 4 }]}>State Bar Council <Text style={s.req}>*</Text></Text>
        <Pressable style={s.picker} onPress={() => setShowBarPicker(true)}>
          <Text style={stateBar ? s.pickerText : s.pickerPlaceholder}>
            {stateBar || 'Select your State Bar Council'}
          </Text>
          <Ionicons name="chevron-down" size={16} color={NAVY} />
        </Pressable>

        <Text style={[s.label, { marginTop: 16 }]}>Bar Council Enrolment No. <Text style={s.req}>*</Text></Text>
        <TextInput
          style={s.input}
          placeholder="e.g. MH/1234/2020"
          placeholderTextColor="#9CA3AF"
          value={barCouncil}
          onChangeText={setBarCouncil}
          autoCapitalize="characters"
          returnKeyType="done"
          maxLength={30}
        />
        <Text style={s.helperText}>As appearing on your State Bar Council certificate</Text>

        <Text style={[s.label, { marginTop: 16 }]}>Specializations (up to 5) <Text style={s.req}>*</Text></Text>
        <View style={s.chipsRow}>
          {SPECIALIZATIONS.map(sp => {
            const active = specs.includes(sp);
            return (
              <Pressable key={sp} style={[s.chip, active && s.chipActive]} onPress={() => toggleSpec(sp)}>
                <Text style={[s.chipText, active && s.chipTextActive]}>{sp}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={s.disclaimerCard}>
          <Ionicons name="time-outline" size={16} color="#92400E" />
          <Text style={s.disclaimerText}>
            Your Bar Council enrolment number will be verified within 24–48 hours. You can access Lawyer Mode immediately and receive a &ldquo;Reviewed&rdquo; badge once approved.
          </Text>
        </View>

        {error ? <Text style={s.errorText}>{error}</Text> : null}

        <Pressable style={[s.btn, loading && { opacity: 0.6 }]} onPress={submit} disabled={loading}>
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.btnText}>Enter Lawyer Mode</Text>}
        </Pressable>
      </ScrollView>

      {/* State Bar Picker Modal */}
      <Modal visible={showBarPicker} transparent animationType="slide" onRequestClose={() => setShowBarPicker(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setShowBarPicker(false)}>
          <View style={s.modalSheet}>
            <Text style={s.modalTitle}>Select State Bar Council</Text>
            <FlatList
              data={STATE_BAR_COUNCILS}
              keyExtractor={item => item}
              renderItem={({ item }) => (
                <Pressable style={s.modalItem} onPress={() => { setStateBar(item); setShowBarPicker(false); }}>
                  <Text style={[s.modalItemText, item === stateBar && { color: NAVY, fontWeight: '700' }]}>{item}</Text>
                  {item === stateBar && <Ionicons name="checkmark" size={18} color={NAVY} />}
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#FDFBF7' },
  header: { backgroundColor: NAVY, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#fff', flex: 1 },
  scroll: { padding: 20, paddingBottom: 40 },
  label: { fontSize: 13, fontWeight: '700', color: NAVY, marginBottom: 6 },
  req:   { color: '#EF4444' },
  input: { borderWidth: 1.5, borderColor: '#D1D5DB', borderRadius: 10, padding: 12, fontSize: 15, color: '#1F2937', backgroundColor: '#fff' },
  picker: { borderWidth: 1.5, borderColor: '#D1D5DB', borderRadius: 10, padding: 12, backgroundColor: '#fff', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pickerText: { fontSize: 15, color: '#1F2937', flex: 1 },
  pickerPlaceholder: { fontSize: 15, color: '#9CA3AF', flex: 1 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: NAVY, backgroundColor: '#fff' },
  chipActive: { backgroundColor: NAVY },
  chipText: { fontSize: 13, fontWeight: '600', color: NAVY },
  chipTextActive: { color: '#fff' },
  disclaimerCard: { flexDirection: 'row', gap: 8, backgroundColor: '#FEF3C7', borderRadius: 10, padding: 12, marginTop: 20, alignItems: 'flex-start' },
  disclaimerText: { flex: 1, fontSize: 12, color: '#92400E', lineHeight: 18 },
  helperText: { fontSize: 11, color: '#6B7280', marginTop: 4, marginLeft: 2 },
  errorText: { color: '#EF4444', fontSize: 13, marginTop: 12, textAlign: 'center' },
  btn: { backgroundColor: GOLD, paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 24 },
  btnText: { fontSize: 16, fontWeight: '700', color: NAVY },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '70%', padding: 20 },
  modalTitle: { fontSize: 17, fontWeight: '700', color: NAVY, marginBottom: 12 },
  modalItem: { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#F3F4F6', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalItemText: { fontSize: 14, color: '#374151', flex: 1 },
});
