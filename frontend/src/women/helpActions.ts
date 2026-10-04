import { Linking, Platform } from 'react-native';

/** Opening a dialler/composer is not confirmation of a call or delivery. */
export async function openPhone(number: string): Promise<string> {
  try {
    await Linking.openURL(`tel:${number.replace(/[^+\d]/g, '')}`);
    return `Continue in your phone's dialler. If it did not open, dial ${number} manually. DHARA has not placed a call.`;
  } catch {
    return `This device could not open a dialler. Use a phone to dial ${number}.`;
  }
}

export async function composeAlert(phone: string, message: string): Promise<string> {
  const separator = Platform.OS === 'ios' ? '&' : '?';
  try {
    await Linking.openURL(`sms:${phone.replace(/[^+\d]/g, '')}${separator}body=${encodeURIComponent(message)}`);
    return 'Message prepared. Review it and press Send in your messaging app. Delivery is not confirmed; no automatic alert was sent.';
  } catch {
    return 'Messaging could not open. Copy the message below into your SMS app. No alert has been sent.';
  }
}