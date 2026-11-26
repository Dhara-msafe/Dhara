import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Platform, AppState, Image, TextInput, Linking, Modal } from 'react-native';
import { useFocusEffect, useRouter, useNavigation } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AudioModule, setAudioModeAsync } from 'expo-audio';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import * as Location from 'expo-location';
// EL-054: Paths / EfsFile were previously imported here for the inline cache
// sweep; that logic now lives in sweepOrphanedEvidenceTempFiles() (evidenceStore.ts).
// The import is no longer needed in this file.
import { crossAlert } from '@/src/utils/crossAlert';
import { consumeEvidenceAutoRecord } from '@/src/women/evidenceAutoRecord';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { useEvidenceRecorder } from '@/src/women/EvidenceRecorderProvider';
import {
  saveRecording, savePhoto, saveVideo, deleteRecording, releaseRecordings,
  discardTemporaryRecording, getDecryptedTempUri, getSegmentedShareZipUri, releaseDecryptedTempUri, sweepOrphanedEvidenceTempFiles, type RecordingItem,
  saveSegment, createSegmentedParent, loadSegments, loadVisibleRecordings,
  pendingTempFileExists,
} from '@/src/women/evidenceStore';
import { hasPin, setPin, verifyPin, getLockoutRemainingMs, changePin } from '@/src/women/evidenceLock';
import { getManifestEntry, markManifestDeleted, clearBackupInfo, type ManifestEntry, type GpsPoint } from '@/src/women/evidenceManifest';
import { anchorItem, backupItem, deleteBackupCloud } from '@/src/women/evidenceBackup';
import { fetchFlags } from '@/src/women/api';
import { markPendingTemp, clearPendingTemp, listPendingTemps } from '@/src/women/evidencePendingTemp';
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
// NF-UI-REV-08 (Group G, DHARA UI Revision v2.2.1): presentation-only
// rollback flag + visible keyboard-focus ring + missing a11y labels only.
// Zero changes to PIN/lockout/recording/encryption logic — every existing
// `disabled`/`pointerEvents` guard below is left untouched.
import { UI_REVISION_V1 } from '@/src/designRevision';
import { focusRingStyle } from '@/src/a11yFocus';
import { PIN_NO_AUTOFILL, pinFromBox } from '@/src/women/pinInput';
import { UI_V22_P7 } from '@/src/uiV22Flags';
import { RECORD_NOTICES, type RecordNotice } from '@/src/recordCopy';

const EVIDENCE_ACTIONS_ENABLED = process.env.EXPO_PUBLIC_EVIDENCE_ACTIONS === 'true';

const c = theme.colors;

// ── Inline video preview (S-B5) — mounted only while a video is being
// previewed, so useVideoPlayer's lifecycle stays tied to one item at a time. ──
function InlineVideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, p => { p.play(); });
  return <VideoView player={player} style={styles.videoPreview} nativeControls contentFit="contain" testID="evidence-video-preview" />;
}

