/**
 * Visitor Mode — V1: Welcome + language + state setup.
 * No authentication required.
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
  FlatList, Modal, TextInput, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import {
  TOURIST_LANGUAGES, INDIAN_STATES,
  saveVisitorSession, VisitorLang, getStateLocalLang,
} from '@/src/visitor/session';

const C = theme.colors;

export default function VisitorSetup() {
  const router = useRouter();
  const [selectedLang, setSelectedLang]   = useState<VisitorLang>(TOURIST_LANGUAGES[0]);
  const [selectedState, setSelectedState] = useState(INDIAN_STATES[0]);
  const [showLangPicker,  setShowLangPicker]  = useState(false);
  const [showStatePicker, setShowStatePicker] = useState(false);
  const [stateSearch, setStateSearch] = useState('');

  const filteredStates = INDIAN_STATES.filter(s =>
    s.name.toLowerCase().includes(stateSearch.toLowerCase())
  );

  const proceed = useCallback(async () => {
    await saveVisitorSession({
      touristLang: selectedLang,
      indianState: selectedState.code,
      indianStateName: selectedState.name,
      createdAt: new Date().toISOString(),
    });
    router.push('/visitor/intent');
  }, [selectedLang, selectedState, router]);

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.content}>
        {/* Hero */}
        <View style={s.hero}>
          <Text style={s.heroEmoji}>🌏</Text>
          <Text style={s.heroTitle}>Welcome to India</Text>
          <Text style={s.heroSub}>
            DHARA helps international visitors navigate legal emergencies—lost passport, police assistance, and more.
          </Text>
        </View>

        {/* Language picker */}
        <Text style={s.label}>YOUR LANGUAGE</Text>
        <Pressable style={s.picker} onPress={() => setShowLangPicker(true)}>
          <Text style={s.pickerText}>{selectedLang.native} ({selectedLang.label})</Text>
          <Ionicons name="chevron-down" size={18} color={C.primary} />
        </Pressable>

        {/* State picker */}
        <Text style={[s.label, { marginTop: 16 }]}>WHICH STATE ARE YOU IN?</Text>
        <Pressable style={s.picker} onPress={() => setShowStatePicker(true)}>
          <Ionicons name="location-outline" size={18} color={C.primary} />
          <Text style={[s.pickerText, { flex: 1 }]}>{selectedState.name}</Text>
          <Ionicons name="chevron-down" size={18} color={C.primary} />
        </Pressable>

        {/* Info cards */}
        <View style={s.cards}>
          {[
            { icon: 'shield-checkmark-outline', text: 'Emergency assistance in seconds' },
            { icon: 'document-text-outline',    text: 'Lost passport step-by-step guide' },
            { icon: 'mic-outline',              text: `Speak For Me — plays ${getStateLocalLang(selectedState.code).label} phrase to officials` },
          ].map(({ icon, text }) => (
            <View key={text} style={s.infoCard}>
              <Ionicons name={icon as any} size={22} color={C.primary} />
              <Text style={s.infoText}>{text}</Text>
            </View>
          ))}
        </View>

        <Pressable style={s.cta} onPress={proceed}>
          <Text style={s.ctaText}>Get Help →</Text>
        </Pressable>

        <Text style={s.disclaimer}>
          This app provides general guidance only. In a medical emergency always call 112 first.
        </Text>
      </ScrollView>

      {/* Language Modal */}
      <Modal visible={showLangPicker} animationType="slide" transparent>
        <View style={s.modalOverlay}>
          <View style={s.modalSheet}>
            <Text style={s.modalTitle}>Select your language</Text>
            <FlatList
              data={TOURIST_LANGUAGES}
              keyExtractor={i => i.code}
              renderItem={({ item }) => (
                <Pressable
                  style={[s.modalItem, item.code === selectedLang.code && s.modalItemSelected]}
                  onPress={() => { setSelectedLang(item); setShowLangPicker(false); }}
                >
                  <Text style={s.modalItemNative}>{item.native}</Text>
                  <Text style={s.modalItemLabel}>{item.label}</Text>
                  {item.code === selectedLang.code && <Ionicons name="checkmark" size={18} color={C.primary} />}
                </Pressable>
              )}
            />
            <Pressable style={s.modalCancel} onPress={() => setShowLangPicker(false)}>
              <Text style={s.modalCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* State Modal */}
      <Modal visible={showStatePicker} animationType="slide" transparent>
        <View style={s.modalOverlay}>
          <View style={s.modalSheet}>
            <Text style={s.modalTitle}>Select state / UT</Text>
            <TextInput
              style={s.modalSearch}
              placeholder="Search state…"
              value={stateSearch}
              onChangeText={setStateSearch}
              autoFocus
            />
            <FlatList
              data={filteredStates}
              keyExtractor={i => i.code}
              renderItem={({ item }) => (
                <Pressable
                  style={[s.modalItem, item.code === selectedState.code && s.modalItemSelected]}
                  onPress={() => { setSelectedState(item); setShowStatePicker(false); setStateSearch(''); }}
                >
                  <Text style={s.modalItemNative}>{item.name}</Text>
                  {item.code === selectedState.code && <Ionicons name="checkmark" size={18} color={C.primary} />}
                </Pressable>
              )}
            />
            <Pressable style={s.modalCancel} onPress={() => { setShowStatePicker(false); setStateSearch(''); }}>
              <Text style={s.modalCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: C.background },
  content: { padding: 20, paddingBottom: 40 },

  hero:      { backgroundColor: C.primary, borderRadius: 20, padding: 24, alignItems: 'center', marginBottom: 24 },
  heroEmoji: { fontSize: 44, marginBottom: 8 },
  heroTitle: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 8 },
  heroSub:   { fontSize: 13, color: '#C5CEEA', textAlign: 'center', lineHeight: 20 },

  label:     { fontSize: 11, fontWeight: '700', letterSpacing: 1, color: C.onSurfaceTertiary, marginBottom: 8 },
  picker:    {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.surface, borderRadius: 12, padding: 14,
    borderWidth: 1.5, borderColor: C.border,
  },
  pickerText: { flex: 1, fontSize: 15, color: C.onSurface, fontWeight: '600' },

  cards:    { gap: 10, marginVertical: 20 },
  infoCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: C.divider,
  },
  infoText: { flex: 1, fontSize: 13, color: C.onSurface, lineHeight: 19 },

  cta:     {
    backgroundColor: C.gold, borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', marginBottom: 16,
  },
  ctaText: { fontSize: 16, fontWeight: '800', color: C.primary },

  disclaimer: { fontSize: 11, color: C.onSurfaceTertiary, textAlign: 'center', lineHeight: 16 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalSheet:   {
    backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '75%', paddingBottom: Platform.OS === 'ios' ? 34 : 16,
  },
  modalTitle:    { fontSize: 17, fontWeight: '700', color: C.primary, padding: 18, paddingBottom: 10 },
  modalSearch:   {
    margin: 12, marginTop: 0, paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: C.background, borderRadius: 10, fontSize: 14, color: C.onSurface,
    borderWidth: 1, borderColor: C.border,
  },
  modalItem:         {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 18, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.divider,
  },
  modalItemSelected: { backgroundColor: C.navySoft },
  modalItemNative:   { flex: 1, fontSize: 15, color: C.onSurface, fontWeight: '600' },
  modalItemLabel:    { fontSize: 12, color: C.onSurfaceTertiary },
  modalCancel:       { padding: 18, alignItems: 'center' },
  modalCancelText:   { fontSize: 15, color: C.error, fontWeight: '600' },
});
