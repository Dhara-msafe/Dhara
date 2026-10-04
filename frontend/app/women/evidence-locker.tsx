import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Platform, AppState } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { saveRecording, loadRecordings, deleteRecording, releaseRecordings, discardTemporaryRecording, type RecordingItem } from '@/src/women/evidenceStore';
import { screenPlayer } from '@/src/media/screenPlayer';
import type { TtsPlayer } from '@/src/voice/tts';

const c = theme.colors;
export default function EvidenceLocker() {
  const router = useRouter();
  const params = useLocalSearchParams<{ record?: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const scope = user?.id || 'device';
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
  return (
    <View style={styles.root} testID="evidence-locker-screen">
      <ScreenHeader title="Evidence locker" subtitle="Local voice recordings · no network needed" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <Text testID="evidence-storage-notice" style={styles.note}>Record only when safe. Saved audio stays on this device; it is not encrypted by DHARA, tamper-proof, backed up or sent to anyone. Clearing app/browser data or uninstalling can erase it. Keep this screen open; unfinished recordings are discarded when you leave.</Text>
        <Text testID="evidence-recording-timer" style={styles.timer}>{state.isRecording ? `Recording · ${Math.floor(state.durationMillis / 1000)}s` : 'Ready to record'}</Text>
        <Pressable testID="evidence-record-toggle" disabled={busy} style={styles.button} onPress={state.isRecording ? save : start}>{busy ? <ActivityIndicator color={c.onBrandPrimary} /> : <Text style={styles.buttonText}>{state.isRecording ? 'Stop & save' : 'Start recording'}</Text>}</Pressable>
        {state.isRecording && <Pressable testID="evidence-discard" style={styles.secondary} onPress={() => { cancel(); setStatus('Unfinished recording discarded.'); }}><Text style={styles.label}>Discard recording</Text></Pressable>}
        {!!status && <Text testID="evidence-status" accessibilityLiveRegion="polite" style={styles.note}>{status}</Text>}
        <Text style={styles.heading} testID="evidence-count">Saved recordings ({items.length})</Text>
        {items.map(item => <View key={item.id} style={styles.secondary} testID={`recording-${item.id}`}>
          <Text style={styles.label}>{new Date(item.createdAt).toLocaleString()}</Text>
          <Pressable testID={`recording-play-${item.id}`} disabled={state.isRecording || busy} style={styles.control} onPress={() => play(item)}><Text style={styles.label}>{playing === item.id ? 'Stop playback' : 'Play recording'}</Text></Pressable>
          <Pressable testID={`recording-delete-${item.id}`} style={styles.control} onPress={() => deleting === item.id ? remove(item) : setDeleting(item.id)}><Text style={styles.label}>{deleting === item.id ? 'Confirm delete permanently' : 'Delete'}</Text></Pressable>
          {deleting === item.id && <Pressable testID={`recording-keep-${item.id}`} style={styles.control} onPress={() => setDeleting(null)}><Text style={styles.label}>Keep recording</Text></Pressable>}
        </View>)}
        <Text testID="evidence-other-media-notice" style={styles.note}>Photo/document sealing and encrypted evidence packages are not available yet. Scan a notice remains a separate tool, not evidence storage.</Text>
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
});