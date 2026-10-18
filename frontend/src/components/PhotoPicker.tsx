/**
 * Profile photo action sheet: Take a photo / Choose from gallery / Remove /
 * Cancel -> native crop (allowsEditing, 1:1) -> circular preview -> confirm
 * & upload (with cancel/retry) -> onChanged(new photo_url | null).
 *
 * Permissions contract: camera permission is requested contextually (only
 * when the user taps "Take a photo"), with denied/blocked states handled
 * and a "Open Settings" fallback. The gallery option intentionally uses
 * ImagePicker's native system picker, which does NOT require a broad
 * media-library permission request on modern iOS/Android.
 */
import React, { useState } from 'react';
import { Modal, View, Text, Pressable, Image, ActivityIndicator, StyleSheet, Linking, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import { uploadProfilePhoto, removeProfilePhoto } from '../trustedCircle/api';

const c = theme.colors;

type Stage = 'menu' | 'preview' | 'uploading' | 'error' | 'removing';

export function PhotoPicker({
  visible, onClose, token, hasPhoto, onChanged,
}: {
  visible: boolean;
  onClose: () => void;
  token: string;
  hasPhoto: boolean;
  onChanged: (newPhotoUrl: string | null) => void;
}) {
  const [stage, setStage] = useState<Stage>('menu');
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState('');

  function reset() {
    setStage('menu'); setUri(null); setError('');
  }
  function close() {
    reset(); onClose();
  }

  async function ensureCameraPermission(): Promise<boolean> {
    const current = await ImagePicker.getCameraPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) {
      setError('Camera access is turned off for DHARA. Open Settings to allow it.');
      setStage('error');
      return false;
    }
    const req = await ImagePicker.requestCameraPermissionsAsync();
    if (req.granted) return true;
    if (!req.canAskAgain) {
      setError('Camera access was denied. Open Settings to allow it.');
      setStage('error');
    } else {
      setError('Camera access is needed to take a profile photo.');
      setStage('error');
    }
    return false;
  }

  async function takePhoto() {
    const ok = await ensureCameraPermission();
    if (!ok) return;
    const res = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.9 });
    if (!res.canceled && res.assets?.[0]?.uri) { setUri(res.assets[0].uri); setStage('preview'); }
  }

  async function chooseFromGallery() {
    // Native system picker — no broad library permission needed.
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.9 });
    if (!res.canceled && res.assets?.[0]?.uri) { setUri(res.assets[0].uri); setStage('preview'); }
  }

  async function confirmUpload() {
    if (!uri) return;
    setStage('uploading');
    try {
      const name = uri.split('/').pop() || 'profile.jpg';
      const ext = (name.split('.').pop() || 'jpg').toLowerCase();
      const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      const data = await uploadProfilePhoto(token, { uri, name, type });
      onChanged(data.photo_url);
      close();
    } catch (e: any) {
      setError(e?.message || 'Upload failed. Check your connection and try again.');
      setStage('error');
    }
  }

  async function removePhoto() {
    setStage('removing');
    try {
      await removeProfilePhoto(token);
      onChanged(null);
      close();
    } catch {
      setError('Could not remove photo. Please try again.');
      setStage('error');
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close} testID="photo-picker-modal">
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {stage === 'menu' && (
            <>
              <Text style={styles.sheetTitle}>Profile photo</Text>
              <Pressable style={styles.row} onPress={takePhoto} testID="photo-take">
                <Ionicons name="camera-outline" size={20} color={c.navy} />
                <Text style={styles.rowTxt}>Take a photo</Text>
              </Pressable>
              <Pressable style={styles.row} onPress={chooseFromGallery} testID="photo-choose">
                <Ionicons name="images-outline" size={20} color={c.navy} />
                <Text style={styles.rowTxt}>Choose from gallery</Text>
              </Pressable>
              {hasPhoto && (
                <Pressable style={styles.row} onPress={removePhoto} testID="photo-remove">
                  <Ionicons name="trash-outline" size={20} color={c.error} />
                  <Text style={[styles.rowTxt, { color: c.error }]}>Remove photo</Text>
                </Pressable>
              )}
              <Pressable style={[styles.row, { borderBottomWidth: 0 }]} onPress={close} testID="photo-cancel">
                <Ionicons name="close-outline" size={20} color={c.muted} />
                <Text style={[styles.rowTxt, { color: c.muted }]}>Cancel</Text>
              </Pressable>
            </>
          )}

          {stage === 'preview' && uri && (
            <View style={{ alignItems: 'center' }}>
              <Text style={styles.sheetTitle}>Use this photo?</Text>
              <Image source={{ uri }} style={styles.previewCircle} />
              <Text style={styles.hint}>Only you (or recipients you allow) will see this.</Text>
              <View style={styles.actionsRow}>
                <Pressable style={styles.secondaryBtn} onPress={() => setStage('menu')} testID="photo-retake">
                  <Text style={styles.secondaryBtnTxt}>Retake</Text>
                </Pressable>
                <Pressable style={styles.primaryBtn} onPress={confirmUpload} testID="photo-confirm">
                  <Text style={styles.primaryBtnTxt}>Use this photo</Text>
                </Pressable>
              </View>
            </View>
          )}

          {(stage === 'uploading' || stage === 'removing') && (
            <View style={{ alignItems: 'center', paddingVertical: 20 }}>
              <ActivityIndicator color={c.navy} size="large" />
              <Text style={styles.hint}>{stage === 'uploading' ? 'Uploading…' : 'Removing…'}</Text>
              {stage === 'uploading' && (
                <Pressable onPress={() => setStage('preview')} testID="photo-cancel-upload">
                  <Text style={[styles.hint, { color: c.error, marginTop: 10 }]}>Cancel</Text>
                </Pressable>
              )}
            </View>
          )}

          {stage === 'error' && (
            <View style={{ alignItems: 'center' }}>
              <Ionicons name="alert-circle-outline" size={28} color={c.error} />
              <Text style={[styles.hint, { marginTop: 8, textAlign: 'center' }]}>{error}</Text>
              <View style={styles.actionsRow}>
                <Pressable style={styles.secondaryBtn} onPress={close} testID="photo-error-close">
                  <Text style={styles.secondaryBtnTxt}>Close</Text>
                </Pressable>
                {error.includes('Settings') ? (
                  <Pressable style={styles.primaryBtn} onPress={() => Linking.openSettings()} testID="photo-open-settings">
                    <Text style={styles.primaryBtnTxt}>Open Settings</Text>
                  </Pressable>
                ) : (
                  <Pressable style={styles.primaryBtn} onPress={() => (uri ? setStage('preview') : setStage('menu'))} testID="photo-retry">
                    <Text style={styles.primaryBtnTxt}>Retry</Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(14,39,64,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: Platform.OS === 'ios' ? 36 : 24 },
  sheetTitle: { fontFamily: theme.fonts.displayBold, fontSize: 18, color: c.navy, marginBottom: 12, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.border },
  rowTxt: { fontFamily: theme.fonts.bodyMedium, fontSize: 16, color: c.navy },
  previewCircle: { width: 160, height: 160, borderRadius: 80, borderWidth: 3, borderColor: c.gold, marginVertical: 14 },
  hint: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, marginTop: 4 },
  actionsRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  primaryBtn: { backgroundColor: c.navy, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 999, minHeight: 44, justifyContent: 'center' },
  primaryBtnTxt: { color: '#fff', fontFamily: theme.fonts.bodySemiBold, fontSize: 14 },
  secondaryBtn: { backgroundColor: c.surfaceSecondary, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 999, minHeight: 44, justifyContent: 'center' },
  secondaryBtnTxt: { color: c.navy, fontFamily: theme.fonts.bodySemiBold, fontSize: 14 },
});
