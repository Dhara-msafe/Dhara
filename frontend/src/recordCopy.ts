/**
 * v2.2 rollout phase 7 — Record (Evidence Locker) error states.
 *
 * Two states get their own notice instead of the plain status line:
 * - micDenied: the microphone permission was refused
 * - saveFailed: stopping and saving threw
 *
 * Wording rules (v2.2): no guaranteed background recording, no promise the
 * recording is safe. The save-failed text says what the app actually does:
 * a temp recording is marked pending before saving (markPendingTemp) and the
 * screen retries pending ones the next time it opens (listPendingTemps), but
 * the phone may already have removed the file, so it is "tries", not "kept".
 * Used only when UI_V22_P7 is on.
 */
export type RecordNotice = 'micDenied' | 'saveFailed';

export const RECORD_NOTICES: Record<RecordNotice, { title: string; body: string }> = {
  micDenied: {
    title: 'Microphone is off for DHARA',
    body: 'Nothing is being recorded. Allow microphone access for DHARA in your phone settings (on a computer, in the browser’s site settings), then tap Record again.',
  },
  saveFailed: {
    title: 'This recording was not saved',
    body: 'If audio was captured, DHARA will try to save it again the next time you open Evidence Locker, but that is not guaranteed. Keep this screen open and record again if you can.',
  },
};
