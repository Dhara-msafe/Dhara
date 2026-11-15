/**
 * evidenceAutoRecord.ts — Phase 0.5 B1
 *
 * Module-level flag for the in-app auto-record intent.
 *
 * Replaces the ?record=1 URL-param approach so that an external deep-link or
 * a crafted URL can NEVER start the microphone:
 *
 *   - Only code that runs inside this JavaScript bundle can call
 *     setEvidenceAutoRecord(). An outside link cannot import this module.
 *   - The locker screen reads consumeEvidenceAutoRecord() (not URL params)
 *     to decide whether to auto-start. It still requires the locker to be
 *     unlocked (Phase 0.5 B1 guard).
 *
 * Reversible: to restore the old URL-param behaviour, delete this file and
 * revert the two callers (emergency.tsx and evidence-locker.tsx).
 */

let _pending = false;

/** Call this BEFORE navigating to the evidence locker when you want recording
 *  to start automatically after unlock. Only in-app code can call this. */
export function setEvidenceAutoRecord(): void {
  _pending = true;
}

/** Returns true (and resets the flag) if an in-app caller set the intent.
 *  Returns false for every subsequent call and for any path that never
 *  called setEvidenceAutoRecord(). */
export function consumeEvidenceAutoRecord(): boolean {
  if (_pending) {
    _pending = false;
    return true;
  }
  return false;
}
