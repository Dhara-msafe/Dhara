/**
 * Evidence Locker PIN boxes (owner GO, 22 Nov).
 *
 * PIN boxes are one-time codes, not passwords: these props stop Chrome /
 * Android / iOS autofill, which drew dots in the box that never reached app
 * state (Unlock then said "Enter at least 4 digits").
 */
export const PIN_NO_AUTOFILL = {
  autoComplete: 'one-time-code' as const,
  textContentType: 'oneTimeCode' as const,
  importantForAutofill: 'no' as const,
};

/**
 * The PIN to use on submit: React state, or — on web, when the browser
 * autofilled the box without firing a change event — the box's real DOM
 * value (Chrome releases it on the user's tap), but only if that value is
 * exactly 4–6 digits. Anything else (e.g. an autofilled account password)
 * is ignored and the state value is used. Pure (no react-native import) so
 * it can be unit-tested; the screen passes Platform.OS.
 */
export function pinFromBox(statePin: string, box: unknown, os: string): string {
  if (os !== 'web') return statePin;
  const raw = String((box as { value?: unknown } | null)?.value ?? '');
  if (/^\d{4,6}$/.test(raw) && raw.length > statePin.length) return raw;
  return statePin;
}
