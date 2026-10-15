/**
 * EvidenceRecorderProvider.tsx — Item A
 *
 * Holds the single useAudioRecorder instance for evidence recording, mounted
 * at the root layout level so recording survives navigation. This decouples
 * the recorder lifecycle from the evidence-locker.tsx screen component so the
 * Safety Trigger Coordinator can start recording even when the locker is not
 * open.
 *
 * ARCHITECTURE RULES:
 *   — Do NOT put useAudioRecorder in Zustand (violates React hooks rules).
 *   — This provider is the single owner of the evidence recorder.
 *   — EvidenceLocker screen gets the recorder via useEvidenceRecorder().
 *   — SafetyTriggerCoordinator calls startTriggerRecording() from context.
 *
 * RecordingOwner tracks who started the current session:
 *   'locker'  = started from EvidenceLocker screen (user-initiated)
 *   'trigger' = started by SafetyTriggerCoordinator (phrase-detected)
 *   null      = idle
 *
 * PRIVACY CONTRACT: No audio data leaves the device. All saves use
 * evidenceStore.ts (AES-256 per item).
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';
import { Platform } from 'react-native';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { claimMic, type MicLease } from '@/src/voice/micArbiterGuard';

type RecordingOwner = 'locker' | 'trigger' | null;

export interface EvidenceRecorderContextValue {
  /** The shared AudioRecorder instance (pass to recorder.* calls). */
  recorder: ReturnType<typeof useAudioRecorder>;
  /** Live recorder state polled at 250 ms (isRecording, durationMillis, …). */
  recorderState: ReturnType<typeof useAudioRecorderState>;
  /** Who started the current recording session. */
  recordingOwner: RecordingOwner;
  /**
   * Start evidence recording on behalf of the safety trigger.
   * Returns true if recording started successfully.
   * Returns false if already recording or microphone permission denied.
   */
  startTriggerRecording: (scope: string) => Promise<boolean>;
  /** Stop and discard a trigger-owned recording (coordinator cleanup). */
  stopTriggerRecording: () => Promise<void>;
  /**
   * EvidenceLocker claims recorder ownership before it starts recording.
   * Returns false when the trigger already owns the session — locker should
   * show the in-progress recording status rather than start a new one.
   */
  claimForLocker: () => boolean;
  /** EvidenceLocker releases its claim (called in cancel / cleanup). */
  releaseLockerClaim: () => void;
  /**
   * Stable ref-based getter — reads ownerRef.current without causing a
   * re-render.  Use inside cancel/save deps instead of recordingOwner state
   * so that ownership transitions never re-create those callbacks and never
   * re-run useFocusEffect (fix d).
   */
  getOwner: () => RecordingOwner;
}

const EvidenceRecorderContext = createContext<EvidenceRecorderContextValue | null>(null);

export function EvidenceRecorderProvider({ children }: { children: React.ReactNode }) {
  const recorder      = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);

  const ownerRef = useRef<RecordingOwner>(null);
  const [recordingOwner, setRecordingOwner] = useState<RecordingOwner>(null);

  // Global single-owner mic arbiter lease ('evidence_locker'). Noop when flag OFF.
  const arbiterLeaseRef = useRef<MicLease | null>(null);
  const claimArbiter = useCallback(() => {
    if (arbiterLeaseRef.current?.ok) return; // already holding
    arbiterLeaseRef.current = claimMic('evidence_locker'); // always wins; preempts others
  }, []);
  const releaseArbiter = useCallback(() => {
    arbiterLeaseRef.current?.release();
    arbiterLeaseRef.current = null;
  }, []);

  const setOwner = useCallback((o: RecordingOwner) => {
    ownerRef.current = o;
    setRecordingOwner(o);
  }, []);

  // ── Safety Trigger path ────────────────────────────────────────────────────
  const startTriggerRecording = useCallback(async (_scope: string): Promise<boolean> => {
    // Never interrupt an in-progress session (locker or trigger).
    if (ownerRef.current !== null) return false;
    try {
      let perm = await AudioModule.getRecordingPermissionsAsync();
      if (!perm.granted) {
        perm = await AudioModule.requestRecordingPermissionsAsync();
      }
      if (!perm.granted) return false;

      if (Platform.OS !== 'web') {
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
          shouldPlayInBackground: false,
        });
      }
      await recorder.prepareToRecordAsync();
      claimArbiter(); // Evidence Locker takes the shared mic (preempts any other owner)
      recorder.record();
      setOwner('trigger');
      return true;
    } catch {
      releaseArbiter();
      return false;
    }
  }, [recorder, setOwner, claimArbiter, releaseArbiter]);

  const stopTriggerRecording = useCallback(async () => {
    if (ownerRef.current !== 'trigger') return;
    setOwner(null);
    try { await recorder.stop(); } catch {}
    releaseArbiter();
    if (Platform.OS !== 'web') {
      try { await setAudioModeAsync({ allowsRecording: false }); } catch {}
    }
    // Async audit log — import lazily to avoid circular deps
    import('./privacyAuditLog').then(m => m.appendAuditEntry('EVIDENCE_STOPPED')).catch(() => {});
  }, [recorder, setOwner]);

  // ── EvidenceLocker path ────────────────────────────────────────────────────
  const claimForLocker = useCallback((): boolean => {
    if (ownerRef.current === 'trigger') return false; // trigger owns it
    claimArbiter(); // Evidence Locker takes the shared mic (preempts any other owner)
    setOwner('locker');
    return true;
  }, [setOwner, claimArbiter]);

  const releaseLockerClaim = useCallback(() => {
    if (ownerRef.current === 'locker') { setOwner(null); releaseArbiter(); }
  }, [setOwner, releaseArbiter]);

  // FIX (d): stable getter so callers never need recordingOwner state in deps.
  const getOwner = useCallback((): RecordingOwner => ownerRef.current, []);

  return (
    <EvidenceRecorderContext.Provider
      value={{
        recorder,
        recorderState,
        recordingOwner,
        startTriggerRecording,
        stopTriggerRecording,
        claimForLocker,
        releaseLockerClaim,
        getOwner,
      }}
    >
      {children}
    </EvidenceRecorderContext.Provider>
  );
}

/**
 * Consume the shared evidence recorder.
 * Must be rendered inside <EvidenceRecorderProvider>.
 */
export function useEvidenceRecorder(): EvidenceRecorderContextValue {
  const ctx = useContext(EvidenceRecorderContext);
  if (!ctx) {
    throw new Error('useEvidenceRecorder must be called inside <EvidenceRecorderProvider>');
  }
  return ctx;
}
