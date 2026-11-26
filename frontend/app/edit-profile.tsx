import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, Pressable, Image, StyleSheet,
  ScrollView, ActivityIndicator, Platform, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { PhotoPicker } from '@/src/components/PhotoPicker';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { editProfileName, getPhotoViewToken } from '@/src/trustedCircle/api';
import { API_BASE } from '@/src/apiBase';
import { focusRingStyle } from '@/src/a11yFocus';

const c = theme.colors;

const GENDER_OPTIONS = [
  { value: 'female',           label: 'Female' },
  { value: 'male',             label: 'Male' },
  { value: 'other',            label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
] as const;

type Gender = typeof GENDER_OPTIONS[number]['value'];

/** Returns true when dob (YYYY-MM-DD) makes the user at least 18 today. */
function isAtLeast18(dob: string): boolean {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return false;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return false;
  const today = new Date();
  const age =
    today.getFullYear() - d.getFullYear() -
    ((today.getMonth() * 100 + today.getDate()) <
     (d.getMonth()   * 100 + d.getDate()) ? 1 : 0);
  return age >= 18;
}

/** PATCH /api/profile/me with the extended body. */
async function editProfile(
  token: string,
  patch: { name?: string; phone?: string; gender?: Gender | null; dob?: string | null },
) {
  const body: Record<string, string> = {};
  if (patch.name   != null) body.name   = patch.name;
  if (patch.phone  != null) body.phone  = patch.phone;
  if (patch.gender != null) body.gender = patch.gender;
  if (patch.dob    != null) body.dob    = patch.dob;

  const r = await fetch(`${API_BASE}/api/profile/me`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err?.detail || 'Could not save profile');
  }
  return r.json();
}

