/**
 * QA Outbound Guard (client) — the ONLY place in the app allowed to launch
 * the dialler, SMS composer, e-mail/WhatsApp intents or the OS share sheet.
 *
 * EXPO_PUBLIC_OUTBOUND_MODE (baked in at build time):
 *   "live"  → identical behaviour to Linking.openURL / expo-sms / Share.share
 *   anything else (missing, empty, misspelt) → nothing leaves the device;
 *             the user sees "Simulated — nothing sent".
 * A static test (src/__tests__/outboundGuard.test.mjs) fails the build if any
 * file other than this one calls Linking.openURL, SMS.sendSMSAsync or
 * Share.share directly.
 */
import { Alert, Linking, Platform, Share, type ShareContent } from 'react-native';
import * as SMS from 'expo-sms';

export const OUTBOUND_LIVE = process.env.EXPO_PUBLIC_OUTBOUND_MODE === 'live';
export const SIMULATED_TEXT = 'Simulated — nothing sent';

const DISPATCH_SCHEME = /^\s*(tel|telprompt|sms|smsto|mms|mailto|whatsapp|intent|facetime|skype|viber|tg|fb-messenger):/i;
const DISPATCH_HOST = /^\s*https?:\/\/(wa\.me|api\.whatsapp\.com|t\.me)\b/i;

export function isDispatchUrl(url: string): boolean {
  return DISPATCH_SCHEME.test(url) || DISPATCH_HOST.test(url);
}

function showSimulated(detail: string) {
  const msg = `QA mode — no real call, message or share left this device.\n\n${detail}`;
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') window.alert(`${SIMULATED_TEXT}\n\n${msg}`);
  } else {
    Alert.alert(SIMULATED_TEXT, msg);
  }
}

/** Drop-in replacement for Linking.openURL. Non-dispatch links (https pages,
 * maps, app settings) open normally in every mode. */
export async function openExternal(url: string): Promise<void> {
  if (!OUTBOUND_LIVE && isDispatchUrl(url)) {
    showSimulated(url.length > 300 ? `${url.slice(0, 300)}…` : url);
    return;
  }
  await Linking.openURL(url);
}

export type SmsResult = 'composer' | 'unavailable' | 'simulated';

/** expo-sms composer (user still presses Send). */
export async function composeSms(recipients: string[], body: string): Promise<SmsResult> {
  if (!OUTBOUND_LIVE) {
    showSimulated(`SMS to ${recipients.join(', ') || '(no number)'}:\n${body}`);
    return 'simulated';
  }
  if (!(await SMS.isAvailableAsync())) return 'unavailable';
  await SMS.sendSMSAsync(recipients, body);
  return 'composer';
}

/** Drop-in replacement for Share.share. */
export async function shareExternal(content: ShareContent, options?: Parameters<typeof Share.share>[1]) {
  if (!OUTBOUND_LIVE) {
    const text = 'message' in content && content.message ? content.message : ('url' in content ? content.url ?? '' : '');
    showSimulated(`Share:\n${String(text).slice(0, 300)}`);
    return { action: Share.dismissedAction } as const;
  }
  return Share.share(content, options);
}
