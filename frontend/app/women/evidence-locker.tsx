import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Platform, AppState, Image, TextInput } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { saveRecording, savePhoto, saveVideo, loadRecordings, deleteRecording, releaseRecordings, discardTemporaryRecording, type RecordingItem } from '@/src/women/evidenceStore';
import { hasPin, setPin, verifyPin } from '@/src/women/evidenceLock';
import { screenPlayer } from '@/src/media/screenPlayer';
import type { TtsPlayer } from '@/src/voice/tts';

const c = theme.colors;

// ── PIN lock gate ───────────────────────────────────────────────────────────
function PinGate({ onUnlock }: { onUnlock: () => void }) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'checking' | 'create' | 'confirm' | 'enter'>('checking');
  const [pin, setPinInput] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    hasPin()
      .then(exists => setMode(exists ? 'enter' : 'create'))
      .catch(() => { setMode('create'); setError('Could not check for an existing PIN — you can set a new one.'); });
  }, []);

  const submit = useCallback(async () => {
    setError('');
    if (pin.length < 4) { setError('Enter at least 4 digits.'); return; }
    if (mode === 'create') { setFirstPin(pin); setPinInput(''); setMode('confirm'); return; }
    if (mode === 'confirm') {
      if (pin !== firstPin) { setError('PINs did not match — try again.'); setPinInput(''); setFirstPin(''); setMode('create'); return; }
      await setPin(pin); onUnlock(); return;
    }
    if (mode === 'enter') {
      const ok = await verifyPin(pin);
      if (!ok) { setError('Incorrect PIN.'); setPinInput(''); return; }
      onUnlock();
    }
  }, [pin, mode, firstPin, onUnlock]);

  if (mode === 'checking') return <View style={styles.root}><ActivityIndicator color={c.navy} style={{ marginTop: 60 }} /></View>;

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24, alignItems: 'center' }]} testID="evidence-pin-gate">
      <Text style={styles.heading}>
        {mode === 'create' ? 'Set a PIN for the Evidence Locker' : mode === 'confirm' ? 'Confirm your PIN' : 'Enter your PIN'}
      </Text>
      <Text style={[styles.note, { textAlign: 'center' }]}>
        {mode === 'enter' ? 'This locks your recordings, photos and videos so no one else can open this screen.' : 'Choose 4–6 digits. This stays on your device only — DHARA cannot reset it for you.'}
      </Text>
      <TextInput
        testID="evidence-pin-input"
        value={pin}
        onChangeText={t => setPinInput(t.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
        placeholder="••••"
        style={styles.pinInput}
        autoFocus
      />
      {!!error && <Text testID="evidence-pin-error" style={[styles.note, { color: c.emergencyRed }]}>{error}</Text>}
      <Pressable testID="evidence-pin-submit" style={styles.button} onPress={submit}>
        <Text style={styles.buttonText}>{mode === 'enter' ? 'Unlock' : 'Continue'}</Text>
      </Pressable>
    </View>
  );
}