export default function EditProfileScreen() {
  const { user, token, refreshUser } = useAuth();
  const router = useRouter();

  const [name,   setName]   = useState(user?.name  || '');
  const [phone,  setPhone]  = useState(user?.phone || '');
  const [gender, setGender] = useState<Gender | null>((user as any)?.gender ?? null);
  const [dob,    setDob]    = useState<string>((user as any)?.dob ?? '');

  const [saving,     setSaving]     = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [viewToken,  setViewToken]  = useState<string | null>(null);
  const [error,      setError]      = useState<string | null>(null);
  const [genderOpen, setGenderOpen] = useState(false);

  React.useEffect(() => {
    if (token && user?.photo_url) getPhotoViewToken(token).then(setViewToken);
  }, [token, user?.photo_url]);

  const photoSrc =
    user?.photo_url && viewToken
      ? `${API_BASE}${user.photo_url}&token=${viewToken}`
      : null;

  /** Validate locally before hitting the server. */
  const validate = useCallback((): string | null => {
    if (!name.trim()) return 'Display name cannot be empty.';
    const ph = phone.trim();
    if (ph && (ph.length < 6 || ph.length > 20)) return 'Phone must be 6–20 characters.';
    if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob))
      return 'Date of birth must be in YYYY-MM-DD format.';
    if (dob && !isAtLeast18(dob))
      return 'You must be 18 or older to use Dhara.';
    return null;
  }, [name, phone, dob]);

  async function onSave() {
    if (!token) return;
    const problem = validate();
    if (problem) { setError(problem); return; }
    setError(null);
    setSaving(true);
    try {
      await editProfile(token, {
        name:   name.trim(),
        phone:  phone.trim() || undefined,
        gender: gender ?? undefined,
        dob:    dob.trim()   || undefined,
      } as any);
      await refreshUser();
      router.back();
    } catch (e: any) {
      setError(e?.message || 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const genderLabel =
    GENDER_OPTIONS.find(o => o.value === gender)?.label ?? 'Select gender (optional)';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }} edges={['bottom']}>
      <ScreenHeader title="Edit profile" />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">

        {/* ── Avatar ────────────────────────────────────────────────────── */}
        <Pressable
          onPress={() => setPickerOpen(true)}
          style={(s) => [styles.avatarWrap, focusRingStyle(s)]}
          testID="edit-profile-avatar"
          accessibilityRole="button"
          accessibilityLabel="Change profile photo"
        >
          {photoSrc ? (
            <Image source={{ uri: photoSrc }} style={styles.avatarImg} />
          ) : (
            <View style={styles.avatarFallback}>
              <Ionicons name="person-circle-outline" size={72} color={c.navy} />
            </View>
          )}
          <View style={styles.cameraBadge}>
            <Ionicons name="camera" size={14} color="#fff" />
          </View>
        </Pressable>
        <Pressable
          onPress={() => setPickerOpen(true)}
          style={(s) => [styles.changeBtn, focusRingStyle(s)]}
          accessibilityRole="button"
          accessibilityLabel="Change photo"
        >
          <Text style={styles.changeTxt}>Change photo</Text>
        </Pressable>

        {/* ── Error banner ─────────────────────────────────────────────── */}
        {!!error && (
          <View style={styles.errorBox} accessibilityRole="alert">
            <Text style={styles.errorTxt}>{error}</Text>
          </View>
        )}

        {/* ── Display name ─────────────────────────────────────────────── */}
        <View style={styles.field}>
          <Text style={styles.label}>Display name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            style={styles.input}
            placeholder="Your name"
            placeholderTextColor={c.muted}
            testID="edit-profile-name-input"
            accessibilityLabel="Display name"
          />
        </View>

        {/* ── Email (read-only) ─────────────────────────────────────────── */}
        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <Text style={styles.readOnly}>{user?.email || '—'}</Text>
          <Text style={styles.hint}>Email cannot be changed here.</Text>
        </View>

        {/* ── Phone (editable, 6-20 chars) ─────────────────────────────── */}
        <View style={styles.field}>
          <Text style={styles.label}>Phone number</Text>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            style={styles.input}
            placeholder="+91 98765 43210"
            placeholderTextColor={c.muted}
            keyboardType="phone-pad"
            maxLength={20}
            testID="edit-profile-phone-input"
            accessibilityLabel="Phone number"
          />
          <Text style={styles.hint}>6–20 characters. Changing this links any pending Trusted Circle invitations sent to this number.</Text>
        </View>

        {/* ── Gender (optional, pill picker) ───────────────────────────── */}
        <View style={styles.field}>
          <Text style={styles.label}>Gender <Text style={styles.optionalTag}>(optional)</Text></Text>
          <Pressable
            onPress={() => setGenderOpen(true)}
            style={(s) => [styles.pickerBtn, focusRingStyle(s)]}
            testID="edit-profile-gender-picker"
            accessibilityRole="button"
            accessibilityLabel={`Gender: ${genderLabel}`}
          >
            <Text style={[styles.pickerTxt, !gender && { color: c.muted }]}>{genderLabel}</Text>
            <Ionicons name="chevron-down" size={16} color={c.muted} />
          </Pressable>
        </View>

        {/* ── Date of birth (optional, 18+ only) ───────────────────────── */}
        <View style={styles.field}>
          <Text style={styles.label}>Date of birth <Text style={styles.optionalTag}>(optional)</Text></Text>
          <TextInput
            value={dob}
            onChangeText={(v) => {
              // Auto-format: insert dashes after 4 and 7 chars
              const digits = v.replace(/\D/g, '').slice(0, 8);
              let formatted = digits;
              if (digits.length > 4) formatted = digits.slice(0, 4) + '-' + digits.slice(4);
              if (digits.length > 6) formatted = digits.slice(0, 4) + '-' + digits.slice(4, 6) + '-' + digits.slice(6);
              setDob(formatted);
            }}
            style={styles.input}
            placeholder="YYYY-MM-DD (must be 18+)"
            placeholderTextColor={c.muted}
            keyboardType="number-pad"
            maxLength={10}
            testID="edit-profile-dob-input"
            accessibilityLabel="Date of birth, YYYY-MM-DD format, you must be 18 or older"
          />
          {dob.length === 10 && (
            isAtLeast18(dob)
              ? <Text style={[styles.hint, { color: '#087951' }]}>✓ Age confirmed 18+</Text>
              : <Text style={[styles.hint, { color: c.error }]}>⚠ You must be 18 or older to use Dhara.</Text>
          )}
        </View>

        {/* ── Save ─────────────────────────────────────────────────────── */}
        <Pressable
          style={(s) => [styles.saveBtn, focusRingStyle(s)]}
          onPress={onSave}
          disabled={saving}
          testID="edit-profile-save"
          accessibilityRole="button"
          accessibilityLabel="Save profile"
          accessibilityState={{ disabled: saving, busy: saving }}
        >
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.saveBtnTxt}>Save</Text>}
        </Pressable>
      </ScrollView>

      {/* ── Gender picker modal ───────────────────────────────────────── */}
      <Modal
        visible={genderOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setGenderOpen(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setGenderOpen(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Select gender</Text>
            {GENDER_OPTIONS.map((opt) => (
              <Pressable
                key={opt.value}
                testID={`gender-option-${opt.value}`}
                style={(s) => [styles.modalRow, focusRingStyle(s)]}
                onPress={() => { setGender(opt.value); setGenderOpen(false); }}
                accessibilityRole="button"
                accessibilityLabel={opt.label}
              >
                <Text style={[styles.modalRowTxt, gender === opt.value && styles.modalRowActive]}>
                  {opt.label}
                </Text>
                {gender === opt.value && (
                  <Ionicons name="checkmark" size={18} color={c.navy} />
                )}
              </Pressable>
            ))}
            <Pressable
              style={styles.modalCancel}
              onPress={() => setGenderOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Cancel gender selection"
            >
              <Text style={styles.modalCancelTxt}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <PhotoPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        token={token || ''}
        hasPhoto={!!user?.photo_url}
        onChanged={async () => { await refreshUser(); }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body:          { padding: 16, alignItems: 'center' },
  avatarWrap:    { marginTop: 12 },
  avatarImg:     { width: 104, height: 104, borderRadius: 52, borderWidth: 3, borderColor: c.gold },
  avatarFallback: { width: 104, height: 104, borderRadius: 52, backgroundColor: c.surfaceSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: c.gold },
  cameraBadge:   { position: 'absolute', right: 0, bottom: 0, width: 30, height: 30, borderRadius: 15, backgroundColor: c.navy, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: c.background },
  changeBtn:     { marginTop: 10, marginBottom: 20, minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  changeTxt:     { fontFamily: theme.fonts.bodySemiBold, color: c.navy, fontSize: 13 },
  errorBox:      { width: '100%', backgroundColor: '#FFF0F0', borderRadius: 10, borderWidth: 1, borderColor: '#EFC7C7', padding: 12, marginBottom: 12 },
  errorTxt:      { fontFamily: theme.fonts.body, fontSize: 13, color: c.error, lineHeight: 18 },
  field:         { width: '100%', marginBottom: 16 },
  label:         { fontFamily: theme.fonts.bodySemiBold, color: c.navy, fontSize: 12, marginBottom: 6 },
  optionalTag:   { fontFamily: theme.fonts.body, color: c.muted, fontSize: 12 },
  input:         { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontFamily: theme.fonts.body, fontSize: 13, color: c.ink, minHeight: 48 },
  readOnly:      { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, paddingVertical: 10 },
  hint:          { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 4, lineHeight: 17 },
  pickerBtn:     { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pickerTxt:     { fontFamily: theme.fonts.body, fontSize: 13, color: c.ink },
  saveBtn:       { backgroundColor: c.navy, width: '100%', borderRadius: 14, minHeight: 52, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  saveBtnTxt:    { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 14 },
  // Gender modal
  modalOverlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet:    { backgroundColor: c.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 36 },
  modalTitle:    { fontFamily: theme.fonts.displayBold, fontSize: 16, color: c.ink, marginBottom: 12 },
  modalRow:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.divider, minHeight: 52 },
  modalRowTxt:   { flex: 1, fontFamily: theme.fonts.body, fontSize: 14, color: c.ink },
  modalRowActive: { fontFamily: theme.fonts.bodyBold, color: c.navy },
  modalCancel:   { marginTop: 12, minHeight: 50, alignItems: 'center', justifyContent: 'center' },
  modalCancelTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 14, color: c.muted },
});
