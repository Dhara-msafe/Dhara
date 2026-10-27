/**
 * micArbiterGuard — thin, flag-gated glue between the app's existing recorders
 * and the pure AudioResourceArbiter (src/voice/core/audioResourceArbiter.ts).
 *
 * Behaviour:
 *   - Flag EXPO_PUBLIC_AUDIO_ARBITER_ENABLED !== 'true'  → claimMic() is a
 *     no-op that always grants. The app behaves EXACTLY as it does today.
 *   - Flag on → claimMic() routes through the single shared micArbiter so only
 *     one screen can hold the microphone at a time; the Evidence Locker always
 *     wins and preempts any other owner via its onPreempt callback.
 *
 * Each caller claims before it starts its recorder (expo-audio record() or web
 * MediaRecorder start) and releases on every stop / error / unmount path.
 */
import { micArbiter, type MicOwner } from './core/audioResourceArbiter';

export const MIC_ARBITER_ENABLED = process.env.EXPO_PUBLIC_AUDIO_ARBITER_ENABLED === 'true';

export type MicLease = {
  /** True when the caller may start recording. */
  ok: boolean;
  /** When ok=false, which owner currently holds the mic. */
  heldBy?: MicOwner;
  /** True when the blocker is specifically the Evidence Locker. */
  blockedByEvidenceLocker?: boolean;
  /** Give the mic back. Safe to call more than once. */
  release: () => void;
};

const GRANTED_NOOP: MicLease = { ok: true, release: () => {} };

/**
 * Claim the shared microphone for `owner`. `onPreempt` fires synchronously if
 * the Evidence Locker later takes the mic — stop your recorder there.
 */
export function claimMic(owner: MicOwner, onPreempt?: () => void): MicLease {
  if (!MIC_ARBITER_ENABLED) return GRANTED_NOOP;
  const res = micArbiter.claim(owner, onPreempt);
  if (!res.ok) {
    return {
      ok: false,
      heldBy: res.holder,
      blockedByEvidenceLocker: res.reason === 'held_by_evidence_locker',
      release: () => {},
    };
  }
  const claim = res.claim;
  return { ok: true, release: () => micArbiter.release(claim) };
}

/** Shown when another part of DHARA is already using the microphone. */
export const MIC_BUSY_MESSAGE =
  'The microphone is being used by another part of DHARA right now. Please finish that first, then try again.';

/**
 * BATCH A1 — Evidence Locker audio-session fix.
 *
 * Claim `owner`'s mic lease FIRST, then run `fn` — which must contain every
 * call that touches the shared OS audio session (setAudioModeAsync,
 * prepareToRecordAsync, record()) — ONLY once the lease is confirmed granted.
 *
 * Every mic-start call site in the app used to call setAudioModeAsync BEFORE
 * checking claimMic(), so even when the lease check correctly failed a moment
 * later (Evidence Locker already recording), the global audio session had
 * already been reconfigured — expo-audio's setAudioModeAsync is process-wide,
 * not per-recorder, and can corrupt or halt an unrelated in-progress
 * recording. This helper makes that ordering mistake impossible: `fn` simply
 * never runs when the lease is denied.
 */
export async function withMicLease<T>(
  owner: MicOwner,
  onPreempt: (() => void) | undefined,
  fn: () => Promise<T>,
): Promise<
  | { ok: true; lease: MicLease; result: T }
  | { ok: false; heldBy?: MicOwner; blockedByEvidenceLocker?: boolean }
> {
  const lease = claimMic(owner, onPreempt);
  if (!lease.ok) {
    return { ok: false, heldBy: lease.heldBy, blockedByEvidenceLocker: lease.blockedByEvidenceLocker };
  }
  try {
    const result = await fn();
    return { ok: true, lease, result };
  } catch (e) {
    lease.release();
    throw e;
  }
}

/**
 * Rollback switch for the BATCH A1 guard (withMicLease ordering + the
 * isMicHeldByEvidenceLocker() TTS fail-closed check below). Defaults to
 * enabled, matching the arbiter's own always-on default — flip to 'false'
 * to instantly disable just this guard without a code revert.
 */
export const MIC_LEASE_GUARD_ENABLED = process.env.EXPO_PUBLIC_MIC_LEASE_GUARD_ENABLED !== 'false';

/**
 * True when the Evidence Locker currently owns the shared microphone.
 *
 * TTS playback — and any other code about to call setAudioModeAsync with
 * allowsRecording:false, or otherwise touch the global audio session —
 * MUST check this first and skip the call entirely (fail closed) when true.
 * TTS does not need to own the mic to play audio; it only needs to avoid
 * reconfiguring the shared session while the Locker legitimately owns it.
 */
export function isMicHeldByEvidenceLocker(): boolean {
  // Fail-closed ordering (Fix 2 — H2b):
  //   1. Guard disabled explicitly → allow TTS (opt-out respected).
  //   2. Guard on but arbiter off → cannot verify; fail closed (block TTS).
  //   3. Both on → check the live arbiter owner.
  if (!MIC_LEASE_GUARD_ENABLED) return false;
  if (!MIC_ARBITER_ENABLED) return true;
  return micArbiter.currentOwner === 'evidence_locker';
}

/** Shown when TTS/audio-mode changes are skipped because the Evidence Locker is recording. */
export const TTS_BLOCKED_BY_LOCKER_MESSAGE =
  'Voice playback is paused while Evidence Locker is recording.';
