import { Linking, Platform } from 'react-native';
import * as SMS from 'expo-sms';

/** Opening a dialler/composer is not confirmation of a call or delivery. */
export async function openPhone(number: string): Promise<string> {
  try {
    await Linking.openURL(`tel:${number.replace(/[^+\d]/g, '')}`);
    return `Continue in your phone's dialler. If it did not open, dial ${number} manually. DHARA has not placed a call.`;
  } catch {
    return `This device could not open a dialler. Use a phone to dial ${number}.`;
  }
}

/** Opens the device's native SMS composer pre-filled with `message` — the
 * citizen must still tap Send themselves; DHARA never sends anything in the
 * background. Prefers expo-sms; falls back to a bare `sms:` Linking URL
 * where expo-sms isn't available (e.g. web preview, some emulators/data-only
 * devices), so the composer still opens either way. */
export async function composeAlert(phone: string, message: string): Promise<string> {
  const clean = phone.replace(/[^+\d]/g, '');
  try {
    const available = await SMS.isAvailableAsync();
    if (available) {
      await SMS.sendSMSAsync([clean], message);
      return 'Message prepared in your SMS app. Review it and press Send yourself — delivery is not confirmed; no automatic alert was sent.';
    }
  } catch { /* fall through to Linking below */ }
  const separator = Platform.OS === 'ios' ? '&' : '?';
  try {
    await Linking.openURL(`sms:${clean}${separator}body=${encodeURIComponent(message)}`);
    return 'Message prepared. Review it and press Send in your messaging app. Delivery is not confirmed; no automatic alert was sent.';
  } catch {
    return 'Messaging could not open. Copy the message below into your SMS app. No alert has been sent.';
  }
}