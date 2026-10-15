import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Platform, AppState, Image, TextInput, Linking } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AudioModule, setAudioModeAsync } from 'expo-audio';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import * as Location from 'expo-location';
import { theme } from '@/src/theme';
import { crossAlert } from '@/src/utils/crossAlert';
import { useAuth } from '@/src/auth';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { useEvidenceRecorder } from '@/src/women/EvidenceRecorderProvider';
import {
  saveRecording, savePhoto, saveVideo, deleteRecording, releaseRecordings,
  discardTemporaryRecording, getDecryptedTempUri, getSegmentedShareZipUri, releaseDecryptedTempUri, type RecordingItem,
  saveSegment, createSegmentedParent, loadSegments, loadVisibleRecordings,
} from '@/src/women/evidenceStore';
import { hasPin, setPin, verifyPin } from '@/src/women/evidenceLock';
import { getManifestEntry, type ManifestEntry, type GpsPoint } from '@/src/women/evidenceManifest';
import { anchorItem, backupItem } from '@/src/women/evidenceBackup';
import { fetchFlags } from '@/src/women/api';
import { exportCertificate } from '@/src/women/evidenceCertificate';
import { screenPlayer } from '@/src/media/screenPlayer';
import type { TtsPlayer } from '@/src/voice/tts';
import {
  isSegmentedRecordingEnabled, SEGMENT_TARGET_MS,
  createSession, commitSegment, finalizeSession, interruptSession,
  getRecoverableSessions, recoverSession, deleteSession,
  computeSessionElapsedMs,
  type EvidenceSession,
} from '@/src/women/evidenceSession';

const c = theme.colors;

