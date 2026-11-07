/**
 * Family Journey — Phase 2 real delivery.
 *
 * TRUTH RULES (do not break):
 *  - DHARA never sends a message by itself. The student's own SMS app opens
 *    with the text ready and the student presses Send.
 *  - One contact at a time. No group SMS, no silent bulk dispatch.
 *  - Every dispatch goes through the Outbound Guard (src/outbound.ts), so QA
 *    builds still show "Simulated — nothing sent" instead of opening anything.
 *  - Nothing here touches location. Phase 3 covers temporary location sharing.
 */
import { composeSms, openExternal } from '../outbound';
import { smsBody } from './previewCopy';
import type { PreviewMode } from './previewCopy';
import type { Journey, JourneyContact } from './store';

export { FJ_SEND_ENABLED } from './flags';

export type SendOutcome =
  /** The SMS app opened with the text ready — the student still presses Send. */
  | 'composer'
  /** A safety rail or QA mode refused it; the guard already explained why. */
  | 'blocked'
  /** The SMS app could not be opened at all. */
  | 'failed';

/** Open the student's SMS app for exactly one contact. */
export async function sendToContact(
  ct: JourneyContact,
  mode: PreviewMode,
  journey: Journey,
): Promise<SendOutcome> {
  const body = smsBody(mode, journey);
  try {
    const result = await composeSms([ct.phone], body);
    if (result === 'composer') return 'composer';
    if (result === 'blocked' || result === 'simulated') return 'blocked';
    // 'unavailable' — no SMS module (e.g. web). Fall back to the sms: deep
    // link, still through the guard so the same rails apply.
    const opened = await openExternal(`sms:${ct.phone}?body=${encodeURIComponent(body)}`);
    return opened === 'opened' ? 'composer' : 'blocked';
  } catch {
    return 'failed';
  }
}
