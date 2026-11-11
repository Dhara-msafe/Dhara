import { Platform } from 'react-native';
import { openExternal, composeSms, SIMULATED_TEXT } from '@/src/outbound';

/** Opening a dialler/composer is not confirmation of a call or delivery.
 *
 * B-14 — this used to pick its return text from OUTBOUND_LIVE alone, not
 * from what openExternal actually did. OUTBOUND_LIVE is only the master
 * switch; the per-channel build profile (internal_qa / closed_testing /
 * production) can still simulate the dialler while the master switch is
 * live (see outbound.ts's shouldDispatch/POLICY). In that combination the
 * old code took the "live" branch — "Continue in your phone's dialler…" —
 * right after openExternal's own guard had just shown a "Simulated —
 * nothing sent" alert and silently skipped opening anything: two
 * contradictory messages for the same tap. composeAlert already avoided
 * this by branching on composeSms's actual result; openPhone now does the
 * same by branching on openExternal's OpenResult ('opened' | 'blocked')
 * instead of re-deriving it from OUTBOUND_LIVE. */
export async function openPhone(number: string): Promise<string> {
  const clean = number.replace(/[^+\d]/g, '');
  try {
    const result = await openExternal(`tel:${clean}`);
    if (result === 'blocked') {
      return `${SIMULATED_TEXT}. QA mode — the dialler was not opened and no call was placed to ${number}.`;
    }
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
    const result = await composeSms([clean], message);
    if (result === 'composer') {
      return 'Message prepared in your SMS app. Review it and press Send yourself — delivery is not confirmed; no automatic alert was sent.';
    }
    // 'blocked' / 'simulated' — the guard already told the user why; never fall
    // back to a bare sms: link, which would bypass that decision.
    if (result === 'blocked' || result === 'simulated') {
      return 'No message was prepared — see the notice shown just now for the reason. Nothing left this device.';
    }
  } catch { /* fall through to sms: link below */ }
  const separator = Platform.OS === 'ios' ? '&' : '?';
  try {
    const opened = await openExternal(`sms:${clean}${separator}body=${encodeURIComponent(message)}`);
    if (opened !== 'opened') {
      return 'No message was prepared — see the notice shown just now for the reason. Nothing left this device.';
    }
    return 'Message prepared. Review it and press Send in your messaging app. Delivery is not confirmed; no automatic alert was sent.';
  } catch {
    return 'Messaging could not open. Copy the message below into your SMS app. No alert has been sent.';
  }
}
