/**
 * Outbound Guard (client) — the ONLY place in the app allowed to launch the
 * dialler, SMS composer, e-mail / WhatsApp intents or the OS share sheet.
 *
 * Two layered controls, mirroring backend/services/outbound_guard.py:
 *
 *   EXPO_PUBLIC_OUTBOUND_MODE     "live" = master switch ON; anything else =
 *                                 everything simulated ("nothing sent").
 *   EXPO_PUBLIC_OUTBOUND_PROFILE  internal_qa | closed_testing | production —
 *                                 per-channel policy. A profile can only
 *                                 RESTRICT a dispatch, never enable one the
 *                                 master switch has not allowed.
 *
 * Channels handled here: DIALLER (tel:), SMS (sms:), EXTERNAL_SHARE (share
 * sheet, mailto:, whatsapp/telegram deep links).
 *
 * A static test (src/__tests__/outboundGuard.test.mjs) fails the build if any
 * file other than this one calls Linking.openURL, SMS.sendSMSAsync or
 * Share.share directly.
 */
import { Alert, Linking, Platform, Share, type ShareContent } from 'react-native';
import * as SMS from 'expo-sms';

export type Channel = 'dialler' | 'sms' | 'external_share';
export type Decision = 'live' | 'simulate' | 'disabled';
type Profile = 'internal_qa' | 'closed_testing' | 'production';

export const OUTBOUND_LIVE = process.env.EXPO_PUBLIC_OUTBOUND_MODE === 'live';
export const SIMULATED_TEXT = 'Simulated — nothing sent';

const VALID_PROFILES: Profile[] = ['internal_qa', 'closed_testing', 'production'];
const _rawProfile = (process.env.EXPO_PUBLIC_OUTBOUND_PROFILE || '') as Profile;
export const OUTBOUND_PROFILE: Profile = VALID_PROFILES.includes(_rawProfile)
  ? _rawProfile
  : (OUTBOUND_LIVE ? 'production' : 'internal_qa');

const POLICY: Record<Profile, Record<Channel, Decision>> = {
  internal_qa:    { dialler: 'simulate', sms: 'simulate', external_share: 'simulate' },
  closed_testing: { dialler: 'live',     sms: 'live',     external_share: 'live' },
  production:     { dialler: 'live',     sms: 'live',     external_share: 'live' },
};

export function channelDecision(channel: Channel): Decision {
  return POLICY[OUTBOUND_PROFILE][channel];
}

/** A real dispatch happens only when the master switch is live AND the active
 * profile marks the channel live. */
export function shouldDispatch(channel: Channel): boolean {
  return OUTBOUND_LIVE && channelDecision(channel) === 'live';
}

export function outboundPolicySnapshot() {
  return {
    mode: OUTBOUND_LIVE ? 'live' : 'simulate',
    profile: OUTBOUND_PROFILE,
    channels: {
      dialler: shouldDispatch('dialler') ? 'live' : channelDecision('dialler'),
      sms: shouldDispatch('sms') ? 'live' : channelDecision('sms'),
      external_share: shouldDispatch('external_share') ? 'live' : channelDecision('external_share'),
    },
  };
}

const DIALLER_SCHEME = /^\s*(tel|telprompt|facetime|skype|viber):/i;
const SMS_SCHEME = /^\s*(sms|smsto|mms):/i;
const SHARE_SCHEME = /^\s*(mailto|whatsapp|intent|fb-messenger|tg):/i;
const SHARE_HOST = /^\s*https?:\/\/(wa\.me|api\.whatsapp\.com|t\.me)\b/i;

/** Emergency-service short codes — SMS must NEVER be auto-composed to these
 * (dialler to them is allowed; the user initiates the call). */
const EMERGENCY_NUMBERS = new Set([
  '112', '100', '101', '102', '108', '1091', '1098', '181', '1930', '139', '1073',
]);

// Verified test contacts for closed-testing SMS (comma-separated E.164 / local).
const SMS_TEST_CONTACTS = (process.env.EXPO_PUBLIC_SMS_TEST_CONTACTS || '')
  .split(',').map((s) => s.replace(/[^\d+]/g, '')).filter(Boolean);

function normNum(n: string): string {
  return (n || '').replace(/[^\d+]/g, '');
}

