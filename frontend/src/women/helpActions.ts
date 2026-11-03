import { Platform } from 'react-native';
import { openExternal, composeSms, OUTBOUND_LIVE, SIMULATED_TEXT } from '@/src/outbound';

/** Opening a dialler/composer is not confirmation of a call or delivery. */
export async function openPhone(number: string): Promise<string> {
  if (!OUTBOUND_LIVE) {
    await openExternal(`tel:${number.replace(/[^+\d]/g, '')}`);
    return `${SIMULATED_TEXT}. QA mode — the dialler was not opened and no call was placed to ${number}.`;
  }
  try {
    await openExternal(`tel:${number.replace(/[^+\d]/g, '')}`);
    return `Continue in your phone's dialler. If it did not open, dial ${number} manually. DHARA has not placed a call.`;
  } catch {
    return `This device could not open a dialler. Use a phone to dial ${number}.`;
  }
}

/** Opens the device's native SMS composer pre-filled with `message` — the
 * citizen must still tap Send themselves; DHARA never sends anything in the
 * background. Prefers expo-sms; falls back to a bare `sms:` link where
 * expo-sms isn't available (e.g. web preview, some emulators/data-only
 * devices), so the composer still opens either way. In QA (outbound mode not
 * "live") nothing is opened and the user sees "Simulated — nothing sent". */
export async function composeAlert(phone: string, message: string): Promise<string> {
  const clean = phone.replace(/[^+\d]/g, '');
  if (!OUTBOUND_LIVE) {
    await composeSms([clean], message);
    return `${SIMULATED_TEXT}. QA mode — no SMS app was opened and no alert left this device.`;
  }
  try {
    if ((await composeSms([clean], message)) === 'composer') {
      return 'Message prepared in your SMS app. Review it and press Send yourself — delivery is not confirmed; no automatic alert was sent.';
    }
  } catch { /* fall through to sms: link below */ }
  const separator = Platform.OS === 'ios' ? '&' : '?';
  try {
    await openExternal(`sms:${clean}${separator}body=${encodeURIComponent(message)}`);
    return 'Message prepared. Review it and press Send in your messaging app. Delivery is not confirmed; no automatic alert was sent.';
  } catch {
    return 'Messaging could not open. Copy the message below into your SMS app. No alert has been sent.';
  }
}
