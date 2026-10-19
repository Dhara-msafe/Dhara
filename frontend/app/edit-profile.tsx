import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, Image, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { PhotoPicker } from '@/src/components/PhotoPicker';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { editProfileName, getPhotoViewToken } from '@/src/trustedCircle/api';
import { API_BASE } from '@/src/apiBase';

const c = theme.colors;

export default function EditProfileScreen() {
  const { user, token, refreshUser } = useAuth();
  const router = useRouter();
  const [name, setName] = useState(user?.name || '');
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [viewToken, setViewToken] = useState<string | null>(null);

  React.useEffect(() => {
    if (token && user?.photo_url) getPhotoViewToken(token).then(setViewToken);
  }, [token, user?.photo_url]);

  const photoSrc = user?.photo_url && viewToken ? `${API_BASE}${user.photo_url}&token=${viewToken}` : null;

  async function onSave() {
    if (!token) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await editProfileName(token, trimmed);
      await refreshUser();
      router.back();
    } catch {
      // non-fatal — keep the screen open so the user can retry
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }} edges={['bottom']}>
      <ScreenHeader title="Edit profile" />
      <ScrollView contentContainerStyle={styles.body}>
        <Pressable onPress={() => setPickerOpen(true)} style={styles.avatarWrap} testID="edit-profile-avatar" accessibilityRole="button" accessibilityLabel="Change profile photo">
          {photoSrc ? (
            <Image source={{ uri: photoSrc }} style={styles.avatarImg} />
          ) : (
            <View style={styles.avatarFallback}>
              <Ionicons name="person-circle-outline" size={72} color={c.navy} />
            </View>
          )}
          <View style={styles.cameraBadge}><Ionicons name="camera" size={14} color="#fff" /></View>
        </Pressable>
        <Text style={styles.changeTxt} onPress={() => setPickerOpen(true)} accessibilityRole="button">Change photo</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Display name</Text>
          <TextInput value={name} onChangeText={setName} style={styles.input} placeholder="Your name" placeholderTextColor={c.muted} testID="edit-profile-name-input" />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <Text style={styles.readOnly}>{user?.email || '—'}</Text>
        </View>

        <Pressable style={styles.saveBtn} onPress={onSave} disabled={saving} testID="edit-profile-save">
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnTxt}>Save</Text>}
        </Pressable>
      </ScrollView>

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
  body: { padding: 20, alignItems: 'center' },
  avatarWrap: { marginTop: 12 },
  avatarImg: { width: 104, height: 104, borderRadius: 52, borderWidth: 3, borderColor: c.gold },
  avatarFallback: { width: 104, height: 104, borderRadius: 52, backgroundColor: c.surfaceSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: c.gold },
  cameraBadge: { position: 'absolute', right: 0, bottom: 0, width: 30, height: 30, borderRadius: 15, backgroundColor: c.navy, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: c.background },
  changeTxt: { fontFamily: theme.fonts.bodySemiBold, color: c.navy, fontSize: 14, marginTop: 10, marginBottom: 20 },
  field: { width: '100%', marginBottom: 16 },
  label: { fontFamily: theme.fonts.bodySemiBold, color: c.navy, fontSize: 13, marginBottom: 6 },
  input: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontFamily: theme.fonts.body, fontSize: 15, color: c.ink, minHeight: 48 },
  readOnly: { fontFamily: theme.fonts.body, fontSize: 15, color: c.muted, paddingVertical: 10 },
  visBox: { width: '100%', backgroundColor: c.surfaceSecondary, borderRadius: 14, padding: 14, marginTop: 4, marginBottom: 24 },
  hint: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 4, lineHeight: 17 },
  saveBtn: { backgroundColor: c.navy, width: '100%', borderRadius: 999, minHeight: 50, alignItems: 'center', justifyContent: 'center' },
  saveBtnTxt: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 16 },
});
