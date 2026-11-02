/**
 * safetyTriggerCoordinator.ts — Item D
 *
 * Two entry points:
 *   triggerSafetySequence()   — phrase detected in Ask DHARA
 *                               gated: EXPO_PUBLIC_SAFE_WORD_V1
 *   triggerFromSilentAlert()  — user tapped "Prepare SMS" with evidence toggle ON
 *                               gated: EXPO_PUBLIC_SILENT_ALERT_EVIDENCE_V1
 *
 * Both write only timestamps + action codes to the audit log (NEVER the phrase).
 * If any step fails it is logged and skipped — the sequence never throws.
 */
import { appendAuditEntry } from './privacyAuditLog';

export interface TriggerCallbacks {
  /** Start recording via EvidenceRecorderProvider.startTriggerRecording(). */
  startEvidenceRecording?: (scope: string) => Promise<boolean>;
  /** Navigate to /women/silent-alert (phrase path only). */
  navigateToSilentAlert?: () => void;
  /** User scope (user ID or 'device'). */
  scope: string;
}

export interface TriggerResult {
  evidenceStarted: boolean;
  alertNavigated: boolean;
  flagOff: boolean;
}

/** Called when code phrase is detected in Ask DHARA. */
export async function triggerSafetySequence(
  callbacks: TriggerCallbacks,
): Promise<TriggerResult> {
  // Default-ON safety gate: the SOS code phrase is a shipped safety feature, so
  // it stays active unless a build EXPLICITLY sets the flag to 'false'. A missing
  // build-time env var must NEVER silently disable it.
  if (process.env.EXPO_PUBLIC_SAFE_WORD_V1 === 'false') {
    return { evidenceStarted: false, alertNavigated: false, flagOff: true };
  }
  await appendAuditEntry('CODE_PHRASE_TRIGGERED');

  let evidenceStarted = false;
  if (callbacks.startEvidenceRecording) {
    await appendAuditEntry('EVIDENCE_START_REQUESTED');
    try {
      evidenceStarted = await callbacks.startEvidenceRecording(callbacks.scope);
      await appendAuditEntry(evidenceStarted ? 'EVIDENCE_STARTED' : 'EVIDENCE_START_FAILED');
    } catch {
      await appendAuditEntry('EVIDENCE_START_FAILED');
    }
  }

  // Navigation to the (silent, non-PIN) Silent Alert screen is the core visible
  // outcome of an SOS phrase match — it must happen regardless of whether the
  // optional evidence recorder started, so the user always gets a reachable
  // screen to prepare their alert from.
  let alertNavigated = false;
  if (callbacks.navigateToSilentAlert) {
    try { callbacks.navigateToSilentAlert(); alertNavigated = true; } catch {}
  }

  return { evidenceStarted, alertNavigated, flagOff: false };
}

/**
 * Called when the user taps "Prepare SMS" in Silent Alert with evidence toggle ON.
 * Gated by EXPO_PUBLIC_SILENT_ALERT_EVIDENCE_V1.
 */
export async function triggerFromSilentAlert(
  callbacks: Pick<TriggerCallbacks, 'startEvidenceRecording' | 'scope'>,
): Promise<TriggerResult> {
  if (process.env.EXPO_PUBLIC_SILENT_ALERT_EVIDENCE_V1 !== 'true') {
    return { evidenceStarted: false, alertNavigated: false, flagOff: true };
  }
  await appendAuditEntry('SILENT_ALERT_TRIGGERED');

  let evidenceStarted = false;
  if (callbacks.startEvidenceRecording) {
    await appendAuditEntry('EVIDENCE_START_REQUESTED');
    try {
      evidenceStarted = await callbacks.startEvidenceRecording(callbacks.scope);
      await appendAuditEntry(evidenceStarted ? 'EVIDENCE_STARTED' : 'EVIDENCE_START_FAILED');
    } catch {
      await appendAuditEntry('EVIDENCE_START_FAILED');
    }
  }
  return { evidenceStarted, alertNavigated: false, flagOff: false };
}
