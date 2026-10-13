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