// ── Inline video preview (S-B5) — mounted only while a video is being
// previewed, so useVideoPlayer's lifecycle stays tied to one item at a time. ──
function InlineVideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, p => { p.play(); });
  return <VideoView player={player} style={styles.videoPreview} nativeControls contentFit="contain" testID="evidence-video-preview" />;
}

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
  // Item G: Get recorder from EvidenceRecorderProvider (survives navigation).
  const { recorder, recorderState: state, claimForLocker, releaseLockerClaim, recordingOwner, stopTriggerRecording } = useEvidenceRecorder();
  const [items, setItems] = useState<RecordingItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [photoUris, setPhotoUris] = useState<Record<string, string>>({});
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [videoPreview, setVideoPreview] = useState<{ id: string; uri: string; wasDecrypted: boolean } | null>(null);
  const [manifestMap, setManifestMap] = useState<Record<string, ManifestEntry | null>>({});
  const [anchoring, setAnchoring] = useState<string | null>(null);
  const [backingUp, setBackingUp] = useState<Record<string, number>>({});
  // E1: Anchor/Backup buttons only render when evidence_vault_enabled is on.
  const [vaultEnabled, setVaultEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchFlags().then(f => { if (alive) setVaultEnabled(!!(f as any)?.evidence_vault_enabled); })
      .catch(() => { if (alive) setVaultEnabled(false); });
    return () => { alive = false; };
  }, []);
  const player = useRef<TtsPlayer | null>(null);
  const epoch = useRef(0);
  const working = useRef(false);
  const active = useRef(false);
  // P0-B: segmented recording refs
  const segmentedEnabled = useRef(isSegmentedRecordingEnabled());
  const sessionRef = useRef<EvidenceSession | null>(null);
  const segTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const segCountRef = useRef(0);
  const segStartTimeRef = useRef(0);
  const sessionStartTimeRef = useRef(0); // Fix (S1-4): session-level start time, for the on-screen timer
  const segDurationsRef = useRef<number[]>([]); // Fix (S1-3): measured per-segment durations, summed for the total
  const [segmentCount, setSegmentCount] = useState(0);
  const [recoverable, setRecoverable] = useState<EvidenceSession[]>([]);
  const owned = useRef<RecordingItem[]>([]);
  const photoUrisRef = useRef<Record<string, string>>({});
  const videoPreviewRef = useRef<typeof videoPreview>(null);
  const playingTempUri = useRef<{ uri: string; wasDecrypted: boolean } | null>(null);
  const playingIdRef = useRef<string | null>(null); // Fix (S1-1): synchronous id, read inside playNext instead of the stale `playing` state closure
  useEffect(() => { photoUrisRef.current = photoUris; }, [photoUris]);
  useEffect(() => { videoPreviewRef.current = videoPreview; }, [videoPreview]);
  const stopPlayer = useCallback(() => {
    player.current?.remove(); player.current = null; setPlaying(null);
    playingIdRef.current = null; // Fix (S1-1): clear the synchronous id alongside the state setter
    if (playingTempUri.current) { releaseDecryptedTempUri(playingTempUri.current.uri, playingTempUri.current.wasDecrypted); playingTempUri.current = null; }
  }, []);
  const closeVideoPreview = useCallback(() => {
    if (videoPreviewRef.current) releaseDecryptedTempUri(videoPreviewRef.current.uri, videoPreviewRef.current.wasDecrypted);
    setVideoPreview(null);
  }, []);
  const cancel = useCallback(() => {
    epoch.current++;
    stopPlayer();
    // P0-B: If a segmented session is running, interrupt it (committed segments survive).
    if (sessionRef.current && segmentedEnabled.current) {
      const sid = sessionRef.current.sessionId;
      sessionRef.current = null;
      if (segTimerRef.current) { clearTimeout(segTimerRef.current); segTimerRef.current = null; }
      void interruptSession(scope, sid).catch(() => {});
    }
    if (active.current) {
      active.current = false;
      releaseLockerClaim(); // release provider ownership
      void recorder.stop().then(() => discardTemporaryRecording(recorder.uri)).catch(() => {});
      // Only reset audio mode if WE started recording (not a trigger recording).
      if (Platform.OS !== 'web') void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    } else if (recordingOwner === 'trigger') {
      // Fix C: Discard / screen-unmount / app-backgrounded must also release
      // a stuck trigger-owned claim, so ownership returns to null and the
      // Locker can start its own recording again afterwards.
      void stopTriggerRecording();
    }
  }, [recorder, stopPlayer, scope, releaseLockerClaim, recordingOwner, stopTriggerRecording]);
  useFocusEffect(useCallback(() => {
    let alive = true;
    // P0-B: Load only non-segment items for the top-level list.
    loadVisibleRecordings(scope).then(async rows => {
      if (!alive) { releaseRecordings(rows); return; }
      owned.current = rows; setItems(rows);
      // S-B5: load each item's local hash-chain/anchor/backup status (local
      // read only, no network) so the vault buttons/badges render correctly.
      const manifestEntries = await Promise.all(rows.map(r => getManifestEntry(scope, r.id).catch(() => null)));
      if (!alive) return;
      const mMap: Record<string, ManifestEntry | null> = {};
      rows.forEach((r, i) => { mMap[r.id] = manifestEntries[i]; });
      setManifestMap(mMap);
      // S-B5: decrypt photo thumbnails eagerly (small files, immediate visual
      // feedback) — audio/video stay decrypt-on-demand (Play / Preview tap).
      const photoRows = rows.filter(r => r.type === 'photo');
      const decrypted = await Promise.all(photoRows.map(async r => {
        try { return [r.id, await getDecryptedTempUri(scope, r)] as const; } catch { return null; }
      }));
      if (!alive) { decrypted.forEach(entry => { if (entry) releaseDecryptedTempUri(entry[1], true); }); return; }
      const map: Record<string, string> = {};
      decrypted.forEach(entry => { if (entry) map[entry[0]] = entry[1]; });
      setPhotoUris(map);
    }).catch(() => setStatus('Saved recordings could not load. Please reopen this screen.'));
    // P0-B: Check for recoverable interrupted sessions.
    if (segmentedEnabled.current) {
      getRecoverableSessions(scope).then(sessions => {
        if (alive) setRecoverable(sessions);
      }).catch(() => {});
    }
    return () => {
      alive = false; cancel(); releaseRecordings(owned.current);
      Object.entries(photoUrisRef.current).forEach(([id, uri]) => {
        const row = owned.current.find(r => r.id === id);
        releaseDecryptedTempUri(uri, !!row?.iv);
      });
      photoUrisRef.current = {}; setPhotoUris({});
      closeVideoPreview();
      owned.current = [];
    };
  }, [scope, cancel, closeVideoPreview]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', value => {
      if (value !== 'active' && active.current) {
        // P0-B: When segmented recording is active, interrupt preserves committed segments.
        if (sessionRef.current && segmentedEnabled.current) {
          setStatus(`Recording interrupted. ${segCountRef.current} segment(s) were saved and can be recovered.`);
        } else {
          setStatus('Recording stopped. Unfinished audio is not saved. Keep this screen open and use Stop & save.');
        }
        cancel();
      }
    });
    return () => sub.remove();
  }, [cancel]);
  // ── P0-B: Segment cycling ─────────────────────────────────────────────────
  // commitCurrentSegment: stop recorder → encrypt+persist the segment →
  // restart recording for the next segment. Runs on a ~SEGMENT_TARGET_MS timer.
  const commitCurrentSegment = useCallback(async () => {
    if (!active.current || !sessionRef.current) return;
    const session = sessionRef.current;
    const segIdx = segCountRef.current;
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (uri) {
        const segItem = await saveSegment(scope, uri, session.sessionId);
        discardTemporaryRecording(uri);
        const durationMs = Date.now() - segStartTimeRef.current; // Fix (S1-3): measured, not the fixed cycle target
        await commitSegment(scope, session.sessionId, {
          segId: segItem.id, index: segIdx, itemId: segItem.id,
          durationMs, committedAt: new Date().toISOString(),
        });
        segDurationsRef.current.push(durationMs);
        segCountRef.current = segIdx + 1;
        setSegmentCount(segIdx + 1);
      }
    } catch (e: any) {
      console.warn('[P0-B] segment commit error:', e?.message);
      // Don't fail the whole session — just skip this segment and continue
    }
    // Restart recording for the next segment (if still active)
    if (!active.current || !sessionRef.current) return;
    try {
      await recorder.prepareToRecordAsync();
      recorder.record();
      segStartTimeRef.current = Date.now();
      segTimerRef.current = setTimeout(() => { void commitCurrentSegment(); }, SEGMENT_TARGET_MS);
    } catch (e: any) {
      console.warn('[P0-B] segment restart error:', e?.message);
      // Recording can't continue — finalize what we have
      active.current = false;
      setStatus(`Recording stopped after ${segCountRef.current} segment(s). Saved segments can be recovered.`);
    }
  }, [recorder, scope]);

  const start = useCallback(async () => {
    if (working.current || active.current) return;
    working.current = true; setBusy(true); setStatus(''); stopPlayer();
    const id = ++epoch.current;
    try {
      // Check current status first — if already granted, skip the request so
      // the system dialog never appears and no AppState 'background' event fires.
      let permission = await AudioModule.getRecordingPermissionsAsync();
      if (!permission.granted) {
        permission = await AudioModule.requestRecordingPermissionsAsync();
      }
      if (!permission.granted) throw new Error('Microphone permission is needed. Allow it in your device or site settings, then try again.');
      if (id !== epoch.current) return;
      // Fix C: claim BEFORE touching the native recorder. claimForLocker()
      // returns false only when a trigger-owned recording already holds it —
      // calling prepareToRecordAsync() in that case is what previously threw
      // the raw native "AudioRecorder has already been prepared" error.
      if (!claimForLocker()) {
        setStatus('A recording is already running. Stop it first.');
        crossAlert(
          'Recording already running',
          'A recording is already running. Stop it first.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Stop and save',
              onPress: () => {
                void stopTriggerRecording().then(() => setStatus('Stopped. You can start recording again.'));
              },
            },
          ],
        );
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: false });
      await recorder.prepareToRecordAsync();
      if (id !== epoch.current) {
        if (Platform.OS === 'web') recorder.record();
        await recorder.stop(); discardTemporaryRecording(recorder.uri);
        releaseLockerClaim(); // Fix C: don't leak the claim on an abandoned/stale start
        return;
      }
      claimForLocker(); // claim provider ownership before recording starts
      recorder.record(); active.current = true;
      sessionStartTimeRef.current = Date.now(); // Fix (S1-4): session-level start, used by the timer display
      // P0-B: If segmented recording is enabled, start the segment cycle.
      if (segmentedEnabled.current) {
        const session = await createSession(scope);
        sessionRef.current = session;
        segCountRef.current = 0;
        segDurationsRef.current = []; // Fix (S1-3): reset the measured-duration accumulator
        setSegmentCount(0);
        segStartTimeRef.current = Date.now();
        segTimerRef.current = setTimeout(() => { void commitCurrentSegment(); }, SEGMENT_TARGET_MS);
        setStatus('Recording in segments. Each ~5s chunk is automatically saved to protect your evidence.');
      } else {
        setStatus('Recording on this device. Tap Stop & save before leaving this screen.');
      }
    } catch (error: any) {
      if (id === epoch.current) setStatus(error.message || 'Recording could not start. Please try again.');
      releaseLockerClaim(); // Fix C: never leak our own claim on a start failure
    }
    finally { working.current = false; setBusy(false); }
  }, [recorder, stopPlayer, scope, commitCurrentSegment, claimForLocker, releaseLockerClaim, stopTriggerRecording]);
  const started = useRef(false);
  useEffect(() => {
    if (params.record === '1' && !started.current) { started.current = true; router.setParams({ record: '' }); void start(); }
  }, [params.record, router, start]);
  const save = async () => {
    if (working.current) return;
    if (!active.current) {
      // Fix C: a trigger-owned recording has no locker-side session state in
      // THIS screen instance (active.current is only set by this screen's
      // own start()) — the old guard silently did nothing here. Stop it
      // explicitly; never try to save segments for a trigger recording,
      // that remains a separate trigger-recording step.
      if (recordingOwner === 'trigger') {
        working.current = true; setBusy(true);
        try { await stopTriggerRecording(); setStatus('Stopped. You can start recording again.'); }
        finally { working.current = false; setBusy(false); }
      }
      return;
    }
    working.current = true; setBusy(true); active.current = false;
    // P0-B: Stop the segment timer
    if (segTimerRef.current) { clearTimeout(segTimerRef.current); segTimerRef.current = null; }
    try {
      await recorder.stop();
      if (segmentedEnabled.current && sessionRef.current) {
        // ── P0-B: Segmented save ─────────────────────────────────────────
        const session = sessionRef.current;
        sessionRef.current = null;
        // Commit the final partial segment (whatever was recorded since the last commit)
        const uri = recorder.uri;
        if (uri) {
          try {
            const segItem = await saveSegment(scope, uri, session.sessionId);
            discardTemporaryRecording(uri);
            const elapsed = Date.now() - segStartTimeRef.current;
            await commitSegment(scope, session.sessionId, {
              segId: segItem.id, index: segCountRef.current, itemId: segItem.id,
              durationMs: elapsed, committedAt: new Date().toISOString(),
            });
            segDurationsRef.current.push(elapsed);
            segCountRef.current++;
          } catch { /* final segment lost, committed segments remain */ }
        }
        // Create the v2 parent item — total is the sum of measured segment durations (Fix S1-3)
        const totalDuration = segDurationsRef.current.reduce((sum, d) => sum + d, 0);
        const parent = await createSegmentedParent(scope, session.sessionId, segCountRef.current, totalDuration);
        await finalizeSession(scope, session.sessionId, parent.id);
        // Refresh the list
        const visible = await loadVisibleRecordings(scope);
        owned.current = visible; setItems(visible);
        setSegmentCount(0);
        setStatus(`Saved ${segCountRef.current} segment(s) on this device. Nothing was uploaded or sent.`);
      } else {
        // ── V1: Legacy single-file save ───────────────────────────────────
        if (!recorder.uri) throw new Error('No audio was captured. Please record again.');
        const item = await saveRecording(scope, recorder.uri);
        discardTemporaryRecording(recorder.uri);
        owned.current = [item, ...owned.current]; setItems(owned.current);
        setStatus('Saved on this device. Nothing was uploaded or sent.');
      }
    } catch (error: any) { setStatus(error.message || 'Recording could not be saved.'); }
    finally { 
      working.current = false; setBusy(false); 
      releaseLockerClaim(); // release provider ownership after save
      if (Platform.OS !== 'web') void setAudioModeAsync({ allowsRecording: false }).catch(() => {}); 
    }
  };
  const play = useCallback(async (item: RecordingItem) => {
    const wasPlaying = playing === item.id;
    stopPlayer(); if (wasPlaying) return;
    try {
      // P0-B: v2 segmented items — play segments in sequence
      if (item.recording_format_version === 2 && item.session_id) {
        const segs = await loadSegments(scope, item.session_id);
        if (segs.length === 0) { setStatus('No segments found for this recording.'); return; }
        playingIdRef.current = item.id; // Fix (S1-1): set synchronously — `playing` state isn't committed yet when playNext(0) runs
        setPlaying(item.id);
        const playNext = async (idx: number) => {
          if (idx >= segs.length || playingIdRef.current !== item.id) { stopPlayer(); return; }
          const seg = segs[idx];
          const tempUri = await getDecryptedTempUri(scope, seg);
          playingTempUri.current = { uri: tempUri, wasDecrypted: !!seg.iv };
          const sound = screenPlayer(tempUri);
          player.current = sound;
          sound.onFinish(() => {
            releaseDecryptedTempUri(tempUri, !!seg.iv);
            playingTempUri.current = null;
            player.current = null;
            void playNext(idx + 1);
          });
          await sound.play();
        };
        void playNext(0);
        return;
      }
      // V1: single-file playback
      const tempUri = await getDecryptedTempUri(scope, item);
      playingTempUri.current = { uri: tempUri, wasDecrypted: !!item.iv };
      const sound = screenPlayer(tempUri); player.current = sound; setPlaying(item.id);
      sound.onFinish(stopPlayer);
      await sound.play();
    } catch { stopPlayer(); setStatus('Playback could not start. Tap Play again or check device audio.'); }
  }, [playing, stopPlayer, scope]);
  const previewVideo = useCallback(async (item: RecordingItem) => {
    if (videoPreview?.id === item.id) { closeVideoPreview(); return; }
    if (videoPreview) closeVideoPreview();
    setPreviewLoading(item.id);
    try {
      const uri = await getDecryptedTempUri(scope, item);
      setVideoPreview({ id: item.id, uri, wasDecrypted: !!item.iv });
    } catch {
      setStatus('Could not open this video. Please try again.');
    } finally { setPreviewLoading(null); }
  }, [videoPreview, scope, closeVideoPreview]);
  const remove = useCallback(async (item: RecordingItem) => {
    try {
      stopPlayer();
      if (videoPreview?.id === item.id) closeVideoPreview();
      if (photoUris[item.id]) { releaseDecryptedTempUri(photoUris[item.id], !!item.iv); setPhotoUris(prev => { const next = { ...prev }; delete next[item.id]; return next; }); }
      await deleteRecording(scope, item);
      // P0-B: Also clean up the session record if v2
      if (item.recording_format_version === 2 && item.session_id) {
        await deleteSession(scope, item.session_id).catch(() => {});
      }
      owned.current = owned.current.filter(row => row.id !== item.id); setItems(owned.current); setDeleting(null); setStatus('Recording deleted from this device.');
    } catch { setStatus('Could not delete this recording. Please try again.'); }
  }, [scope, stopPlayer, videoPreview, closeVideoPreview, photoUris]);

  // ── P0-B: Recover an interrupted session ──────────────────────────────────
  const handleRecover = useCallback(async (session: EvidenceSession) => {
    setBusy(true);
    try {
      // Fix (S1-3): total is the sum of each committed segment's measured duration
      const totalDuration = session.segments.reduce((sum, seg) => sum + seg.durationMs, 0);
      const parent = await createSegmentedParent(scope, session.sessionId, session.segments.length, totalDuration);
      await recoverSession(scope, session.sessionId, parent.id);
      const visible = await loadVisibleRecordings(scope);
      owned.current = visible; setItems(visible);
      setRecoverable(prev => prev.filter(s => s.sessionId !== session.sessionId));
      setStatus(`Recovered ${session.segments.length} segment(s) from an interrupted recording.`);
    } catch { setStatus('Could not recover this session. Please try again.'); }
    finally { setBusy(false); }
  }, [scope]);

  const dismissRecoverable = useCallback(async (session: EvidenceSession) => {
    await deleteSession(scope, session.sessionId).catch(() => {});
    // Also delete the segment files
    try {
      const segs = await loadSegments(scope, session.sessionId);
      for (const seg of segs) await deleteRecording(scope, seg).catch(() => {});
    } catch {}
    setRecoverable(prev => prev.filter(s => s.sessionId !== session.sessionId));
    setStatus('Interrupted session discarded.');
  }, [scope]);

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
      if (kind === 'photo') {
        // Decrypt immediately so the new thumbnail shows up right away.
        try { const uri = await getDecryptedTempUri(scope, item); setPhotoUris(prev => ({ ...prev, [item.id]: uri })); } catch { /* thumbnail just won't render; item is still saved */ }
      }
      setStatus(`${kind === 'photo' ? 'Photo' : 'Video'} saved on this device. Nothing was uploaded or sent.`);
    } catch (error: any) {
      setStatus(error?.message || `Could not capture ${kind}. Please try again.`);
    } finally { setBusy(false); }
  }, [busy, scope]);

  const shareItem = useCallback(async (item: RecordingItem) => {
    try {
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) { setStatus('Sharing is not available on this device.'); return; }
      if (item.recording_format_version === 2 && item.session_id) {
        // E2: a v2 parent has no file of its own (uri: '') — build one
        // temporary .zip (part-01, part-02, ... in order) from its
        // decrypted segments, since independent .m4a containers don't
        // reliably concatenate into one playable file.
        const zipUri = await getSegmentedShareZipUri(scope, item);
        try {
          const confirmed = await new Promise<boolean>(resolve => {
            crossAlert(
              'Share this recording?',
              `Recording is shared in parts. Play them in order.\n\nThis will share ${item.segment_count || 'all'} segment(s) as a .zip file.`,
              [
                { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                { text: 'Share', onPress: () => resolve(true) },
              ],
            );
          });
          if (confirmed) await Sharing.shareAsync(zipUri, { mimeType: 'application/zip' });
        } finally {
          releaseDecryptedTempUri(zipUri, true);
        }
        return;
      }
      // Single-file path — unchanged.
      const tempUri = await getDecryptedTempUri(scope, item);
      try { await Sharing.shareAsync(tempUri); }
      finally { releaseDecryptedTempUri(tempUri, !!item.iv); }
    } catch { setStatus('Could not open the share sheet. Please try again.'); }
  }, [scope]);

  // ── S-B5: Evidence Vault — optional anchor (tamper-evident timestamp) +
  // encrypted cloud backup + Section 63 BSA draft certificate. Local
  // capture/encryption above never needs any of this; these require a
  // network call only at the moment the citizen taps the button. ──────────
  const doAnchor = useCallback(async (item: RecordingItem, gps: GpsPoint | null) => {
    setAnchoring(item.id);
    try {
      const { entry } = await anchorItem(scope, item, gps);
      setManifestMap(prev => ({ ...prev, [item.id]: entry }));
      setStatus('Evidence anchored — a tamper-evident timestamp was saved.');
    } catch (e: any) {
      setStatus(e?.message || 'Could not anchor this item. Please try again.');
    } finally {
      setAnchoring(null);
    }
  }, [scope]);

  const requestLocationThenAnchor = useCallback(async (item: RecordingItem) => {
    try {
      const existing = await Location.getForegroundPermissionsAsync();
      let granted = existing.granted;
      if (!granted) {
        if (existing.canAskAgain === false) {
          crossAlert(
            'Location is blocked',
            'Open Settings to allow location, or continue without it.',
            [
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
              { text: 'Continue without location', onPress: () => doAnchor(item, null) },
            ],
          );
          return;
        }
        const req = await Location.requestForegroundPermissionsAsync();
        granted = req.granted;
      }
      if (!granted) { await doAnchor(item, null); return; }
      const point = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await doAnchor(item, { lat: point.coords.latitude, lng: point.coords.longitude, accuracy: point.coords.accuracy ?? undefined });
    } catch {
      await doAnchor(item, null);
    }
  }, [doAnchor]);

  const handleAnchor = useCallback((item: RecordingItem) => {
    crossAlert(
      'Attach your location?',
      'This helps prove where this evidence was captured. Optional — you can skip it and still anchor the timestamp.',
      [
        { text: 'Skip', onPress: () => doAnchor(item, null) },
        { text: 'Attach location', onPress: () => requestLocationThenAnchor(item) },
      ],
    );
  }, [doAnchor, requestLocationThenAnchor]);

  const handleBackup = useCallback(async (item: RecordingItem) => {
    setBackingUp(prev => ({ ...prev, [item.id]: 0 }));
    try {
      const entry = await backupItem(scope, item, fraction => setBackingUp(prev => ({ ...prev, [item.id]: fraction })));
      setManifestMap(prev => ({ ...prev, [item.id]: entry }));
      setStatus('Backed up to secure cloud storage.');
    } catch (e: any) {
      setStatus(e?.message || 'Could not back up this item. Please try again.');
    } finally {
      setBackingUp(prev => { const next = { ...prev }; delete next[item.id]; return next; });
    }
  }, [scope]);

  const handleCertificate = useCallback(async (item: RecordingItem) => {
    const entry = manifestMap[item.id];
    if (!entry?.anchor) { setStatus('Anchor this item first to generate a certificate.'); return; }
    try { await exportCertificate(item, entry); }
    catch { setStatus('Could not export the certificate. Please try again.'); }
  }, [manifestMap]);

  if (!unlocked) return <PinGate onUnlock={() => setUnlocked(true)} />;

  return (
    <View style={styles.root} testID="evidence-locker-screen">
      <ScreenHeader title="Evidence locker" subtitle="Local recordings, photos & video · no network needed" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <Text testID="evidence-storage-notice" style={styles.note}>Capture only when safe. Everything saved here is encrypted on this device and protected by your PIN; it is not backed up or sent to anyone unless you tap Share, Anchor or Back up. Clearing app data or uninstalling can erase it.</Text>
        <Text testID="evidence-recording-timer" style={styles.timer}>
          {state.isRecording
            ? segmentedEnabled.current
              ? `Recording · ${Math.floor(computeSessionElapsedMs(Date.now(), sessionStartTimeRef.current) / 1000)}s · ${segmentCount} segment(s) saved`
              : `Recording · ${Math.floor(state.durationMillis / 1000)}s`
            : 'Ready to record'}
        </Text>
        <Pressable testID="evidence-record-toggle" disabled={busy} style={styles.button} onPress={state.isRecording ? save : start}>{busy ? <ActivityIndicator color={c.onBrandPrimary} /> : <Text style={styles.buttonText}>{state.isRecording ? 'Stop & save' : 'Start voice recording'}</Text>}</Pressable>
        {state.isRecording && <Pressable testID="evidence-discard" style={styles.secondary} onPress={() => { cancel(); setStatus(segmentedEnabled.current ? `Discarded. ${segCountRef.current} committed segment(s) can still be recovered.` : 'Unfinished recording discarded.'); }}><Text style={styles.label}>Discard recording</Text></Pressable>}
        {/* P0-B: Recovery banner for interrupted sessions */}
        {recoverable.length > 0 && recoverable.map(ses => (
          <View key={ses.sessionId} style={[styles.secondary, { borderColor: c.gold }]} testID={`recovery-${ses.sessionId}`}>
            <Text style={styles.label}>Interrupted recording found — {ses.segments.length} segment(s) saved</Text>
            <Text style={styles.note}>Started {new Date(ses.startedAt).toLocaleString()}</Text>
            <View style={styles.captureRow}>
              <Pressable style={[styles.control, { flex: 1 }]} onPress={() => handleRecover(ses)} disabled={busy}>
                <Text style={[styles.label, { color: c.verifiedGreen }]}>Recover</Text>
              </Pressable>
              <Pressable style={[styles.control, { flex: 1 }]} onPress={() => dismissRecoverable(ses)} disabled={busy}>
                <Text style={[styles.label, { color: c.emergencyRed }]}>Discard</Text>
              </Pressable>
            </View>
          </View>
        ))}
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
          <Text style={styles.label}>
            {item.type === 'photo' ? '📷 Photo' : item.type === 'video' ? '🎥 Video' : '🎙️ Audio'}
            {item.recording_format_version === 2 ? ` (${item.segment_count ?? 0} segments)` : ''}
            {' · '}{new Date(item.createdAt).toLocaleString()}
          </Text>
          {item.type === 'photo' && (
            photoUris[item.id]
              ? <Image source={{ uri: photoUris[item.id] }} style={styles.thumb} resizeMode="cover" />
              : <View style={styles.videoPlaceholder}><ActivityIndicator color={c.navy} /></View>
          )}
          {item.type === 'video' && videoPreview?.id === item.id && (
            <InlineVideoPreview uri={videoPreview.uri} />
          )}
          {item.type === 'video' && videoPreview?.id !== item.id && (
            <Pressable
              testID={`recording-preview-video-${item.id}`}
              disabled={previewLoading === item.id}
              style={styles.videoPlaceholder}
              onPress={() => previewVideo(item)}
            >
              {previewLoading === item.id
                ? <ActivityIndicator color={c.navy} />
                : <Text style={styles.label}>▶️ Tap to preview</Text>}
            </Pressable>
          )}
          {item.type === 'audio' && (
            <Pressable testID={`recording-play-${item.id}`} disabled={state.isRecording || busy} style={styles.control} onPress={() => play(item)}><Text style={styles.label}>{playing === item.id ? 'Stop playback' : 'Play recording'}</Text></Pressable>
          )}
          {item.type === 'video' && videoPreview?.id === item.id && (
            <Pressable testID={`recording-close-preview-${item.id}`} style={styles.control} onPress={closeVideoPreview}><Text style={styles.label}>Close preview</Text></Pressable>
          )}
          <Pressable testID={`recording-share-${item.id}`} style={styles.control} onPress={() => shareItem(item)}><Text style={styles.label}>Share / Open</Text></Pressable>
          <View style={styles.vaultRow}>
            <Text testID={`recording-vault-status-${item.id}`} style={styles.note}>
              {manifestMap[item.id]?.anchor
                ? `🔒 Anchored · ${new Date(manifestMap[item.id]!.anchor!.serverTime).toLocaleString()}`
                : 'Not anchored yet · timestamp proof is optional'}
              {manifestMap[item.id]?.backup ? ' · ☁️ Backed up' : ''}
            </Text>
            {vaultEnabled && !manifestMap[item.id]?.anchor && (
              <Pressable testID={`recording-anchor-${item.id}`} disabled={anchoring === item.id} style={styles.control} onPress={() => handleAnchor(item)}>
                {anchoring === item.id ? <ActivityIndicator color={c.navy} /> : <Text style={styles.label}>Anchor & verify (needs signal)</Text>}
              </Pressable>
            )}
            {vaultEnabled && !!manifestMap[item.id]?.anchor && !manifestMap[item.id]?.backup && (
              <Pressable testID={`recording-backup-${item.id}`} disabled={item.id in backingUp} style={styles.control} onPress={() => handleBackup(item)}>
                <Text style={styles.label}>{item.id in backingUp ? `Backing up… ${Math.round((backingUp[item.id] || 0) * 100)}%` : 'Back up to secure cloud'}</Text>
              </Pressable>
            )}
            {!!manifestMap[item.id]?.anchor && (
              <Pressable testID={`recording-certificate-${item.id}`} style={styles.control} onPress={() => handleCertificate(item)}>
                <Text style={styles.label}>Export certificate (draft)</Text>
              </Pressable>
            )}
          </View>
          <Pressable testID={`recording-delete-${item.id}`} style={styles.control} onPress={() => deleting === item.id ? remove(item) : setDeleting(item.id)}><Text style={styles.label}>{deleting === item.id ? 'Confirm delete permanently' : 'Delete'}</Text></Pressable>
          {deleting === item.id && <Pressable testID={`recording-keep-${item.id}`} style={styles.control} onPress={() => setDeleting(null)}><Text style={styles.label}>Keep</Text></Pressable>}
        </View>)}
        <Text testID="evidence-other-media-notice" style={styles.note}>Items are encrypted on this device (AES-256) and only decrypted briefly to preview, play or share. A PIN protects this screen itself. Scan a notice remains a separate tool, not evidence storage.</Text>
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
  vaultRow: { marginTop: 4, gap: 6, borderTopWidth: 1, borderTopColor: c.lines, paddingTop: 8 },
  captureRow: { flexDirection: 'row', gap: 12 },
  captureBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 56 },
  thumb: { width: '100%', height: 160, borderRadius: 10, marginTop: 8, backgroundColor: c.lines },
  videoPlaceholder: { width: '100%', height: 100, borderRadius: 10, marginTop: 8, backgroundColor: c.lines, alignItems: 'center', justifyContent: 'center' },
  videoPreview: { width: '100%', height: 200, borderRadius: 10, marginTop: 8, backgroundColor: '#000' },
  heading2: { fontFamily: theme.fonts.displayBold, fontSize: 22, color: c.ink },
  note2: { fontFamily: theme.fonts.body, fontSize: 14, lineHeight: 20, color: c.muted, textAlign: 'center', marginTop: 8, marginBottom: 20 },
  pinInput: { fontFamily: theme.fonts.bodyBold, fontSize: 28, letterSpacing: 8, textAlign: 'center', borderWidth: 1, borderColor: c.lines, borderRadius: 12, padding: 14, width: 180, marginBottom: 12, color: c.ink },
});