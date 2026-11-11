/**
 * Screen 3 — New consultation form: title, date, purpose, input method
 * (manual / transcript import / audio import), and an optional language hint.
 */
import React, { useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { crossAlert } from '@/src/utils/crossAlert';
import { apiPost, newIdempotencyKey } from '@/src/notetaker/api';
import { ScreenHeader } from '@/src/notetaker/ui';
import type { Consultation, InputMethod } from '@/src/notetaker/api';

const c = theme.colors;

function todayStr() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

const INPUT_OPTIONS: { key: InputMethod; icon: string; title: string; desc: string }[] = [
  { key: 'manual', icon: '✍️', title: 'Type notes', desc: 'Write notes directly during or after the consultation.' },
  { key: 'transcript_import', icon: '📄', title: 'Paste a transcript', desc: 'Import text from Zoom, Teams, or another source.' },
  { key: 'audio_import', icon: '🎙️', title: 'Upload audio', desc: 'Upload a recording; DHARA transcribes it for you.' },
];

const LANGUAGES = [
  { code: '', label: 'Not specified' },
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'Hindi' },
  { code: 'mr', label: 'Marathi' },
  { code: 'ta', label: 'Tamil' },
  { code: 'te', label: 'Telugu' },
  { code: 'bn', label: 'Bengali' },
  { code: 'gu', label: 'Gujarati' },
  { code: 'kn', label: 'Kannada' },
];

export default function NewConsultationScreen() {
  const { matterId } = useLocalSearchParams<{ matterId: string }>();
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayStr());
  const [purpose, setPurpose] = useState('');
  const [inputMethod, setInputMethod] = useState<InputMethod>('manual');
  const [language, setLanguage] = useState('');
  const [saving, setSaving] = useState(false);

  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const canSave = title.trim().length > 0 && purpose.trim().length > 0 && dateValid;

  const save = async () => {
    if (!matterId) { crossAlert('Missing matter', 'Open this form from a matter so it knows where to file the consultation.'); return; }
    if (!token) { crossAlert('Session expired', 'Please sign in again.'); return; }
    if (!canSave) {
      crossAlert(
        'A few fields are missing',
        !dateValid
          ? 'Enter the date as YYYY-MM-DD.'
          : 'Add a title and a purpose before creating the consultation.',
      );
      return;
    }
    setSaving(true);
    try {
      const consultation = await apiPost<Consultation>(token, `/matters/${matterId}/consultations`, {
        title: title.trim(),
        date,
        purpose: purpose.trim(),
        input_method: inputMethod,
        language: language || null,
      }, newIdempotencyKey());
      router.replace(`/notetaker/consultation/${consultation.id}`);
    } catch (e: any) {
      crossAlert('Could not create consultation', e?.message || 'Please try again.');
    }
    setSaving(false);
  };

  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader title="New consultation" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Consultation title *</Text>
        <TextInput
          style={styles.input} value={title} onChangeText={setTitle}
          placeholder="e.g. Initial intake meeting" placeholderTextColor={c.muted}
        />

        <Text style={styles.label}>Date *</Text>
        <View style={styles.dateRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]} value={date} onChangeText={setDate}
            placeholder="YYYY-MM-DD" placeholderTextColor={c.muted}
          />
          <Pressable style={styles.todayBtn} onPress={() => setDate(todayStr())}>
            <Text style={styles.todayBtnText}>Today</Text>
          </Pressable>
        </View>
        {!dateValid && date.length > 0 && <Text style={styles.errorText}>Use format YYYY-MM-DD</Text>}

        <Text style={styles.label}>Purpose *</Text>
        <TextInput
          style={[styles.input, styles.textArea]} value={purpose} onChangeText={setPurpose}
          placeholder="e.g. Discuss domestic violence complaint and next steps"
          placeholderTextColor={c.muted} multiline textAlignVertical="top"
        />

        <Text style={styles.label}>How will you capture this consultation? *</Text>
        <View style={{ gap: 10 }}>
          {INPUT_OPTIONS.map(opt => (
            <Pressable
              key={opt.key}
              style={[styles.optionCard, inputMethod === opt.key && styles.optionCardActive]}
              onPress={() => setInputMethod(opt.key)}
              accessibilityLabel={opt.title}
            >
              <Text style={styles.optionIcon}>{opt.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.optionTitle, inputMethod === opt.key && styles.optionTitleActive]}>{opt.title}</Text>
                <Text style={styles.optionDesc}>{opt.desc}</Text>
              </View>
              <View style={[styles.radio, inputMethod === opt.key && styles.radioActive]}>
                {inputMethod === opt.key && <View style={styles.radioDot} />}
              </View>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Language (optional)</Text>
        <View style={styles.chipRow}>
          {LANGUAGES.map(l => (
            <Pressable
              key={l.code || 'none'}
              style={[styles.chip, language === l.code && styles.chipActive]}
              onPress={() => setLanguage(l.code)}
            >
              <Text style={[styles.chipText, language === l.code && styles.chipTextActive]}>{l.label}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
          onPress={save}
          disabled={saving}
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Create consultation</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  scroll: { padding: 20, paddingBottom: 48, gap: 4 },
  label: { fontFamily: theme.fonts.bodyMedium, fontSize: 13, color: c.muted, marginTop: 16, marginBottom: 6 },
  input: {
    borderWidth: 1.5, borderColor: c.border, borderRadius: 10,
    padding: 14, fontFamily: theme.fonts.body, fontSize: 15, color: c.ink, backgroundColor: c.surface,
  },
  textArea: { minHeight: 90 },
  dateRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  todayBtn: { paddingHorizontal: 14, paddingVertical: 14, borderRadius: 10, backgroundColor: c.surfaceSecondary },
  todayBtnText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.navy },
  errorText: { color: c.error, fontSize: 12, fontFamily: theme.fonts.body, marginTop: 4 },
  optionCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14,
    borderRadius: 12, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.surface,
  },
  optionCardActive: { borderColor: c.navy, backgroundColor: c.navySoft },
  optionIcon: { fontSize: 24 },
  optionTitle: { fontFamily: theme.fonts.bodySemiBold, fontSize: 15, color: c.ink },
  optionTitleActive: { color: c.navy },
  optionDesc: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 2 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  radioActive: { borderColor: c.navy },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.navy },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.surface },
  chipActive: { borderColor: c.navy, backgroundColor: c.navy },
  chipText: { fontFamily: theme.fonts.bodyMedium, fontSize: 13, color: c.ink },
  chipTextActive: { color: '#fff' },
  saveBtn: { backgroundColor: c.navy, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 28 },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { fontFamily: theme.fonts.bodySemiBold, fontSize: 16, color: '#fff' },
});