export function channelForUrl(url: string): Channel | null {
  if (DIALLER_SCHEME.test(url)) return 'dialler';
  if (SMS_SCHEME.test(url)) return 'sms';
  if (SHARE_SCHEME.test(url) || SHARE_HOST.test(url)) return 'external_share';
  return null;
}

export function isDispatchUrl(url: string): boolean {
  return channelForUrl(url) !== null;
}

function showSimulated(detail: string, disabled = false) {
  const head = disabled ? 'Disabled in this build' : SIMULATED_TEXT;
  const msg = `QA mode — no real call, message or share left this device.\n\n${detail}`;
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') window.alert(`${head}\n\n${msg}`);
  } else {
    Alert.alert(head, msg);
  }
}

/** A live-mode safety rail refused this dispatch — not a QA simulation. */
function showBlocked(detail: string) {
  const head = 'Blocked for your safety';
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') window.alert(`${head}\n\n${detail}`);
  } else {
    Alert.alert(head, detail);
  }
}

/** Drop-in replacement for Linking.openURL. Non-dispatch links (https pages,
 * maps, app settings) open normally in every mode. */
export type OpenResult = 'opened' | 'blocked';

export async function openExternal(url: string): Promise<OpenResult> {
  const channel = channelForUrl(url);
  if (channel && !shouldDispatch(channel)) {
    showSimulated(url.length > 300 ? `${url.slice(0, 300)}…` : url, channelDecision(channel) === 'disabled');
    return 'blocked';
  }
  // An `sms:` deep link must obey the same rails as composeSms() — otherwise a
  // caller could bypass the verified-test-contact list simply by opening a link.
  if (channel === 'sms') {
    const target = url.replace(/^\s*(sms|smsto|mms):/i, '').split(/[?&#]/)[0];
    const nums = target.split(/[,;]/).map(normNum).filter(Boolean);
    if (nums.some((n) => EMERGENCY_NUMBERS.has(n))) {
      showBlocked('SMS to an emergency-service number is blocked. Use the dialler to call instead.');
      return 'blocked';
    }
    if (OUTBOUND_PROFILE === 'closed_testing') {
      if (SMS_TEST_CONTACTS.length === 0 || nums.length === 0 || !nums.every((n) => SMS_TEST_CONTACTS.includes(n))) {
        showBlocked(`Closed-testing SMS is limited to verified test contacts.\nTo: ${target || '(no number)'}`);
        return 'blocked';
      }
    }
  }
  await Linking.openURL(url);
  return 'opened';
}

export type SmsResult = 'composer' | 'unavailable' | 'simulated' | 'blocked';

/** expo-sms composer (user still presses Send). In closed_testing SMS is only
 * allowed to explicitly configured verified test contacts, and never to an
 * emergency-service number. */
export async function composeSms(recipients: string[], body: string): Promise<SmsResult> {
  const nums = recipients.map(normNum);
  if (!shouldDispatch('sms')) {
    showSimulated(`SMS to ${recipients.join(', ') || '(no number)'}:\n${body}`, channelDecision('sms') === 'disabled');
    return 'simulated';
  }
  // Live path — enforce safety rails.
  if (nums.some((n) => EMERGENCY_NUMBERS.has(n))) {
    showBlocked('SMS to an emergency-service number is blocked. Use the dialler to call instead.');
    return 'blocked';
  }
  if (OUTBOUND_PROFILE === 'closed_testing') {
    if (SMS_TEST_CONTACTS.length === 0 || !nums.every((n) => SMS_TEST_CONTACTS.includes(n))) {
      showBlocked(`Closed-testing SMS is limited to verified test contacts.\nTo: ${recipients.join(', ')}`);
      return 'blocked';
    }
  }
  if (!(await SMS.isAvailableAsync())) return 'unavailable';
  await SMS.sendSMSAsync(recipients, body);
  return 'composer';
}

/** Drop-in replacement for Share.share. */
export async function shareExternal(content: ShareContent, options?: Parameters<typeof Share.share>[1]) {
  if (!shouldDispatch('external_share')) {
    const text = 'message' in content && content.message ? content.message : ('url' in content ? content.url ?? '' : '');
    showSimulated(`Share:\n${String(text).slice(0, 300)}`, channelDecision('external_share') === 'disabled');
    return { action: Share.dismissedAction } as const;
  }
  return Share.share(content, options);
}
