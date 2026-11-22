/**
 * Labels for the My Data retention list (UI_V22_MYDATA). Known backend keys
 * get a written label; anything else falls back to sentence case with common
 * acronyms kept upper-case, so a new key never shows as "Fir Drafts".
 */
const KNOWN: Record<string, string> = {
  chat_history: 'Chat history',
  fir_drafts: 'FIR drafts',
  voice_recordings: 'Voice recordings',
  payment_records: 'Payment records',
  consent_records: 'Consent records',
  otp_logs: 'OTP logs',
};

const ACRONYMS = new Set(['fir', 'otp', 'sms', 'upi', 'id', 'pin', 'sos', 'pdf', 'cnr']);

export function retentionLabel(key: string): string {
  if (KNOWN[key]) return KNOWN[key];
  const words = key.split('_').filter(Boolean).map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.toLowerCase()));
  if (!words.length) return key;
  const first = words[0];
  words[0] = first === first.toUpperCase() ? first : first.charAt(0).toUpperCase() + first.slice(1);
  return words.join(' ');
}
