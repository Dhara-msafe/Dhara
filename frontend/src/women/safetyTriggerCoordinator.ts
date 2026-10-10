/**
 * safetyTriggerCoordinator.ts — Item D
 *
 * Orchestrates the safety action sequence when a code phrase is detected in
 * Ask DHARA. Guarded behind EXPO_PUBLIC_SAFE_WORD_V1 (default: false).
 *
 * Call order:
 *   1. Log PHRASE_DETECTED to privacy audit log (timestamp only, no phrase).
 *   2. Start evidence recording via the EvidenceRecorderProvider callback.
 *   3. Navigate to Silent Alert if EXPO_PUBLIC_SILENT_ALERT_EVIDENCE_V1=true.
 *
 * If any step fails it is logged and skipped — the sequence never throws.
 */
import { appendAuditEntry } from './privacyAuditLog';

export interface TriggerCallbacks {
  /** Start recording via EvidenceRecorderProvider.startTriggerRecording(). */
  startEvidenceRecording?: (scope: string) => Promise<boolean>;
  /** Navigate to /women/silent-alert. */
  navigateToSilentAlert?: () => void;
  /** User scope (user ID or 'device'). */
  scope: string;
}

export interface TriggerResult {
  evidenceStarted: boolean;
  alertNavigated: boolean;
  /** true when the feature flag is off (nothing was done). */
  flagOff: boolean;
}

export async function triggerSafetySequence(
  callbacks: TriggerCallbacks,
): Promise<TriggerResult> {
  // Feature gate — default OFF in Phase 1
  if (process.env.EXPO_PUBLIC_SAFE_WORD_V1 !== 'true') {
    return { evidenceStarted: false, alertNavigated: false, flagOff: true };
  }

  // 1. Audit entry (timestamp only, phrase is NEVER written here)
  await appendAuditEntry('PHRASE_DETECTED');

  // 2. Start evidence recording (best-effort)
  let evidenceStarted = false;
  if (callbacks.startEvidenceRecording) {
    try {
      evidenceStarted = await callbacks.startEvidenceRecording(callbacks.scope);
      await appendAuditEntry(evidenceStarted ? 'EVIDENCE_STARTED' : 'EVIDENCE_START_FAILED');
    } catch {
      await appendAuditEntry('EVIDENCE_START_FAILED');
    }
  }

  // 3. Navigate to Silent Alert (only if SILENT_ALERT_EVIDENCE flag is true)
  let alertNavigated = false;
  if (
    process.env.EXPO_PUBLIC_SILENT_ALERT_EVIDENCE_V1 === 'true' &&
    callbacks.navigateToSilentAlert
  ) {
    try {
      callbacks.navigateToSilentAlert();
      alertNavigated = true;
      await appendAuditEntry('ALERT_NAVIGATED');
    } catch {
      /* navigation failure must not crash the app */
    }
  }

  return { evidenceStarted, alertNavigated, flagOff: false };
}
