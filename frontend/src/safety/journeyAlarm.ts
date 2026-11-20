/**
 * journeyAlarm.ts — A30: is the server-held check-in alarm armed for this journey?
 *
 * Head Out promises that if she misses her check-in, DHARA's SERVER alerts
 * the people she chose, even if her phone is off. That only holds once the
 * server has accepted the journey. Until then the phone is showing a timer
 * that nothing else knows about.
 *
 * Before this change the journey was sent to the server once, silently. If
 * that single request failed she was not told and it was never retried.
 *
 * This module holds the rules so they can be tested in plain Node:
 *   - when a server journey is needed at all,
 *   - what the screen should say at each point,
 *   - how long to wait before each retry,
 *   - the reference that lets the server recognise a retry of the same journey.
 *
 * Pure functions only. No React Native imports.
 */

export type AlarmStatus =
  /** No server journey is needed (GPS sharing off and no one selected). */
  | 'not_needed'
  /** First attempts are still running. */
  | 'connecting'
  /** The server has the journey and holds the deadline. */
  | 'active'
  /** Several attempts failed. She must be told plainly. Still retrying. */
  | 'not_active';

/** Waits after the 1st, 2nd and 3rd failed attempt. */
export const QUICK_RETRY_DELAYS_MS = [2_000, 5_000, 10_000] as const;
/** Wait between attempts after the quick ones are used up. */
export const SLOW_RETRY_MS = 30_000;
/** Failed attempts before the screen switches from "connecting" to the warning. */
export const FAILURES_BEFORE_WARNING = 3;

/** How long to wait before the next attempt, given how many have failed so far. */
export function retryDelayMs(failedAttempts: number): number {
  if (!Number.isFinite(failedAttempts) || failedAttempts <= 0) return 0;
  const i = Math.floor(failedAttempts) - 1;
  return i < QUICK_RETRY_DELAYS_MS.length ? QUICK_RETRY_DELAYS_MS[i] : SLOW_RETRY_MS;
}

/** A server journey is needed when location is shared or anyone was selected. */
export function needsServerJourney(gpsSharingOn: boolean, recipientCount: number): boolean {
  return gpsSharingOn || recipientCount > 0;
}

export function alarmStatus(input: {
  needsServerJourney: boolean;
  hasJourneyToken: boolean;
  failedAttempts: number;
}): AlarmStatus {
  if (!input.needsServerJourney) return 'not_needed';
  if (input.hasJourneyToken) return 'active';
  return input.failedAttempts >= FAILURES_BEFORE_WARNING ? 'not_active' : 'connecting';
}

/**
 * A stable reference for one journey on one account, sent with every create
 * attempt. If an earlier attempt reached the server but its reply was lost,
 * the server recognises the retry and returns the same journey instead of
 * making a second one (which would run its own alarm and alert her circle
 * after she had already checked in safe).
 */
export function journeyClientRef(userId: string | null | undefined, startTimeMs: number): string {
  const uid = String(userId ?? 'anon').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 48) || 'anon';
  const start = Number.isFinite(startTimeMs) ? Math.floor(startTimeMs) : 0;
  return `ho-${uid}-${start}`;
}

/** Words shown on the journey screen. Kept here so the wording is tested. */
export const ALARM_COPY = {
  connecting: {
    title: "Connecting to DHARA's server…",
    body: 'Automatic alerts are not active until this finishes.',
  },
  not_active: {
    title: 'Automatic alerts are NOT active',
    body:
      "DHARA has not been able to reach its server, so your trusted circle will not be told " +
      'if you miss your check-in. Still trying. If you need them to know, contact them yourself.',
    retry: 'Try again now',
    retrying: 'Trying…',
  },
  active: {
    body: "Connected. DHARA's server is holding your check-in time.",
  },
  expired_not_active: {
    title: 'Your trusted circle has NOT been alerted',
    body:
      'DHARA could not register this journey with its server, so no automatic alert was sent. ' +
      'Contact them yourself, or call 112 if you are in danger.',
  },
} as const;
