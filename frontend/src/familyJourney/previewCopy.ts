/**
 * Family Journey — exact contact-facing wording, Phase 1.
 *
 * These strings are what a contact WOULD receive in a later phase. In Phase 1
 * they are only ever rendered on the student's own device, under the
 * PREVIEW_LABEL. Do not soften, dramatise, or add safety/danger language.
 */
import type { Journey, JourneyContact } from './store';

/** Must appear, visually distinct, on every contact-facing preview. */
export const PREVIEW_LABEL = 'Preview — nothing has been sent.';

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

/** Headline + body a contact would see, worded exactly as it would be for real. */
export function buildPreview(
  mode: PreviewMode,
  j: Journey,
  ownerName: string,
): { heading: string; body: string } {
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
