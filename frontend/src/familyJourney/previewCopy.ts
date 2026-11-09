/**
 * Family Journey — exact contact-facing wording, Phase 1.
 *
 * These strings are what a contact WOULD receive in a later phase. In Phase 1
 * they are only ever rendered on the student's own device, under the
 * PREVIEW_LABEL. Do not soften, dramatise, or add safety/danger language.
 */
import type { Journey, JourneyContact } from './store';
import { FJ_SEND_ENABLED } from './flags';

/** Must appear, visually distinct, on every contact-facing preview. */
export const PREVIEW_LABEL = 'Preview — nothing has been sent.';

/** Phase 2 delivery truth: DHARA never sends anything by itself. */
export const SEND_LABEL = 'Your SMS app opens with this text — you press Send.';

export type PreviewMode = 'arrival' | 'missedCheckin' | 'helpRequest';

export const MODE_META: Record<PreviewMode, { title: string; short: string; note: string }> = {
  arrival: {
    title: 'Arrival notification',
    short: 'Arrival',
    note: 'This contact would be told only when you confirm you have arrived.',
  },
  missedCheckin: {
    title: 'Late / missed check-in notification',
    short: 'Missed check-in',
    note: 'Fixed, neutral wording only. It never says whether you are safe or at risk.',
  },
  helpRequest: {
    title: 'Student-initiated help request',
    short: 'Help request',
    note: 'Only ever sent when you choose to send it. Never automatic.',
  },
};

function place(j: Journey) {
  return j.destination?.trim() || 'the destination you set';
}

/** Phase-2 notes — truthful about who presses Send. */
const SEND_NOTES: Record<PreviewMode, string> = {
  arrival: 'Only when you confirm you have arrived, and only after you press Send in your SMS app.',
  missedCheckin: 'Fixed, neutral wording only. It never says whether you are safe or at risk, and it is never sent automatically.',
  helpRequest: 'Only ever sent when you choose to send it. Never automatic.',
};

/** The note shown under each permission switch, correct for the current phase. */
export function modeNote(mode: PreviewMode): string {
  return FJ_SEND_ENABLED ? SEND_NOTES[mode] : MODE_META[mode].note;
}

/** The exact SMS text sent from the student's own number. First person,
 *  because the message leaves the student's phone, not a DHARA server. */
export function smsBody(mode: PreviewMode, j: Journey): string {
  const p = place(j);
  const sig = '\n\n(Sent by me from the DHARA app.)';
  switch (mode) {
    case 'arrival':
      return `I've arrived at ${p}.${sig}`;
    case 'missedCheckin':
      return `My check-in for the journey to ${p} is late. This message does not say whether I am safe or at risk — please call me to check.${sig}`;
    case 'helpRequest':
      return `I'm asking for help during my journey to ${p}. Please call me.${sig}`;
  }
}

/** Headline + body a contact would see, worded exactly as it would be for real.
 *  With Phase 2 on, the body IS the exact SMS text, so a preview can never
 *  differ from what the contact actually receives. */
export function buildPreview(
  mode: PreviewMode,
  j: Journey,
  ownerName: string,
): { heading: string; body: string } {
  if (FJ_SEND_ENABLED) {
    return { heading: MODE_META[mode].title, body: smsBody(mode, j) };
  }
  const who = ownerName?.trim() || 'Your contact';
  switch (mode) {
    case 'arrival':
      return {
        heading: 'Arrived',
        body: `${who} confirmed arrival at ${place(j)}.`,
      };
    case 'missedCheckin':
      return {
        heading: 'Check-in not received',
        body: `Check-in not received from ${who} for the journey to ${place(j)}. This message does not say whether ${who} is safe or at risk.`,
      };
    case 'helpRequest':
      return {
        heading: 'Help request',
        body: `${who} asked for help during the journey to ${place(j)}.`,
      };
  }
}

export function enabledModes(ct: JourneyContact): PreviewMode[] {
  const modes: PreviewMode[] = [];
  if (ct.arrival) modes.push('arrival');
  if (ct.missedCheckin) modes.push('missedCheckin');
  if (ct.helpRequest) modes.push('helpRequest');
  return modes;
}
