/**
 * v2.2 rollout phase 6 — one dialler message everywhere.
 *
 * Source of truth: the Emergency screen (app/emergency.tsx), whose 112
 * control is a real Pressable using openPhone() from src/women/helpActions.ts
 * (routes through the Outbound Guard; opens the dialler with the number
 * filled in — the user still presses call; QA builds simulate and say so).
 * Every other dial control reuses these strings so the app says the same
 * thing in every place. Used only when UI_V22_P6 is on.
 */

/** Accessible name for any dial control. Matches app/emergency.tsx. */
export const dialLabel = (number: string) => `Open dialler for ${number}`;

/** Accessible hint for any dial control. Matches app/emergency.tsx. */
export const dialHint = (number: string) =>
  `Opens your phone's dialler with ${number} filled in. You still have to press call yourself.`;

/** Visible button text where a button used to say "Call 112". */
export const DIAL_112_BUTTON = 'Open dialler for 112';

/** Note under a list of tappable helpline numbers. */
export const DIAL_LIST_NOTE =
  'Tap a number to open your dialler with it filled in. You still press call yourself. If the dialler does not open, dial the number manually.';
