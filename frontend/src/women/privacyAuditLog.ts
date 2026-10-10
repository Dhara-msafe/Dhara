/**
 * privacyAuditLog.ts — Item E
 *
 * Minimal local-only, append-only audit log for safety trigger events.
 *
 * PRIVACY CONTRACT:
 *   — Stores ONLY ISO timestamps and action codes — NEVER the phrase itself.
 *   — Capped at MAX_ENTRIES (200). Oldest trimmed first.
 *   — Never transmitted off-device.
 *   — Failures are silently swallowed so they never block safety actions.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const AUDIT_KEY   = 'ws_privacy_audit_v1';
const MAX_ENTRIES = 200;

export type AuditAction =
  | 'CODE_PHRASE_CONFIGURED'    // phrase set for the first time
  | 'CODE_PHRASE_CHANGED'       // existing phrase updated
  | 'CODE_PHRASE_CLEARED'       // phrase removed / disarmed
  | 'CODE_PHRASE_ARMED'         // phrase stored and ready to match
  | 'CODE_PHRASE_DISARMED'      // phrase removed, matching disabled
  | 'CODE_PHRASE_TRIGGERED'     // phrase matched in send()
  | 'SILENT_ALERT_TRIGGERED'    // silent alert prepare-SMS tapped with evidence ON
  | 'EVIDENCE_START_REQUESTED'  // before calling startEvidenceRecording
  | 'EVIDENCE_STARTED'          // recording started successfully
  | 'EVIDENCE_START_FAILED'     // recording failed to start
  | 'EVIDENCE_STOPPED';         // recording stopped via coordinator

export type AuditEntry = {
  ts: string;       // ISO-8601 timestamp
  action: AuditAction;
};

export async function appendAuditEntry(action: AuditAction): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(AUDIT_KEY);
    const entries: AuditEntry[] = raw ? JSON.parse(raw) : [];
    entries.push({ ts: new Date().toISOString(), action });
    const trimmed = entries.slice(-MAX_ENTRIES);
    await AsyncStorage.setItem(AUDIT_KEY, JSON.stringify(trimmed));
  } catch {
    // Audit log failure must NEVER block safety actions.
  }
}

export async function readAuditLog(): Promise<AuditEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(AUDIT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function clearAuditLog(): Promise<void> {
  await AsyncStorage.removeItem(AUDIT_KEY).catch(() => {});
}