// ── PIN lock gate ───────────────────────────────────────────────────────────
function formatLockoutRemaining(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.ceil(seconds / 60)} min`;
}

function PinGate({ onUnlock }: { onUnlock: () => void }) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'checking' | 'create' | 'confirm' | 'enter'>('checking');
  const [pin, setPinInput] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [error, setError] = useState('');
  // T09: live lockout countdown (ms remaining, 0 = not locked out). This is
  // ONLY ever used to drive the on-screen message/countdown — it must never
  // be the sole gate that decides whether an unlock is allowed (see submit()
  // below, which re-reads the authoritative value from storage every time).
  const [lockoutMs, setLockoutMs] = useState(0);
  // T09 bugfix: a critical lockout-bypass was found in testing where a
  // correct PIN submitted during an active lockout still unlocked the
  // screen. Defends against every plausible cause at once, rather than
  // relying on any single guard: (a) `submittingRef` below serializes
  // submit() calls so no second call can race a lockout write that is
  // still in flight from the previous call; (b) submit() re-reads
  // getLockoutRemainingMs() FRESH FROM STORAGE at its very top instead of
  // trusting the `lockoutMs` React-state closure, which could in principle
  // be stale; (c) onChangeText ignores input entirely while locked, so a
  // PIN cannot even enter state during lockout regardless of how the
  // underlying platform input was manipulated; (d) the Pressable adds an
  // explicit `pointerEvents: 'none'` style, since `disabled` alone was
  // observed to still allow a click through on web.
  const submittingRef = useRef(false);
  // PIN autofill (owner GO, 22 Nov): Chrome can autofill this box and show
  // dots without the value ever reaching `pin` (no change event until the
  // user interacts), so Unlock said "Enter at least 4 digits". On submit we
  // read the box's real value — Chrome releases it on that tap — and use it
  // only if it is 4–6 digits (an autofilled account password is ignored).
  const pinInputRef = useRef<React.ComponentRef<typeof TextInput>>(null);

  useEffect(() => {
    hasPin()
      .then(async exists => {
        setMode(exists ? 'enter' : 'create');
        if (exists) setLockoutMs(await getLockoutRemainingMs());
      })
      .catch(() => { setMode('create'); setError('Could not check for an existing PIN — you can set a new one.'); });
  }, []);

  // Tick the countdown every second while locked out so the Unlock button
  // re-enables itself without the user needing to retry manually. Keyed on
  // `lockoutMs > 0` (not `lockoutMs` itself) so the interval is created once
  // per lockout period instead of being torn down/recreated every second.
  useEffect(() => {
    if (lockoutMs <= 0) return;
    const id = setInterval(() => setLockoutMs(ms => Math.max(0, ms - 1000)), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockoutMs > 0]);

  const submit = useCallback(async () => {
    // (a) Serialize — ignore any call while a previous one is still in
    // flight (prevents a correct-PIN call from racing ahead of a wrong-PIN
    // call that is still in the middle of writing the lockout to storage).
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      setError('');
      // (b) Authoritative, storage-backed re-check — never trust only the
      // `lockoutMs` React-state closure for the actual security decision.
      const freshLockoutMs = await getLockoutRemainingMs();
      if (freshLockoutMs > 0) {
        setLockoutMs(freshLockoutMs);
        return;
      }
      const entered = pinFromBox(pin, pinInputRef.current, Platform.OS);
      if (entered !== pin) setPinInput(entered);
      if (entered.length < 4) { setError('Enter at least 4 digits.'); return; }
      if (mode === 'create') { setFirstPin(entered); setPinInput(''); setMode('confirm'); return; }
      if (mode === 'confirm') {
        if (entered !== firstPin) { setError('PINs did not match — try again.'); setPinInput(''); setFirstPin(''); setMode('create'); return; }
        await setPin(entered); onUnlock(); return;
      }
      if (mode === 'enter') {
        const result = await verifyPin(entered);
        setPinInput('');
        if (result.ok) { onUnlock(); return; }
        if (result.reason === 'locked_out') {
          setLockoutMs(result.retryAfterMs);
          setError(`Too many incorrect attempts. Try again in ${formatLockoutRemaining(result.retryAfterMs)}.`);
        } else {
          setError(`Incorrect PIN. ${result.attemptsRemaining} attempt(s) left before a short lockout.`);
        }
      }
    } finally {
      submittingRef.current = false;
    }
  }, [pin, mode, firstPin, onUnlock]);

  if (mode === 'checking') return <View style={styles.root}><ActivityIndicator color={c.navy} style={{ marginTop: 60 }} /></View>;

  const locked = mode === 'enter' && lockoutMs > 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24, alignItems: 'center' }]} testID="evidence-pin-gate">
      <Text style={styles.heading}>
        {mode === 'create' ? 'Set a PIN for the Evidence Locker' : mode === 'confirm' ? 'Confirm your PIN' : 'Enter your PIN'}
      </Text>
      <Text style={[styles.note, { textAlign: 'center' }]}>
        {mode === 'enter' ? 'This locks your recordings, photos and videos so no one else can open this screen.' : 'Choose 4–6 digits. This stays on your device only — DHARA cannot reset it for you.'}
      </Text>
      <TextInput
        ref={pinInputRef}
        testID="evidence-pin-input"
        value={pin}
        // Not a password: stop browsers / phones offering to autofill it.
        {...PIN_NO_AUTOFILL}
        // (c) Ignore input entirely while locked — a PIN must never be able
        // to reach `pin` state during an active lockout, no matter how the
        // underlying platform input was changed (typing, paste, or a test/
        // automation tool programmatically setting the field's value).
        onChangeText={t => { if (locked) return; setPinInput(t.replace(/\D/g, '').slice(0, 6)); }}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
        placeholder="••••"
        style={styles.pinInput}
        editable={!locked}
        autoFocus
        accessibilityLabel={mode === 'confirm' ? 'Confirm PIN' : 'Enter PIN'}
      />
      {!!error && <Text testID="evidence-pin-error" style={[styles.note, { color: c.emergencyRed }]}>{error}</Text>}
      {locked && <Text testID="evidence-pin-lockout" style={[styles.note, { color: c.emergencyRed }]}>Locked for {formatLockoutRemaining(lockoutMs)}.</Text>}
      <Pressable
        testID="evidence-pin-submit"
        disabled={locked}
        // (d) Explicit pointer-events block — `disabled` alone was observed
        // in testing to still let a click through to onPress on web.
        pointerEvents={locked ? 'none' : 'auto'}
        style={(s) => [styles.button, locked && { opacity: 0.5 }, focusRingStyle(s)]}
        onPress={submit}
        accessibilityRole="button"
        accessibilityLabel={mode === 'enter' ? 'Unlock' : 'Continue'}
        accessibilityState={{ disabled: locked }}
      >
        <Text style={styles.buttonText}>{mode === 'enter' ? 'Unlock' : 'Continue'}</Text>
      </Pressable>
    </View>
  );
}

// S5 — inline note editor (feature flag: EXPO_PUBLIC_EVIDENCE_ACTIONS)
function NoteEditor({ initial, onSave, onCancel }: { initial: string; onSave: (text: string) => void; onCancel: () => void }) {
  const tc = theme.colors;
  const [text, setText] = useState(initial);
  return (
    <View style={{ gap: 8, marginTop: 4 }}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Add context for this recording…"
        placeholderTextColor={tc.muted}
        multiline
        style={{ borderWidth: 1, borderColor: tc.lines, borderRadius: 10, padding: 10, fontFamily: theme.fonts.body, fontSize: 13, color: tc.ink, minHeight: 70, backgroundColor: tc.background }}
        testID="evidence-note-input"
      />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Pressable onPress={() => onSave(text)} style={(s) => [{ flex: 1, backgroundColor: tc.navy, borderRadius: 10, padding: 10, alignItems: 'center' }, focusRingStyle(s)]} testID="evidence-note-save" accessibilityRole="button" accessibilityLabel="Save note">
          <Text style={{ color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 13 }}>Save note</Text>
        </Pressable>
        <Pressable onPress={onCancel} style={(s) => [{ flex: 1, borderWidth: 1, borderColor: tc.lines, borderRadius: 10, padding: 10, alignItems: 'center' }, focusRingStyle(s)]} testID="evidence-note-cancel" accessibilityRole="button" accessibilityLabel="Cancel note">
          <Text style={{ color: tc.muted, fontFamily: theme.fonts.body, fontSize: 13 }}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function EvidenceLocker() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, token } = useAuth();
  const scope = user?.id || 'device';
  const [unlocked, setUnlocked] = useState(false);
  // B5 (Phase 0.5): Change-PIN modal state
  const [changePinVisible, setChangePinVisible] = useState(false);
  const [cpCurrentInput, setCpCurrentInput] = useState('');
  const [cpNewInput, setCpNewInput] = useState('');
  const [cpConfirmInput, setCpConfirmInput] = useState('');
  const [cpStep, setCpStep] = useState<'current' | 'new' | 'confirm'>('current');
  const [cpError, setCpError] = useState('');
  const [cpBusy, setCpBusy] = useState(false);
  // Item G: Get recorder from EvidenceRecorderProvider (survives navigation).
  const { recorder, recorderState: state, claimForLocker, releaseLockerClaim, stopTriggerRecording, getOwner } = useEvidenceRecorder();
  const [items, setItems] = useState<RecordingItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  // v2.2 phase 7: which distinct error state to show (null = plain status line).
  const [notice, setNotice] = useState<RecordNotice | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [toast, setToast] = useState('');
  const [photoUris, setPhotoUris] = useState<Record<string, string>>({});
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [videoPreview, setVideoPreview] = useState<{ id: string; uri: string; wasDecrypted: boolean } | null>(null);
  const [manifestMap, setManifestMap] = useState<Record<string, ManifestEntry | null>>({});
  const [anchoring, setAnchoring] = useState<string | null>(null);
  const [backingUp, setBackingUp] = useState<Record<string, number>>({});
  // E1: Anchor/Backup buttons only render when evidence_vault_enabled is on.
  // EL-055: Whole locker renders blocked when evidence_locker_enabled is off.
  const [vaultEnabled, setVaultEnabled] = useState(false);
  const [lockerEnabled, setLockerEnabled] = useState<boolean | null>(null); // null = loading
  useEffect(() => {
    let alive = true;
    // EL-055: Per-scope AsyncStorage cache for the last server-confirmed flag
    // values.  On a network or server error we distinguish:
    //   cached null  → never connected before → allow (first-ever offline run)
    //   cached true  → server previously enabled → allow (offline access)
    //   cached false → server explicitly disabled → block (authorization denial)
    const lockerFlagKey = `dhara_locker_flag_v1_${scope}`;
    const vaultFlagKey  = `dhara_vault_flag_v1_${scope}`;
    const run = async () => {
      try {
        const f = await fetchFlags();
        if (!alive) return;
        const locker = !!(f as any)?.evidence_locker_enabled;
        const vault  = !!(f as any)?.evidence_vault_enabled;
        setLockerEnabled(locker);
        setVaultEnabled(vault);
        // Cache the authoritative values for future offline sessions.
        AsyncStorage.multiSet([
          [lockerFlagKey, JSON.stringify(locker)],
          [vaultFlagKey,  JSON.stringify(vault)],
        ]).catch(() => {}); // best-effort; never blocks render
      } catch {
        if (!alive) return;
        // Network / server error: read the last-known cached values so we can
        // distinguish offline access from a genuine authorization denial.
        try {
          const [[, lRaw], [, vRaw]] = await AsyncStorage.multiGet([lockerFlagKey, vaultFlagKey]);
          const cachedLocker = lRaw !== null ? (JSON.parse(lRaw) as boolean) : true;
          const cachedVault  = vRaw !== null ? (JSON.parse(vRaw) as boolean) : false;
          if (alive) { setLockerEnabled(cachedLocker); setVaultEnabled(cachedVault); }
        } catch {
          // Cache read also failed — allow access; do not lock users out for infra issues.
          if (alive) { setLockerEnabled(true); setVaultEnabled(false); }
        }
      }
    };
    run();
    return () => { alive = false; };
  }, [scope]);
  // S5 — load saved notes for this user scope
  useEffect(() => {
    if (!unlocked) return;
    AsyncStorage.getItem(`evidence_notes_${scope}`).then(v => { if (v) setNotesMap(JSON.parse(v)); }).catch(() => {});
  }, [scope, unlocked]);
  // EL-054 (Phase 0.5): sweep cache dir for leftover decrypted temp files at
  // every launch (component mount or scope change), NOT on unlock.  Delegates
  // to the exported sweepOrphanedEvidenceTempFiles() so the same logic can be
  // called from other entry points (e.g. app startup) without duplicating it.
  useEffect(() => {
    void sweepOrphanedEvidenceTempFiles(scope);
  }, [scope]); // runs at mount and on scope change — does NOT wait for unlock
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
  const commitPromiseRef = useRef<Promise<void>>(Promise.resolve()); // FIX (a): tracks the in-flight segment-commit so save() can await it before stopping
  const lastCommittedUriRef = useRef<string | null>(null); // FIX (RC4): URI of segment most recently committed by commitCurrentSegment — save() skips it to avoid double-save
  // EL-057 (Phase 0.5): true while any system UI overlay (camera picker, share
  // sheet, location-permission dialog, certificate share) is in front of the app.
  // The AppState listener skips setUnlocked(false) while this is true so that
  // normal in-locker flows are not interrupted by a spurious re-lock.
  // Cleared by finally blocks in capture/shareItem/requestLocationThenAnchor/
  // handleCertificate, and also by the AppState 'active' branch as a bounded
  // fallback for the iOS stuck-sheet edge case.
  const systemOverlayRef = useRef(false);
  const [segmentCount, setSegmentCount] = useState(0);
  const [recoverable, setRecoverable] = useState<EvidenceSession[]>([]);
  // S5 — Evidence Actions: per-item notes (stored locally, keyed by item.id)
  const [notesMap, setNotesMap] = useState<Record<string, string>>({});
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
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
  // S5 — save a note for one item
  const saveNote = useCallback(async (itemId: string, text: string) => {
    const next = { ...notesMap, [itemId]: text };
    setNotesMap(next);
    AsyncStorage.setItem(`evidence_notes_${scope}`, JSON.stringify(next)).catch(() => {});
    setEditingNoteId(null);
  }, [notesMap, scope]);
  const closeVideoPreview = useCallback(() => {
    if (videoPreviewRef.current) releaseDecryptedTempUri(videoPreviewRef.current.uri, videoPreviewRef.current.wasDecrypted);
    setVideoPreview(null);
  }, []);
  // ── A2 Step 1: a temp recording is only deleted once its encrypted copy is
  // saved AND read back. Until then it stays on disk with a pending marker so
  // the next launch can recover it. ───────────────────────────────────────────
  const persistThenDiscard = useCallback(async (item: RecordingItem, uri: string) => {
    const check = await getDecryptedTempUri(scope, item);
    releaseDecryptedTempUri(check, !!item.iv);
    discardTemporaryRecording(uri);
    await clearPendingTemp(AsyncStorage, scope, uri);
  }, [scope]);
  // Holds the latest save() so navigation/background paths can stop-and-save
  // without re-creating useFocusEffect on every render.
  const saveRef = useRef<null | (() => Promise<void>)>(null);
  // cancel() = EXPLICIT USER DISCARD ONLY (confirmed in the UI). It is never
  // wired to navigation or AppState any more — see exitPreserving below.
  const cancel = useCallback(() => {
    epoch.current++;
    stopPlayer();
    // Always clear the segment timer first so no new commit can start.
    if (segTimerRef.current) { clearTimeout(segTimerRef.current); segTimerRef.current = null; }
    // P0-B: If a segmented session is running, interrupt it (committed segments survive).
    if (sessionRef.current && segmentedEnabled.current) {
      const sid = sessionRef.current.sessionId;
      sessionRef.current = null;
      void interruptSession(scope, sid).catch(() => {});
    }
    if (active.current) {
      active.current = false;
      releaseLockerClaim(); // release provider ownership
      void recorder.stop().then(() => discardTemporaryRecording(recorder.uri)).catch(() => {});
      // Only reset audio mode if WE started recording (not a trigger recording).
      if (Platform.OS !== 'web') void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    } else {
      // FIX (d): use stable getOwner() instead of recordingOwner React state so
      // that ownership transitions never re-create this callback and never
      // re-run useFocusEffect mid-start()/save().
      const owner = getOwner();
      if (owner === 'trigger') {
        // Fix C: release a stuck trigger-owned claim.
        void stopTriggerRecording();
      } else if (owner === 'locker') {
        // FIX (e): active.current is false but the locker still owns the
        // recorder — commitCurrentSegment may have re-armed it after save()
        // cleared active.current.  Force-stop the native recorder now.
        void recorder.stop().then(() => {
          if (recorder.uri) discardTemporaryRecording(recorder.uri);
        }).catch(() => {});
        releaseLockerClaim();
        if (Platform.OS !== 'web') void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      }
      // owner === null: nothing to clean up (screen unmount after a completed save)
    }
    // NOTE: recordingOwner React state is intentionally NOT in this dep array.
    // getOwner() reads ownerRef synchronously without causing re-renders, which
    // keeps the cancel reference stable across ownership changes so useFocusEffect
    // never re-runs (and never fires a spurious cancel()) during recording.
  }, [recorder, stopPlayer, scope, releaseLockerClaim, getOwner, stopTriggerRecording]);
  // A2 Step 1: leaving the screen must STOP AND SAVE, never discard.
  const exitPreserving = useCallback(() => {
    stopPlayer();
    if (active.current || getOwner() === 'locker') {
      // Stop-and-save. save() clears the segment timer itself and awaits any
      // in-flight segment commit, so no segment is lost here.
      void saveRef.current?.();
    }
    // owner === 'trigger': leave the trigger recording running — it is owned by
    // the provider and must not be stopped or discarded by this screen.
  }, [stopPlayer, getOwner]);
  useFocusEffect(useCallback(() => {
    let alive = true;
    // A2 Step 1: recover any temp recording left behind by a crash, a call or
    // a background kill (one whose encrypted copy was never read back).
    if (!active.current) {
      listPendingTemps(AsyncStorage, scope).then(async pending => {
        if (!alive || pending.length === 0 || active.current) return;
        let recovered = 0;
        for (const entry of pending) {
          // EL-054: If the OS purged the temp file between sessions the entry
          // is stale.  Clearing it now prevents it accumulating and retrying
          // on every subsequent cold start.  The recording cannot be recovered.
          if (!pendingTempFileExists(entry.uri)) {
            await clearPendingTemp(AsyncStorage, scope, entry.uri).catch(() => {});
            continue;
          }
          try {
            const item = await saveRecording(scope, entry.uri);
            await persistThenDiscard(item, entry.uri);
            recovered++;
          } catch { /* keep it pending — file exists but encryption/write failed; retry on next launch */ }
        }
        if (!alive || recovered === 0) return;
        const visible = await loadVisibleRecordings(scope).catch(() => null);
        if (!alive) return;
        if (visible) { owned.current = visible; setItems(visible); }
        setStatus(`Recovered ${recovered} unfinished recording(s) from your last session.`);
      }).catch(() => {});
    }
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
      alive = false; exitPreserving(); releaseRecordings(owned.current);
      Object.entries(photoUrisRef.current).forEach(([id, uri]) => {
        const row = owned.current.find(r => r.id === id);
        releaseDecryptedTempUri(uri, !!row?.iv);
      });
      photoUrisRef.current = {}; setPhotoUris({});
      closeVideoPreview();
      owned.current = [];
    };
  }, [scope, exitPreserving, closeVideoPreview, persistThenDiscard]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', value => {
      if (value !== 'active') {
        if (active.current) {
          // A2 Step 1: backgrounding/interruption STOPS AND SAVES. The temp file
          // is kept until its encrypted copy is read back; if the OS suspends us
          // mid-save, the next launch recovers it (see useFocusEffect above).
          setStatus('Recording stopped — saving your evidence. Nothing is discarded.');
          void saveRef.current?.();
        }
        // EL-057 (Phase 0.5): re-lock only when no system overlay is active.
        // Camera picker, share sheet, and permission dialogs all fire AppState
        // 'background'/'inactive'; skipping setUnlocked during those transitions
        // prevents spurious re-locks mid-capture or mid-share.
        if (!systemOverlayRef.current) {
          setUnlocked(false);
        }
      } else {
        // Foreground return — bounded fallback for the iOS stuck-sheet edge case:
        // if shareAsync opened a full-screen share target and the promise never
        // formally resolved before the user came back, clear the flag here so it
        // cannot block re-locking on the next background transition.
        systemOverlayRef.current = false;
      }
    });
    return () => sub.remove();
  }, []);
  // ── P0-B: Segment cycling ─────────────────────────────────────────────────
  // commitCurrentSegment: stop recorder → restart recorder (B4: before
  // encrypting, to minimise the gap) → encrypt+persist the old segment.
  //
  // B4 (Phase 0.5): the recorder is restarted BEFORE the encrypt+persist step.
  // The gap between segments is now only stop→prepare→record latency, not
  // stop+encrypt+persist+prepare+record. The encrypt+persist of the previous
  // segment happens concurrently with the new recording. commitPromiseRef still
  // covers the ENTIRE async function (including the post-restart save work) so
  // save() correctly awaits it via the existing guard.
  //
  // Gap measurement: NOT RUN. A continuous-tone test on a real device is
  // required to report p50 and p95; see Phase 0 inventory item h.
  const commitCurrentSegment = useCallback(async (): Promise<void> => {
    if (!active.current || !sessionRef.current) return;
    const session = sessionRef.current;
    const segIdx = segCountRef.current;
    // Capture the old segment start time NOW, before any state mutation.
    const prevSegStartMs = segStartTimeRef.current;
    let uri: string | null = null;
    try {
      await recorder.stop();
      // Capture URI immediately after stop — before prepare/record so the
      // native recorder can transition state cleanly.
      uri = recorder.uri ?? null;
      const stopTimeMs = Date.now(); // end of old segment (before gap ends)

      // B4: restart the recorder BEFORE encrypting the previous segment.
      // FIX (b): re-check active BEFORE restarting (identical guard as before).
      if (active.current && sessionRef.current) {
        try {
          await recorder.prepareToRecordAsync();
          // FIX (b): re-check AFTER prepare — the most critical guard.
          if (!active.current || !sessionRef.current) {
            try { await recorder.stop(); } catch {}
          } else {
            recorder.record();
            segStartTimeRef.current = Date.now(); // start of NEW segment
            // FIX (a): schedule NEXT commit after recorder is running.
            segTimerRef.current = setTimeout(() => {
              commitPromiseRef.current = commitCurrentSegment();
            }, SEGMENT_TARGET_MS);
          }
        } catch (e: any) {
          console.warn('[P0-B] segment restart error:', e?.message);
          active.current = false;
          setStatus(`Recording stopped after ${segCountRef.current} segment(s). Saved segments can be recovered.`);
        }
      }

      // Now encrypt+persist the OLD segment (overlapping with new recording).
      // durationMs uses the captured prevSegStartMs and stopTimeMs so it
      // measures only actual recorded time, not the restart latency.
      if (uri) {
        const durationMs = stopTimeMs - prevSegStartMs;
        await markPendingTemp(AsyncStorage, scope, uri); // A2: protect before saving
        const segItem = await saveSegment(scope, uri, session.sessionId);
        await persistThenDiscard(segItem, uri); // A2: delete only after read-back
        lastCommittedUriRef.current = uri; // FIX (RC4): mark so save() skips it
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
    }
  }, [recorder, scope, persistThenDiscard]);

  const start = useCallback(async () => {
    if (working.current || active.current) return;
    working.current = true; setBusy(true); setStatus(''); setNotice(null); stopPlayer();
    const id = ++epoch.current;
    try {
      // Check current status first — if already granted, skip the request so
      // the system dialog never appears and no AppState 'background' event fires.
      let permission = await AudioModule.getRecordingPermissionsAsync();
      if (!permission.granted) {
        permission = await AudioModule.requestRecordingPermissionsAsync();
      }
      if (!permission.granted) {
        if (UI_V22_P7) setNotice('micDenied');
        throw new Error('Microphone permission is needed. Allow it in your device or site settings, then try again.');
      }
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
      lastCommittedUriRef.current = null;          // FIX (RC4): fresh session
      commitPromiseRef.current = Promise.resolve(); // FIX (a): no in-flight commit yet
      sessionStartTimeRef.current = Date.now(); // Fix (S1-4): session-level start, used by the timer display
      // P0-B: If segmented recording is enabled, start the segment cycle.
      if (segmentedEnabled.current) {
        const session = await createSession(scope);
        sessionRef.current = session;
        segCountRef.current = 0;
        segDurationsRef.current = []; // Fix (S1-3): reset the measured-duration accumulator
        setSegmentCount(0);
        segStartTimeRef.current = Date.now();
        segTimerRef.current = setTimeout(() => { commitPromiseRef.current = commitCurrentSegment(); }, SEGMENT_TARGET_MS);
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
  const navigation = useNavigation();
  // B1 (Phase 0.5): only auto-start when (a) the locker is already unlocked
  // and (b) the intent was set by in-app navigation (consumeEvidenceAutoRecord).
  // The old URL-param check (params.record === '1') has been removed: any
  // external deep-link could carry that param and start the microphone before
  // the user even opened the PIN gate. The module-level flag in
  // evidenceAutoRecord.ts can only be set from within this JS bundle.
  useEffect(() => {
    if (!unlocked) return;              // never before PIN cleared
    if (!navigation.canGoBack()) return; // reject cold deep-links (no back stack)
    if (!started.current && consumeEvidenceAutoRecord()) {
      started.current = true;
      void start();
    }
  }, [unlocked, navigation, start]);
  const save = async () => {
    // FIX (c): never silently no-op — show feedback when already saving
    if (working.current) { setStatus('Saving… please wait.'); return; }

    if (!active.current) {
      // FIX (c): native recorder is still running but active.current is false —
      // this is the RC2 race where commitCurrentSegment re-armed the recorder
      // after save()/cancel() already cleared active.current.  Force-stop and
      // salvage any committed segments so the user is never left hanging.
      if (state.isRecording) {
        working.current = true; setBusy(true);
        try {
          if (segTimerRef.current) { clearTimeout(segTimerRef.current); segTimerRef.current = null; }
          await commitPromiseRef.current; // wait for any in-flight commit
          try { await recorder.stop(); } catch {} // may already be stopped — safe
          if (segmentedEnabled.current && sessionRef.current) {
            const session = sessionRef.current;
            sessionRef.current = null;
            try {
              const totalDuration = segDurationsRef.current.reduce((sum, d) => sum + d, 0);
              const parent = await createSegmentedParent(scope, session.sessionId, segCountRef.current, totalDuration);
              await finalizeSession(scope, session.sessionId, parent.id);
              const visible = await loadVisibleRecordings(scope);
              owned.current = visible; setItems(visible);
              setStatus(`Saved ${segCountRef.current} segment(s) on this device. Nothing was uploaded or sent.`);
            } catch { setStatus('Recording stopped. Committed segments may be recoverable.'); }
          } else {
            setStatus('Recording stopped.');
          }
        } finally {
          working.current = false; setBusy(false);
          releaseLockerClaim();
          if (Platform.OS !== 'web') void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
        }
        return;
      }
      // No native recording running — handle trigger ownership if present.
      // FIX (d): use stable getOwner() instead of recordingOwner state.
      if (getOwner() === 'trigger') {
        working.current = true; setBusy(true);
        try { await stopTriggerRecording(); setStatus('Stopped. You can start recording again.'); }
        finally { working.current = false; setBusy(false); }
      }
      return;
    }

    // ── Normal save path: active.current is true ──────────────────────────
    // FIX (a): set active=false and clear the timer FIRST so that
    // commitCurrentSegment cannot restart the recorder, then await any
    // in-flight commit before calling recorder.stop() — this guarantees the
    // two never run recorder.stop() concurrently and recorder.uri is never
    // read/deleted twice (RC4).
    active.current = false;
    if (segTimerRef.current) { clearTimeout(segTimerRef.current); segTimerRef.current = null; }
    working.current = true; setBusy(true);
    try {
      await commitPromiseRef.current; // FIX (a): wait for any in-flight segment commit
      try { await recorder.stop(); } catch {} // recorder may already be stopped by the last commit — safe
      if (segmentedEnabled.current && sessionRef.current) {
        // ── P0-B: Segmented save ─────────────────────────────────────────
        const session = sessionRef.current;
        sessionRef.current = null;
        // Commit the final partial segment only if commitCurrentSegment has
        // not already committed it (FIX RC4: skip if URI matches lastCommittedUriRef).
        const uri = recorder.uri;
        if (uri && uri !== lastCommittedUriRef.current) {
          try {
            await markPendingTemp(AsyncStorage, scope, uri); // A2: protect before saving
            const segItem = await saveSegment(scope, uri, session.sessionId);
            await persistThenDiscard(segItem, uri); // A2: delete only after read-back
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
        const tempUri = recorder.uri;
        if (!tempUri) throw new Error('No audio was captured. Please record again.');
        await markPendingTemp(AsyncStorage, scope, tempUri); // A2: protect before saving
        const item = await saveRecording(scope, tempUri);
        await persistThenDiscard(item, tempUri); // A2: delete only after read-back
        owned.current = [item, ...owned.current]; setItems(owned.current);
        setStatus('Saved on this device. Nothing was uploaded or sent.');
      }
    } catch (error: any) {
      setStatus(error.message || 'Recording could not be saved.');
      if (UI_V22_P7) setNotice('saveFailed');
    }
    finally {
      working.current = false; setBusy(false);
      releaseLockerClaim(); // release provider ownership after save
      if (Platform.OS !== 'web') void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    }
  };
  // A2: expose the latest save() to the navigation/background exit paths.
  saveRef.current = save;
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
    setDeleteError('');
    setDeleteBusy(true);
    // N-09: capture this BEFORE any state mutation below — manifestMap's
    // entry for this item is deleted further down, so this is the only
    // chance to know whether a cloud copy exists to also delete.
    const hadBackup = !!manifestMap[item.id]?.backup;
    try {
      stopPlayer();
      if (videoPreview?.id === item.id) closeVideoPreview();
      if (photoUris[item.id]) { releaseDecryptedTempUri(photoUris[item.id], !!item.iv); setPhotoUris(prev => { const next = { ...prev }; delete next[item.id]; return next; }); }
      await deleteRecording(scope, item);
      // P0-B: Also clean up the session record if v2
      if (item.recording_format_version === 2 && item.session_id) {
        await deleteSession(scope, item.session_id).catch(() => {});
      }
      // This item's own metadata only — never another item's.
      await markManifestDeleted(scope, item.id).catch(() => {});
      // N-09: also delete the cloud copy, not just the local file — a
      // network failure here must NOT block the local delete the user
      // asked for (they may be offline), so it never throws; it reports
      // a tri-state result the toast below reflects honestly instead of
      // claiming "deleted" when the cloud object may still be sitting there.
      let cloudResult: 'deleted' | 'none' | 'failed' = 'none';
      if (hadBackup) {
        cloudResult = await deleteBackupCloud(scope, item.id, token);
        if (cloudResult === 'deleted' || cloudResult === 'none') {
          await clearBackupInfo(scope, item.id).catch(() => {});
        }
      }
      setManifestMap(prev => { const next = { ...prev }; delete next[item.id]; return next; });
      if (notesMap[item.id] !== undefined) {
        const nextNotes = { ...notesMap };
        delete nextNotes[item.id];
        setNotesMap(nextNotes);
        await AsyncStorage.setItem(`evidence_notes_${scope}`, JSON.stringify(nextNotes)).catch(() => {});
      }
      owned.current = owned.current.filter(row => row.id !== item.id);
      setItems(owned.current);
      setDeleting(null);
      const msg = cloudResult === 'failed'
        ? 'Deleted from this device. Could not reach the server to delete the cloud copy — it may still be stored; try again when you have signal.'
        : hadBackup
          ? 'Recording and its cloud backup have both been deleted.'
          : 'Recording deleted from this device.';
      setStatus(msg);
      setToast(msg);
    } catch (e: any) {
      // Visible failure with a reason class, so a silent failure can't look
      // like a successful delete.
      const raw = String(e?.message || e || '');
      const reason = /storage|IndexedDB|quota/i.test(raw) ? 'device storage'
        : /not be found|no longer|missing/i.test(raw) ? 'item not found'
        : /file/i.test(raw) ? 'file access'
        : 'unexpected error';
      setDeleteError(`Could not delete this recording (${reason}). Nothing was removed — you can try again.`);
      setStatus(`Could not delete this recording (${reason}). Nothing was removed.`);
    } finally {
      setDeleteBusy(false);
    }
  }, [scope, stopPlayer, videoPreview, closeVideoPreview, photoUris, notesMap, manifestMap, token]);

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
    setBusy(true); setStatus(''); setNotice(null);
    // EL-057: mark system overlay active for the entire capture flow.
    // Covers both requestCameraPermissionsAsync() (Android permission dialog)
    // and launchCameraAsync() (native camera on both platforms), both of which
    // fire AppState 'background'/'inactive'. Cleared in the outer finally below.
    systemOverlayRef.current = true;
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
      // B3 (Phase 0.5): distinguish out-of-memory / large-file errors from
      // general failures. The original file from the picker is NEVER deleted
      // by DHARA — it stays in the system photo library or the picker's temp
      // cache. The user has not lost their photo or video.
      const msg = String(error?.message || error || '');
      const isOom = /out of memory|oom|allocation|heap|rangeError/i.test(msg);
      if (isOom) {
        setStatus(
          `${kind === 'photo' ? 'Photo' : 'Video'} is too large to encrypt on this device — ` +
          'the original is still in your photo library. Try a shorter video or a lower-resolution photo.',
        );
      } else {
        setStatus(
          `Could not save this ${kind}. The original file has not been changed. ` +
          (msg ? `(${msg.slice(0, 120)})` : 'Please try again.'),
        );
      }
    } finally { setBusy(false); systemOverlayRef.current = false; }
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
          // EL-057: set overlay flag before the share sheet opens.
          if (confirmed) {
            systemOverlayRef.current = true;
            await Sharing.shareAsync(zipUri, { mimeType: 'application/zip' });
          }
        } finally {
          releaseDecryptedTempUri(zipUri, true);
          systemOverlayRef.current = false; // EL-057: clear whether confirmed or not
        }
        return;
      }
      // Single-file path — unchanged.
      const tempUri = await getDecryptedTempUri(scope, item);
      // EL-057: set overlay flag before the share sheet opens.
      systemOverlayRef.current = true;
      try { await Sharing.shareAsync(tempUri); }
      finally { releaseDecryptedTempUri(tempUri, !!item.iv); systemOverlayRef.current = false; }
    } catch { setStatus('Could not open the share sheet. Please try again.'); }
  }, [scope]);

  // ── S-B5: Evidence Vault — optional anchor (tamper-evident timestamp) +
  // encrypted cloud backup + Section 63 BSA draft certificate. Local
  // capture/encryption above never needs any of this; these require a
  // network call only at the moment the citizen taps the button. ──────────
  const doAnchor = useCallback(async (item: RecordingItem, gps: GpsPoint | null) => {
    setAnchoring(item.id);
    try {
      const { entry } = await anchorItem(scope, item, gps, token);
      setManifestMap(prev => ({ ...prev, [item.id]: entry }));
      setStatus('Evidence anchored — a tamper-evident timestamp was saved.');
    } catch (e: any) {
      setStatus(e?.message || 'Could not anchor this item. Please try again.');
    } finally {
      setAnchoring(null);
    }
  }, [scope, token]);

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
        // EL-057: permission dialog fires AppState on Android — guard the re-lock.
        // Set true synchronously before the native call, clear in .finally() so
        // it is always released whether the dialog resolves or throws.
        systemOverlayRef.current = true;
        const req = await Location.requestForegroundPermissionsAsync()
          .finally(() => { systemOverlayRef.current = false; });
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
      const entry = await backupItem(scope, item, fraction => setBackingUp(prev => ({ ...prev, [item.id]: fraction })), token);
      setManifestMap(prev => ({ ...prev, [item.id]: entry }));
      setStatus('Backed up to secure cloud storage.');
    } catch (e: any) {
      setStatus(e?.message || 'Could not back up this item. Please try again.');
    } finally {
      setBackingUp(prev => { const next = { ...prev }; delete next[item.id]; return next; });
    }
  }, [scope, token]);

  const handleCertificate = useCallback(async (item: RecordingItem) => {
    const entry = manifestMap[item.id];
    if (!entry?.anchor) { setStatus('Anchor this item first to generate a certificate.'); return; }
    // EL-057: exportCertificate calls Sharing.shareAsync internally — guard
    // the entire call so the share sheet does not trigger a spurious re-lock.
    systemOverlayRef.current = true;
    try { await exportCertificate(item, entry); }
    catch { setStatus('Could not export the certificate. Please try again.'); }
    finally { systemOverlayRef.current = false; }
  }, [manifestMap]);

  // The item whose delete confirmation is open (if any).
  const deleteTarget = deleting ? items.find(row => row.id === deleting) ?? null : null;

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // EL-055: Check locker feature flag before PIN gate.
  // lockerEnabled === null  → still loading → show spinner
  // lockerEnabled === false → disabled by operator → show blocked state
  // lockerEnabled === true  → proceed to PIN gate as normal
  if (lockerEnabled === null) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Evidence Locker" />
        <View style={styles.disabledBlock}>
          <ActivityIndicator color={c.brand} />
        </View>
      </View>
    );
  }
  if (lockerEnabled === false) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Evidence Locker" />
        <View style={styles.disabledBlock} testID="locker-disabled">
          <Text style={styles.disabledTitle}>Evidence Locker is not available</Text>
          <Text style={styles.disabledBody}>
            This feature has not been enabled for your version of DHARA.
            Your existing evidence files are safe and have not been changed.
          </Text>
        </View>
      </View>
    );
  }

  if (!unlocked) return <PinGate onUnlock={() => setUnlocked(true)} />;

  // B5 (Phase 0.5): Change-PIN handler — requires the current PIN.
  const handleChangePinStep = async () => {
    setCpError('');
    if (cpStep === 'current') {
      // Verify the current PIN using verifyPin (not changePin) so we don't
      // commit yet; we just check the current PIN is correct.
      setCpBusy(true);
      try {
        const { verifyPin: vp } = await import('@/src/women/evidenceLock');
        const result = await vp(cpCurrentInput);
        if (!result.ok) {
          setCpError(result.reason === 'locked_out' ? `Too many attempts — wait ${Math.ceil((result.retryAfterMs ?? 0) / 1000)}s.` : 'Incorrect PIN. Try again.');
          setCpCurrentInput('');
          return;
        }
        setCpStep('new');
      } catch { setCpError('Could not verify PIN. Please try again.'); }
      finally { setCpBusy(false); }
    } else if (cpStep === 'new') {
      if (cpNewInput.length < 4) { setCpError('PIN must be at least 4 digits.'); return; }
      setCpStep('confirm');
    } else {
      if (cpConfirmInput !== cpNewInput) { setCpError('PINs do not match. Try again.'); setCpConfirmInput(''); return; }
      setCpBusy(true);
      try {
        const result = await changePin(cpCurrentInput, cpNewInput);
        if (!result.ok) { setCpError('Could not save new PIN. Please try again.'); return; }
        setChangePinVisible(false);
        setCpCurrentInput(''); setCpNewInput(''); setCpConfirmInput('');
        setCpStep('current'); setCpError('');
        setStatus('PIN changed.');
      } catch { setCpError('Could not save new PIN. Please try again.'); }
      finally { setCpBusy(false); }
    }
  };

  const changePinLabel = cpStep === 'current' ? 'Enter your current PIN' : cpStep === 'new' ? 'Enter new PIN (4–6 digits)' : 'Confirm new PIN';
  const changePinInput = cpStep === 'current' ? cpCurrentInput : cpStep === 'new' ? cpNewInput : cpConfirmInput;
  const setChangePinInput = cpStep === 'current' ? setCpCurrentInput : cpStep === 'new' ? setCpNewInput : setCpConfirmInput;

  return (
    <View style={styles.root} testID="evidence-locker-screen">
      <ScreenHeader title="Evidence locker" subtitle="Local recordings, photos & video · no network needed" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <Text testID="evidence-storage-notice" style={styles.note}>Saved on this phone. Sharing is your choice. Nobody else gets it unless you choose to share it, anchor it, or back it up. Recording in the background is not promised — keep the screen on while recording. Clearing app data or uninstalling can erase it.</Text>
        {/* B5 (Phase 0.5): Change PIN — requires current PIN to proceed */}
        <Pressable
          testID="evidence-change-pin"
          style={(s) => [styles.changePinBtn, focusRingStyle(s)]}
          onPress={() => { setCpStep('current'); setCpCurrentInput(''); setCpNewInput(''); setCpConfirmInput(''); setCpError(''); setChangePinVisible(true); }}
          accessibilityRole="button"
          accessibilityLabel="Change locker PIN"
        >
          <Text style={styles.changePinText}>Change PIN</Text>
        </Pressable>
        <Text testID="evidence-recording-timer" style={styles.timer}>
          {state.isRecording
            ? segmentedEnabled.current
              ? `Recording · ${Math.floor(computeSessionElapsedMs(Date.now(), sessionStartTimeRef.current) / 1000)}s · ${segmentCount} segment(s) saved`
              : `Recording · ${Math.floor(state.durationMillis / 1000)}s`
            : 'Ready to record'}
        </Text>
        <Pressable testID="evidence-record-toggle" disabled={busy} style={(s) => [styles.button, focusRingStyle(s)]} onPress={state.isRecording ? save : start} accessibilityRole="button" accessibilityLabel={state.isRecording ? 'Stop and save recording' : 'Start voice recording'} accessibilityState={{ disabled: busy, busy }}>
          {busy
            ? state.isRecording
              ? <Text style={styles.buttonText}>Saving…</Text>
              : <ActivityIndicator color={c.onBrandPrimary} />
            : <Text style={styles.buttonText}>{state.isRecording ? 'Stop & save' : 'Start voice recording'}</Text>}
        </Pressable>
        {state.isRecording && <Pressable testID="evidence-discard" style={(s) => [styles.secondary, focusRingStyle(s)]} accessibilityRole="button" accessibilityLabel="Discard recording" onPress={() => crossAlert(
          'Discard this recording?',
          'This permanently deletes the audio captured since you tapped record. It cannot be undone.',
          [
            { text: 'Keep recording', style: 'cancel' },
            { text: 'Discard recording', style: 'destructive', onPress: () => { cancel(); setStatus(segmentedEnabled.current ? `Discarded. ${segCountRef.current} committed segment(s) can still be recovered.` : 'Unfinished recording discarded.'); } },
          ],
        )}><Text style={styles.label}>Discard recording</Text></Pressable>}
        {/* P0-B: Recovery banner for interrupted sessions */}
        {recoverable.length > 0 && recoverable.map(ses => (
          <View key={ses.sessionId} style={[styles.secondary, { borderColor: c.gold }]} testID={`recovery-${ses.sessionId}`}>
            <Text style={styles.label}>Interrupted recording found — {ses.segments.length} segment(s) saved</Text>
            <Text style={styles.note}>Started {new Date(ses.startedAt).toLocaleString()}</Text>
            <View style={styles.captureRow}>
              <Pressable style={(s) => [styles.control, { flex: 1 }, focusRingStyle(s)]} onPress={() => handleRecover(ses)} disabled={busy} accessibilityRole="button" accessibilityLabel="Recover interrupted recording" accessibilityState={{ disabled: busy }}>
                <Text style={[styles.label, { color: c.verifiedGreen }]}>Recover</Text>
              </Pressable>
              <Pressable style={(s) => [styles.control, { flex: 1 }, focusRingStyle(s)]} onPress={() => dismissRecoverable(ses)} disabled={busy} accessibilityRole="button" accessibilityLabel="Discard interrupted recording" accessibilityState={{ disabled: busy }}>
                <Text style={[styles.label, { color: c.emergencyRed }]}>Discard</Text>
              </Pressable>
            </View>
          </View>
        ))}
        <View style={styles.captureRow}>
          <Pressable testID="evidence-take-photo" disabled={busy || state.isRecording} style={(s) => [styles.secondary, styles.captureBtn, focusRingStyle(s)]} onPress={() => capture('photo')} accessibilityRole="button" accessibilityLabel="Take photo">
            <Text style={styles.label}>Take photo</Text>
          </Pressable>
          <Pressable testID="evidence-record-video" disabled={busy || state.isRecording} style={(s) => [styles.secondary, styles.captureBtn, focusRingStyle(s)]} onPress={() => capture('video')} accessibilityRole="button" accessibilityLabel="Record video, max 2 minutes">
            <Text style={styles.label}>Record video (max 2 min)</Text>
          </Pressable>
        </View>
        {/* v2.2 phase 7: microphone-denied and save-failed get their own
            clearly marked notice with a next step, instead of the same plain
            line as every other message. Flag OFF: today's status line only. */}
        {UI_V22_P7 && notice ? (
          <View testID={`evidence-notice-${notice}`} style={styles.noticeCard} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            <Text style={styles.noticeTitle}>{RECORD_NOTICES[notice].title}</Text>
            <Text style={styles.noticeBody}>{RECORD_NOTICES[notice].body}</Text>
            {!!status && <Text testID="evidence-status" style={styles.noticeDetail} selectable>{status}</Text>}
          </View>
        ) : (
          !!status && <Text testID="evidence-status" accessibilityLiveRegion="polite" style={styles.note}>{status}</Text>
        )}
        <Text style={styles.heading} testID="evidence-count">Saved items ({items.length})</Text>
        {items.map(item => <View key={item.id} style={styles.secondary} testID={`recording-${item.id}`}>
          <Text style={styles.label}>
            {item.type === 'photo' ? 'Photo' : item.type === 'video' ? 'Video' : 'Audio'}
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
              style={(s) => [styles.videoPlaceholder, focusRingStyle(s)]}
              onPress={() => previewVideo(item)}
              accessibilityRole="button"
              accessibilityLabel="Preview video"
            >
              {previewLoading === item.id
                ? <ActivityIndicator color={c.navy} />
                : <Text style={styles.label}>▶️ Tap to preview</Text>}
            </Pressable>
          )}
          {item.type === 'audio' && (
            <Pressable testID={`recording-play-${item.id}`} disabled={state.isRecording || busy} style={(s) => [styles.control, focusRingStyle(s)]} onPress={() => play(item)} accessibilityRole="button" accessibilityLabel={playing === item.id ? 'Stop playback' : 'Play recording'}><Text style={styles.label}>{playing === item.id ? 'Stop playback' : 'Play recording'}</Text></Pressable>
          )}
          {item.type === 'video' && videoPreview?.id === item.id && (
            <Pressable testID={`recording-close-preview-${item.id}`} style={(s) => [styles.control, focusRingStyle(s)]} onPress={closeVideoPreview} accessibilityRole="button" accessibilityLabel="Close preview"><Text style={styles.label}>Close preview</Text></Pressable>
          )}
          <Pressable testID={`recording-share-${item.id}`} style={(s) => [styles.control, focusRingStyle(s)]} onPress={() => shareItem(item)} accessibilityRole="button" accessibilityLabel="Share or open this recording"><Text style={styles.label}>Share / Open</Text></Pressable>
          <View style={styles.vaultRow}>
            <Text testID={`recording-vault-status-${item.id}`} style={styles.note}>
              {manifestMap[item.id]?.anchor
                ? `Anchored · ${new Date(manifestMap[item.id]!.anchor!.serverTime).toLocaleString()}`
                : 'Not anchored yet · timestamp proof is optional'}
              {manifestMap[item.id]?.backup ? ' · ☁️ Backed up' : ''}
            </Text>
            {vaultEnabled && !manifestMap[item.id]?.anchor && (
              <Pressable testID={`recording-anchor-${item.id}`} disabled={anchoring === item.id} style={(s) => [styles.control, focusRingStyle(s)]} onPress={() => handleAnchor(item)} accessibilityRole="button" accessibilityLabel="Anchor and verify, needs signal" accessibilityState={{ disabled: anchoring === item.id, busy: anchoring === item.id }}>
                {anchoring === item.id ? <ActivityIndicator color={c.navy} /> : <Text style={styles.label}>Anchor & verify (needs signal)</Text>}
              </Pressable>
            )}
            {vaultEnabled && !!manifestMap[item.id]?.anchor && !manifestMap[item.id]?.backup && (
              <Pressable testID={`recording-backup-${item.id}`} disabled={item.id in backingUp} style={(s) => [styles.control, focusRingStyle(s)]} onPress={() => handleBackup(item)} accessibilityRole="button" accessibilityLabel="Back up to secure cloud" accessibilityState={{ disabled: item.id in backingUp, busy: item.id in backingUp }}>
                <Text style={styles.label}>{item.id in backingUp ? `Backing up… ${Math.round((backingUp[item.id] || 0) * 100)}%` : 'Back up to secure cloud'}</Text>
              </Pressable>
            )}
            {!!manifestMap[item.id]?.anchor && (
              <Pressable testID={`recording-certificate-${item.id}`} style={(s) => [styles.control, focusRingStyle(s)]} onPress={() => handleCertificate(item)} accessibilityRole="button" accessibilityLabel="Export certificate draft">
                <Text style={styles.label}>Export certificate (draft)</Text>
              </Pressable>
            )}
          </View>
          <Pressable
            testID={`recording-delete-${item.id}`}
            style={(s) => [styles.control, focusRingStyle(s)]}
            onPress={() => { setDeleteError(''); setDeleting(item.id); }}
            accessibilityRole="button"
            accessibilityLabel="Delete this recording"
          >
            <Text style={[styles.label, { color: c.emergencyRed }]}>Delete</Text>
          </Pressable>
          {EVIDENCE_ACTIONS_ENABLED && (
            <View style={[styles.vaultRow, { marginTop: 8 }]}>
              {editingNoteId === item.id ? (
                <NoteEditor
                  initial={notesMap[item.id] || ''}
                  onSave={(t) => saveNote(item.id, t)}
                  onCancel={() => setEditingNoteId(null)}
                />
              ) : (
                <Pressable
                  testID={`recording-note-${item.id}`}
                  style={(s) => [styles.control, focusRingStyle(s)]}
                  onPress={() => setEditingNoteId(item.id)}
                  accessibilityRole="button"
                  accessibilityLabel={notesMap[item.id] ? `Edit note: ${notesMap[item.id].slice(0, 60)}` : 'Add note'}
                >
                  <Text style={styles.label}>
                    {notesMap[item.id] ? `Note: ${notesMap[item.id].slice(0, 60)}${notesMap[item.id].length > 60 ? '…' : ''}` : 'Add note'}
                  </Text>
                </Pressable>
              )}
              <Pressable
                testID={`recording-fir-${item.id}`}
                style={(s) => [styles.control, focusRingStyle(s)]}
                onPress={() => router.push({ pathname: '/fir-draft', params: { evidence_id: item.id, evidence_date: new Date(item.createdAt).toISOString(), evidence_type: item.type, evidence_note: notesMap[item.id] || '' } })}
                accessibilityRole="button"
                accessibilityLabel="Start FIR draft from this recording"
              >
                <Text style={[styles.label, { color: c.darkGold }]}>⚖️ Start FIR draft from this recording</Text>
              </Pressable>
            </View>
          )}
        </View>)}
        <Text testID="evidence-other-media-notice" style={styles.note}>Items are encrypted on this device (AES-256) and only decrypted briefly to preview, play or share. A PIN protects this screen itself. Scan a notice remains a separate tool, not evidence storage.</Text>
      </ScrollView>

      {/* Success banner — floats above the list so the confirmation of a
          delete is visible wherever the item sat in a long list. */}
      {!!toast && (
        <View style={[styles.toast, { bottom: insets.bottom + 16 }]} testID="evidence-delete-toast" accessibilityLiveRegion="polite">
          <Text style={styles.toastTxt}>{toast}</Text>
        </View>
      )}

      {/* One explicit confirmation, used for every item type. */}
      <Modal
        visible={!!deleteTarget}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!deleteBusy) { setDeleting(null); setDeleteError(''); } }}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => { if (!deleteBusy) { setDeleting(null); setDeleteError(''); } }}
          testID="recording-delete-backdrop"
        >
          <Pressable style={styles.modalCard} onPress={() => {}} testID="recording-delete-dialog">
            <Text style={styles.modalTitle}>Delete this recording?</Text>
            <Text style={styles.modalBody}>
              This permanently deletes this recording from this device. This cannot be undone. Once deleted, it cannot be retrieved.
            </Text>
            {!!deleteTarget && manifestMap[deleteTarget.id]?.backup && (
              <Text style={styles.modalBody} testID="recording-delete-cloud-note">
                This item was backed up to secure cloud storage — deleting it also deletes that cloud copy.
              </Text>
            )}
            {!!deleteError && (
              <Text style={styles.modalError} testID="recording-delete-error" accessibilityLiveRegion="polite">{deleteError}</Text>
            )}
            <Pressable
              testID={deleteTarget ? `recording-delete-confirm-${deleteTarget.id}` : 'recording-delete-confirm'}
              style={(s) => [styles.modalDanger, deleteBusy && { opacity: 0.6 }, focusRingStyle(s)]}
              disabled={deleteBusy}
              onPress={() => { if (deleteTarget) void remove(deleteTarget); }}
              accessibilityRole="button"
              accessibilityLabel="Delete"
              accessibilityState={{ disabled: deleteBusy, busy: deleteBusy }}
            >
              {deleteBusy
                ? <ActivityIndicator color={c.onBrandPrimary} />
                : <Text style={styles.modalDangerTxt}>Delete</Text>}
            </Pressable>
            <Pressable
              testID={deleteTarget ? `recording-keep-${deleteTarget.id}` : 'recording-keep'}
              style={(s) => [styles.modalKeep, focusRingStyle(s)]}
              disabled={deleteBusy}
              onPress={() => { setDeleting(null); setDeleteError(''); }}
              accessibilityRole="button"
              accessibilityLabel="Keep recording"
            >
              <Text style={styles.modalKeepTxt}>Keep</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      {/* B5 (Phase 0.5): Change PIN modal — requires current PIN */}
      <Modal visible={changePinVisible} transparent animationType="fade" onRequestClose={() => { if (!cpBusy) setChangePinVisible(false); }}>
        <Pressable style={styles.modalBackdrop} onPress={() => !cpBusy && setChangePinVisible(false)}>
          <Pressable style={styles.modalCard} onPress={e => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Change PIN</Text>
            <Text style={styles.modalBody}>{changePinLabel}</Text>
            <TextInput
              testID="cp-input"
              {...PIN_NO_AUTOFILL}
              style={styles.cpInput}
              value={changePinInput}
              onChangeText={t => { setCpError(''); setChangePinInput(t.replace(/\D/g, '').slice(0, 6)); }}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              editable={!cpBusy}
              autoFocus
            />
            {cpError ? <Text style={styles.modalError}>{cpError}</Text> : null}
            <Pressable
              testID="cp-next"
              style={(s) => [styles.button, focusRingStyle(s)]}
              disabled={cpBusy || changePinInput.length < 4}
              onPress={handleChangePinStep}
              accessibilityRole="button"
              accessibilityLabel="Next step"
            >
              {cpBusy ? <ActivityIndicator color={c.onBrandPrimary} /> : <Text style={styles.buttonText}>{cpStep === 'confirm' ? 'Save new PIN' : 'Next'}</Text>}
            </Pressable>
            <Pressable
              testID="cp-cancel"
              style={(s) => [styles.modalKeep, focusRingStyle(s)]}
              disabled={cpBusy}
              onPress={() => { setChangePinVisible(false); setCpCurrentInput(''); setCpNewInput(''); setCpConfirmInput(''); setCpStep('current'); setCpError(''); }}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={styles.modalKeepTxt}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background }, content: { padding: 16, gap: 18 },
  disabledBlock: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  disabledTitle: { fontFamily: theme.fonts.displayBold, fontSize: 17, color: c.ink, textAlign: 'center' },
  disabledBody: { fontFamily: theme.fonts.body, fontSize: 13, lineHeight: 20, color: c.muted, textAlign: 'center' },
  note: { fontFamily: theme.fonts.body, fontSize: 13, lineHeight: 20, color: c.muted },
  timer: { fontFamily: theme.fonts.bodyBold, fontSize: 19, color: c.emergencyRed },
  heading: { fontFamily: theme.fonts.displayBold, fontSize: 20, color: c.ink, marginTop: 10 },
  button: { minHeight: 48, backgroundColor: c.navy, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.onBrandPrimary },
  secondary: { borderRadius: 17, borderWidth: 1, borderColor: c.lines, padding: 15, backgroundColor: c.paper },
  label: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.navy },
  control: { minHeight: UI_REVISION_V1 ? 48 : 44, justifyContent: 'center', marginTop: 8 },
  toast: {
    position: 'absolute', left: 20, right: 20, backgroundColor: c.navy, borderRadius: 12,
    paddingVertical: 14, paddingHorizontal: 16,
  },
  toastTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 13, color: c.onBrandPrimary, textAlign: 'center' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(14,39,64,0.45)', justifyContent: 'center', padding: 16 },
  modalCard: { backgroundColor: c.paper, borderRadius: 17, padding: 16, gap: 12 },
  modalTitle: { fontFamily: theme.fonts.displayBold, fontSize: 18, color: c.ink },
  modalBody: { fontFamily: theme.fonts.body, fontSize: 13, lineHeight: 20, color: c.muted },
  modalError: { fontFamily: theme.fonts.bodyBold, fontSize: 13, lineHeight: 19, color: c.emergencyRed },
  modalDanger: { minHeight: 48, borderRadius: 12, backgroundColor: c.emergencyRed, alignItems: 'center', justifyContent: 'center' },
  modalDangerTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.onBrandPrimary },
  modalKeep: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: c.outlineBorder, alignItems: 'center', justifyContent: 'center' },
  modalKeepTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 15, color: c.navy },
  controlDanger: { borderRadius: 11, backgroundColor: c.dangerBg, paddingHorizontal: 10, borderWidth: 1, borderColor: c.dangerBorder },
  vaultRow: { marginTop: 4, gap: 6, borderTopWidth: 1, borderTopColor: c.lines, paddingTop: 8 },
  captureRow: { flexDirection: 'row', gap: 9 },
  captureBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 50 },
  thumb: { width: '100%', height: 160, borderRadius: 10, marginTop: 8, backgroundColor: c.lines },
  videoPlaceholder: { width: '100%', height: 100, borderRadius: 10, marginTop: 8, backgroundColor: c.lines, alignItems: 'center', justifyContent: 'center' },
  videoPreview: { width: '100%', height: 200, borderRadius: 10, marginTop: 8, backgroundColor: '#000' },
  heading2: { fontFamily: theme.fonts.displayBold, fontSize: 19, color: c.ink },
  note2: { fontFamily: theme.fonts.body, fontSize: 13, lineHeight: 18, color: c.muted, textAlign: 'center', marginTop: 8, marginBottom: 20 },
  pinInput: { fontFamily: theme.fonts.bodyBold, fontSize: 24, letterSpacing: 8, textAlign: 'center', borderWidth: 1, borderColor: c.lines, borderRadius: 12, padding: 14, width: 180, marginBottom: 12, color: c.ink },
  // B5 (Phase 0.5)
  // v2.2 phase 7 notice card (v2.2 tokens from phase 1).
  noticeCard: { backgroundColor: c.redBg, borderColor: c.redDeep, borderWidth: 1, borderRadius: theme.radius.cardLg, padding: 14, marginTop: 10, gap: 6 },
  noticeTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.redDeep },
  noticeBody: { fontFamily: theme.fonts.body, fontSize: 13, lineHeight: 18, color: c.ink },
  noticeDetail: { fontFamily: theme.fonts.body, fontSize: 12, lineHeight: 16, color: c.muted },
  changePinBtn: { alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: c.lines, minHeight: 48, justifyContent: 'center' },
  changePinText: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted },
  cpInput: { fontFamily: theme.fonts.bodyBold, fontSize: 22, letterSpacing: 8, textAlign: 'center', borderWidth: 1, borderColor: c.lines, borderRadius: 12, padding: 14, width: 180, marginVertical: 10, color: c.ink },
});