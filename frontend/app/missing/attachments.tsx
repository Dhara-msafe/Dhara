import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';
import { loadSupport, mapUrl, MissingLocation, MissingPhoto, MissingSupport, photoRequest, saveSupport } from '@/src/missing/support';
import { PrivatePhoto } from '@/src/missing/PrivatePhoto';

import { openExternal } from '@/src/outbound';
const colors = theme.colors;
function Action({ id, label, icon, onPress, disabled = false }: { id: string; label: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void; disabled?: boolean }) {
  return <Pressable testID={id} accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [s.button, (disabled || pressed) && s.dim]}><Ionicons name={icon} size={19} color={colors.primary} /><Text style={s.buttonText}>{label}</Text></Pressable>;
}

export default function MissingAttachments() {
  const { user, token } = useAuth();
  const router = useRouter();
  const [support, setSupport] = useState<MissingSupport | null>(null);
  const [photos, setPhotos] = useState<MissingPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [photoConsent, setPhotoConsent] = useState(false);
  const [candidate, setCandidate] = useState<MissingLocation | null>(null);
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');

  const load = useCallback(async () => {
    if (!user || !token) { setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const stored = await loadSupport(user.id); setSupport(stored);
      const files: MissingPhoto[] = await (await photoRequest(stored.draftId, token)).json();
      setPhotos(files);
      const next = { ...stored, photosAttached: files.length > 0 };
      await saveSupport(user.id, next); setSupport(next);
    } catch (e: any) { setError(e.message || 'Could not load attachments. Please retry.'); }
    finally { setLoading(false); }
  }, [user, token]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function pickPhoto(camera: boolean) {
    if (!support || !token || !user || !photoConsent || busy) return;
    setBusy(true); setError('');
    try {
      if (camera && Platform.OS !== 'web') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) throw new Error('Camera permission was denied. You can choose a photo instead.');
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7, base64: false, exif: false };
      const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled) return;
      const asset = result.assets[0];
      if ((asset.fileSize || 0) > 5 * 1024 * 1024) throw new Error('Choose a photo smaller than 5 MB.');
      const form = new FormData();
      if (Platform.OS === 'web') form.append('file', await (await fetch(asset.uri)).blob(), asset.fileName || 'photo.jpg');
      else form.append('file', { uri: asset.uri, name: asset.fileName || 'photo.jpg', type: asset.mimeType || 'image/jpeg' } as any);
      // Mark potential attachment before upload, so a local-save failure cannot
      // silently exclude an already uploaded photo from a later PDF.
      const next = { ...support, photosAttached: true };
      await saveSupport(user.id, next); setSupport(next);
      const saved: MissingPhoto = await (await photoRequest(support.draftId, token, undefined, { method: 'POST', body: form })).json();
      setPhotos(prev => [...prev, saved]);
    } catch (e: any) { setError(e.message || 'Could not attach the photo. Please retry.'); }
    finally { setBusy(false); }
  }

  async function removePhoto(id: string) {
    if (!support || !token || busy) return;
    setBusy(true); setError('');
    try { await photoRequest(support.draftId, token, id, { method: 'DELETE' }); setPhotos(prev => prev.filter(p => p.file_id !== id)); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function locate() {
    setBusy(true); setError('');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      let permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted) permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        if (!permission.canAskAgain) {
          Alert.alert(
            'Location permission needed',
            'DHARA uses your location only to add it to this missing-person report. Open Settings to allow it, or enter coordinates below.',
            [{ text: 'Cancel', style: 'cancel' }, { text: 'Open Settings', onPress: () => Linking.openSettings() }],
          );
          setBusy(false);
          return;
        }
        throw new Error('Location permission was denied. Enter coordinates below or continue without GPS.');
      }
      const result = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('GPS took too long. Retry outdoors or enter coordinates below.')), 15000); }),
      ]);
      setCandidate({ latitude: result.coords.latitude, longitude: result.coords.longitude, accuracy: result.coords.accuracy ?? undefined, source: 'gps' });
    } catch (e: any) { setError(e.message || 'GPS is unavailable. You can enter coordinates instead.'); }
    finally { if (timer) clearTimeout(timer); setBusy(false); }
  }

  function enterCoordinates() {
    const lat = Number(latitude.trim()); const lng = Number(longitude.trim());
    if (!latitude.trim() || !longitude.trim() || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      setError('Enter latitude from −90 to 90 and longitude from −180 to 180.'); return;
    }
    setError(''); setCandidate({ latitude: lat, longitude: lng, source: 'manual' });
  }

  async function updateLocation(location?: MissingLocation) {
    if (!support || !user) return;
    setBusy(true); setError('');
    try { const next = { ...support, location }; await saveSupport(user.id, next); setSupport(next); setCandidate(null); }
    catch { setError('Location could not be saved on this device. Please retry.'); }
    finally { setBusy(false); }
  }
  const openMap = (location: MissingLocation) => openExternal(mapUrl(location)).catch(() => setError('Could not open Maps. Please use the coordinates shown.'));
  return <SafeAreaView edges={['top', 'bottom']} style={s.safe} testID="missing-attachments-screen">
    <View style={s.header}><Action id="missing-attachments-back" icon="arrow-back" label="Back" onPress={() => router.back()} disabled={busy} /><Text testID="missing-attachments-title" style={s.title}>Photos & location</Text></View>
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView testID="missing-attachments-scroll" contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text testID="missing-attachments-intro" style={s.body}>Optional details for your written complaint. Nothing is submitted to police. Do not delay calling 112.</Text>
        {!token && <Action id="missing-attachments-login" icon="log-in-outline" label="Sign in to attach photos" onPress={() => router.push('/login')} />}
        {error ? <View style={s.notice}><Text testID="missing-attachments-error" accessibilityRole="alert" style={s.error}>{error}</Text><Action id="missing-attachments-retry" icon="refresh" label="Retry loading photos" onPress={load} disabled={busy} /></View> : null}
        {loading && <ActivityIndicator testID="missing-attachments-loading" color={colors.primary} />}
        <View style={s.card}>
          <Text testID="missing-photos-heading" style={s.heading}>Recent photos · {photos.length}/3</Text>
          <Text testID="missing-photos-privacy" style={s.body}>Only photos you choose are uploaded to private storage for this complaint. Answers and GPS stay on this device. JPG, PNG or WebP, up to 5 MB each.</Text>
          <Pressable testID="missing-photo-consent" accessibilityRole="checkbox" accessibilityState={{ checked: photoConsent }} onPress={() => setPhotoConsent(v => !v)} style={s.consent} disabled={busy}>
            <Ionicons name={photoConsent ? 'checkbox' : 'square-outline'} size={24} color={colors.primary} /><Text style={s.consentText}>I agree to upload the selected photos privately.</Text>
          </Pressable>
          <View style={s.row}><Action id="missing-pick-photo" icon="images-outline" label="Choose photo" onPress={() => pickPhoto(false)} disabled={!photoConsent || busy || !support || photos.length >= 3} /><Action id="missing-take-photo" icon="camera-outline" label="Camera" onPress={() => pickPhoto(true)} disabled={!photoConsent || busy || !support || photos.length >= 3} /></View>
          {photos.map(photo => <View key={photo.file_id} testID={`missing-attachment-${photo.file_id}`} style={s.photo}>
            <PrivatePhoto draftId={support!.draftId} id={photo.file_id} token={token!} />
            <Action id={`missing-remove-photo-${photo.file_id}`} icon="close-circle-outline" label="Remove attachment" onPress={() => removePhoto(photo.file_id)} disabled={busy} />
          </View>)}
          {photos.length > 0 && <Text testID="missing-photo-removal-note" style={s.hint}>Removing detaches the photo and disables access. A storage copy may remain.</Text>}
        </View>
        <View style={s.card}>
          <Text testID="missing-location-heading" style={s.heading}>Last-seen map location</Text>
          <Text testID="missing-location-warning" style={s.body}>Your current GPS is not the missing person’s live location. Use it only if you are at the last-seen place, or enter that place’s coordinates below.</Text>
          <Action id="missing-use-gps" icon="locate-outline" label="Use my current GPS" onPress={locate} disabled={busy || !support} />
          <Text testID="missing-manual-coordinates-label" style={s.hint}>Or enter coordinates from your map</Text>
          <TextInput testID="missing-latitude" accessibilityLabel="Latitude" placeholder="Latitude (e.g. 19.0760)" placeholderTextColor={colors.onSurfaceTertiary} style={s.input} value={latitude} onChangeText={setLatitude} keyboardType="numbers-and-punctuation" />
          <TextInput testID="missing-longitude" accessibilityLabel="Longitude" placeholder="Longitude (e.g. 72.8777)" placeholderTextColor={colors.onSurfaceTertiary} style={s.input} value={longitude} onChangeText={setLongitude} keyboardType="numbers-and-punctuation" />
          <Action id="missing-review-coordinates" icon="pin-outline" label="Review coordinates" onPress={enterCoordinates} disabled={busy || !support} />
          {candidate && <View testID="missing-location-confirmation" style={s.notice}>
            <Text testID="missing-candidate-coordinates" style={s.body}>{candidate.latitude.toFixed(6)}, {candidate.longitude.toFixed(6)}{candidate.accuracy ? ` · accuracy ±${Math.round(candidate.accuracy)} m` : ''}</Text>
            <Action id="missing-preview-map" icon="map-outline" label="Check on map" onPress={() => openMap(candidate)} />
            <Action id="missing-confirm-location" icon="checkmark-circle-outline" label="Confirm as last-seen location" onPress={() => updateLocation(candidate)} disabled={busy} />
            <Action id="missing-cancel-location" icon="close" label="Cancel" onPress={() => setCandidate(null)} disabled={busy} />
          </View>}
          {support?.location && <View style={s.notice}>
            <Text testID="missing-saved-location" style={s.body}>Confirmed last-seen location: {support.location.latitude.toFixed(6)}, {support.location.longitude.toFixed(6)}</Text>
            <Action id="missing-open-saved-map" icon="map-outline" label="View on map" onPress={() => openMap(support.location!)} />
            <Action id="missing-remove-location" icon="close-circle-outline" label="Remove location" onPress={() => updateLocation()} disabled={busy} />
          </View>}
        </View>
        {busy && <View testID="missing-attachments-busy" style={s.row}><ActivityIndicator color={colors.primary} /><Text style={s.body}>Please wait…</Text></View>}
        <Action id="missing-attachments-done" icon="checkmark" label="Done — return to complaint" onPress={() => router.back()} disabled={busy} />
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background }, flex: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: colors.surface }, title: { flex: 1, color: colors.primary, fontSize: 20, fontWeight: '700' },
  content: { padding: 18, paddingBottom: 32, gap: 18 }, card: { backgroundColor: colors.surface, borderRadius: 16, padding: 16, gap: 14, borderWidth: 1, borderColor: colors.divider },
  heading: { fontSize: 18, fontWeight: '700', color: colors.primary }, body: { fontSize: 14, lineHeight: 22, color: colors.onSurfaceSecondary }, hint: { fontSize: 12, lineHeight: 18, color: colors.onSurfaceTertiary },
  consent: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 }, consentText: { flex: 1, fontSize: 14, lineHeight: 21, color: colors.onSurface },
  button: { minHeight: 46, borderRadius: 12, backgroundColor: colors.navySoft, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  buttonText: { fontSize: 13, fontWeight: '700', color: colors.primary, flexShrink: 1 }, row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }, dim: { opacity: 0.45 },
  notice: { backgroundColor: colors.goldMuted, borderRadius: 12, padding: 12, gap: 10 }, error: { fontSize: 14, lineHeight: 21, color: colors.error }, photo: { gap: 8 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, minHeight: 48, color: colors.onSurface, fontSize: 15 },
});