export default function EvidenceLocker() {
  const router = useRouter();
  const params = useLocalSearchParams<{ record?: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const scope = user?.id || 'device';
  const [unlocked, setUnlocked] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 250);
  const [items, setItems] = useState<RecordingItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const player = useRef<TtsPlayer | null>(null);
  const epoch = useRef(0);
  const working = useRef(false);
  const active = useRef(false);
  const owned = useRef<RecordingItem[]>([]);
  const stopPlayer = useCallback(() => { player.current?.remove(); player.current = null; setPlaying(null); }, []);
  const cancel = useCallback(() => {
    epoch.current++;
    stopPlayer();
    if (active.current) { active.current = false; void recorder.stop().then(() => discardTemporaryRecording(recorder.uri)).catch(() => {}); }
    if (Platform.OS !== 'web') void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
  }, [recorder, stopPlayer]);
  useFocusEffect(useCallback(() => {
    let alive = true;
    loadRecordings(scope).then(rows => { if (alive) { owned.current = rows; setItems(rows); } else releaseRecordings(rows); }).catch(() => setStatus('Saved recordings could not load. Please reopen this screen.'));
    return () => { alive = false; cancel(); releaseRecordings(owned.current); owned.current = []; };
  }, [scope, cancel]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', value => { if (value !== 'active') { cancel(); setStatus('Recording stopped. Unfinished audio is not saved. Keep this screen open and use Stop & save.'); } });
    return () => sub.remove();
  }, [cancel]);
  const start = useCallback(async () => {
    if (working.current || active.current) return;
    working.current = true; setBusy(true); setStatus(''); stopPlayer();
    const id = ++epoch.current;
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error('Microphone permission is needed. Allow it in your device or site settings, then try again.');
      if (id !== epoch.current) return;
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: false });
      await recorder.prepareToRecordAsync();
      if (id !== epoch.current) {
        // Web MediaRecorder cannot stop while inactive. Briefly start solely
        // to release the prepared input stream; never retain this audio.
        if (Platform.OS === 'web') recorder.record();
        await recorder.stop(); discardTemporaryRecording(recorder.uri); return;
      }
      recorder.record(); active.current = true;
      setStatus('Recording on this device. Tap Stop & save before leaving this screen.');
    } catch (error: any) { if (id === epoch.current) setStatus(error.message || 'Recording could not start. Please try again.'); }
    finally { working.current = false; setBusy(false); }
  }, [recorder, stopPlayer]);
  const started = useRef(false);
  useEffect(() => {
    if (params.record === '1' && !started.current) { started.current = true; router.setParams({ record: '' }); void start(); }
  }, [params.record, router, start]);
  const save = async () => {
    if (working.current || !active.current) return;
    working.current = true; setBusy(true); active.current = false;
    try {
      await recorder.stop();
      if (!recorder.uri) throw new Error('No audio was captured. Please record again.');
      const item = await saveRecording(scope, recorder.uri);
      discardTemporaryRecording(recorder.uri);
      owned.current = [item, ...owned.current]; setItems(owned.current);
      setStatus('Saved on this device. Nothing was uploaded or sent.');
    } catch (error: any) { setStatus(error.message || 'Recording could not be saved.'); }
    finally { working.current = false; setBusy(false); if (Platform.OS !== 'web') void setAudioModeAsync({ allowsRecording: false }).catch(() => {}); }
  };
  const play = useCallback(async (item: RecordingItem) => {
    const wasPlaying = playing === item.id;
    stopPlayer(); if (wasPlaying) return;
    try {
      const sound = screenPlayer(item.uri); player.current = sound; setPlaying(item.id);
      sound.onFinish(stopPlayer);
      await sound.play();
    } catch { stopPlayer(); setStatus('Playback could not start. Tap Play again or check device audio.'); }
  }, [playing, stopPlayer]);
  const remove = useCallback(async (item: RecordingItem) => {
    try {
      stopPlayer(); await deleteRecording(scope, item);
      owned.current = owned.current.filter(row => row.id !== item.id); setItems(owned.current); setDeleting(null); setStatus('Recording deleted from this device.');
    } catch { setStatus('Could not delete this recording. Please try again.'); }
  }, [scope, stopPlayer]);

  // ── Camera capture (DHARA: photo + video, no network, 2-min video cap) ──
  const capture = useCallback(async (kind: 'photo' | 'video') => {
    if (busy) return;
    setBusy(true); setStatus('');
    try {
      const existing = await ImagePicker.getCameraPermissionsAsync();
      let granted = existing.granted;
      if (!granted) {
        if (existing.canAskAgain === false) {
          setStatus('Camera access is blocked. Open Settings to allow it, then try again.');
          return;
        }
        const req = await ImagePicker.requestCameraPermissionsAsync();
        granted = req.granted;
        if (!granted) { setStatus(req.canAskAgain === false ? 'Camera access is blocked. Open Settings to allow it, then try again.' : 'Camera permission is needed to take a photo or video.'); return; }
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: kind === 'photo' ? ImagePicker.MediaTypeOptions.Images : ImagePicker.MediaTypeOptions.Videos,
        videoMaxDuration: 120,
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      const item = kind === 'photo' ? await savePhoto(scope, result.assets[0].uri) : await saveVideo(scope, result.assets[0].uri);
      owned.current = [item, ...owned.current]; setItems(owned.current);
      setStatus(`${kind === 'photo' ? 'Photo' : 'Video'} saved on this device. Nothing was uploaded or sent.`);
    } catch (error: any) {
      setStatus(error?.message || `Could not capture ${kind}. Please try again.`);
    } finally { setBusy(false); }
  }, [busy, scope]);

  const shareItem = useCallback(async (item: RecordingItem) => {
    try {
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) { setStatus('Sharing is not available on this device.'); return; }
      await Sharing.shareAsync(item.uri);
    } catch { setStatus('Could not open the share sheet. Please try again.'); }
  }, []);

  if (!unlocked) return <PinGate onUnlock={() => setUnlocked(true)} />;

  return (
    <View style={styles.root} testID="evidence-locker-screen">
      <ScreenHeader title="Evidence locker" subtitle="Local recordings, photos & video · no network needed" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <Text testID="evidence-storage-notice" style={styles.note}>Capture only when safe. Everything saved here stays on this device; it is not encrypted by DHARA, tamper-proof, backed up or sent to anyone unless you tap Share. Clearing app data or uninstalling can erase it.</Text>
        <Text testID="evidence-recording-timer" style={styles.timer}>{state.isRecording ? `Recording · ${Math.floor(state.durationMillis / 1000)}s` : 'Ready to record'}</Text>
        <Pressable testID="evidence-record-toggle" disabled={busy} style={styles.button} onPress={state.isRecording ? save : start}>{busy ? <ActivityIndicator color={c.onBrandPrimary} /> : <Text style={styles.buttonText}>{state.isRecording ? 'Stop & save' : 'Start voice recording'}</Text>}</Pressable>
        {state.isRecording && <Pressable testID="evidence-discard" style={styles.secondary} onPress={() => { cancel(); setStatus('Unfinished recording discarded.'); }}><Text style={styles.label}>Discard recording</Text></Pressable>}
        <View style={styles.captureRow}>
          <Pressable testID="evidence-take-photo" disabled={busy || state.isRecording} style={[styles.secondary, styles.captureBtn]} onPress={() => capture('photo')}>
            <Text style={styles.label}>📷 Take photo</Text>
          </Pressable>
          <Pressable testID="evidence-record-video" disabled={busy || state.isRecording} style={[styles.secondary, styles.captureBtn]} onPress={() => capture('video')}>
            <Text style={styles.label}>🎥 Record video (max 2 min)</Text>
          </Pressable>
        </View>
        {!!status && <Text testID="evidence-status" accessibilityLiveRegion="polite" style={styles.note}>{status}</Text>}
        <Text style={styles.heading} testID="evidence-count">Saved items ({items.length})</Text>
        {items.map(item => <View key={item.id} style={styles.secondary} testID={`recording-${item.id}`}>
          <Text style={styles.label}>{item.type === 'photo' ? '📷 Photo' : item.type === 'video' ? '🎥 Video' : '🎙️ Audio'} · {new Date(item.createdAt).toLocaleString()}</Text>
          {item.type === 'photo' && <Image source={{ uri: item.uri }} style={styles.thumb} resizeMode="cover" />}
          {item.type === 'video' && <View style={styles.videoPlaceholder}><Text style={styles.label}>🎥</Text></View>}
          {item.type === 'audio' && (
            <Pressable testID={`recording-play-${item.id}`} disabled={state.isRecording || busy} style={styles.control} onPress={() => play(item)}><Text style={styles.label}>{playing === item.id ? 'Stop playback' : 'Play recording'}</Text></Pressable>
          )}
          {item.type === 'video' && (
            <Text testID={`video-note-${item.id}`} style={[styles.note, { fontSize: 13 }]}>In-app video preview isn&apos;t available yet — use Share to open or send it.</Text>
          )}
          <Pressable testID={`recording-share-${item.id}`} style={styles.control} onPress={() => shareItem(item)}><Text style={styles.label}>Share / Open</Text></Pressable>
          <Pressable testID={`recording-delete-${item.id}`} style={styles.control} onPress={() => deleting === item.id ? remove(item) : setDeleting(item.id)}><Text style={styles.label}>{deleting === item.id ? 'Confirm delete permanently' : 'Delete'}</Text></Pressable>
          {deleting === item.id && <Pressable testID={`recording-keep-${item.id}`} style={styles.control} onPress={() => setDeleting(null)}><Text style={styles.label}>Keep</Text></Pressable>}
        </View>)}
        <Text testID="evidence-other-media-notice" style={styles.note}>Items are not encrypted yet — this is on our roadmap. A PIN now protects this screen itself. Scan a notice remains a separate tool, not evidence storage.</Text>
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background }, content: { padding: 20, gap: 18 },
  note: { fontFamily: theme.fonts.body, fontSize: 15, lineHeight: 23, color: c.muted },
  timer: { fontFamily: theme.fonts.bodyBold, fontSize: 22, color: c.emergencyRed },
  heading: { fontFamily: theme.fonts.displayBold, fontSize: 23, color: c.ink, marginTop: 10 },
  button: { minHeight: 56, backgroundColor: c.navy, borderRadius: 14, padding: 16, alignItems: 'center' },
  buttonText: { fontFamily: theme.fonts.bodyBold, fontSize: 17, color: c.onBrandPrimary },
  secondary: { borderRadius: 14, borderWidth: 1, borderColor: c.lines, padding: 16, backgroundColor: c.surface },
  label: { fontFamily: theme.fonts.bodyBold, fontSize: 16, color: c.navy },
  control: { minHeight: 44, justifyContent: 'center', marginTop: 8 },
  captureRow: { flexDirection: 'row', gap: 12 },
  captureBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 56 },
  thumb: { width: '100%', height: 160, borderRadius: 10, marginTop: 8, backgroundColor: c.lines },
  videoPlaceholder: { width: '100%', height: 100, borderRadius: 10, marginTop: 8, backgroundColor: c.lines, alignItems: 'center', justifyContent: 'center' },
  heading2: { fontFamily: theme.fonts.displayBold, fontSize: 22, color: c.ink },
  note2: { fontFamily: theme.fonts.body, fontSize: 14, lineHeight: 20, color: c.muted, textAlign: 'center', marginTop: 8, marginBottom: 20 },
  pinInput: { fontFamily: theme.fonts.bodyBold, fontSize: 28, letterSpacing: 8, textAlign: 'center', borderWidth: 1, borderColor: c.lines, borderRadius: 12, padding: 14, width: 180, marginBottom: 12, color: c.ink },
});