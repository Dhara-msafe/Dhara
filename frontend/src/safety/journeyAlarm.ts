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

// ─────────────────────────────────────────────────────────────────────────────
// A31: what really happened to the missed-check-in alert
// ─────────────────────────────────────────────────────────────────────────────
// Before this, the screen said "Your trusted circle has been notified" the
// moment the phone's own grace countdown reached zero, whether or not the
// server had been reached. Now the wording follows the server's reply.

export type AlertReport =
  /** Nothing reported yet. */
  | 'idle'
  /** The report is on its way to the server. */
  | 'sending'
  /** The server replied and raised alerts (possibly for nobody; see counts). */
  | 'confirmed'
  /** The server replied and deliberately raised nothing. */
  | 'skipped'
  /** The server could not be reached. Retrying. */
  | 'failed';

export interface AlertReportState {
  report: AlertReport;
  /** Link ids an alert exists for. null when the server did not say (older server). */
  alertedLinkIds: string[] | null;
  /** How many people were selected for this journey. null when unknown. */
  selected: number | null;
  skippedReason: 'journey_completed' | 'sharing_withdrawn' | 'auto_notify_off' | 'unknown' | null;
}

export const IDLE_ALERT_REPORT: AlertReportState = Object.freeze({
  report: 'idle', alertedLinkIds: null, selected: null, skippedReason: null,
}) as AlertReportState;

/** Turn the server's reply to POST .../missed-checkin into screen state. */
export function parseMissedCheckinReply(data: any): AlertReportState {
  const ids = Array.isArray(data?.alerted_link_ids)
    ? data.alerted_link_ids.filter((x: unknown) => typeof x === 'string')
    : null;
  const selected = Number.isInteger(data?.selected) && data.selected >= 0 ? data.selected : null;
  if (data?.skipped) {
    const r = data?.skipped_reason;
    const reason = r === 'journey_completed' || r === 'sharing_withdrawn' || r === 'auto_notify_off' ? r : 'unknown';
    return { report: 'skipped', alertedLinkIds: ids ?? [], selected, skippedReason: reason };
  }
  return { report: 'confirmed', alertedLinkIds: ids, selected, skippedReason: null };
}

export const DO_NOTHING_TEXT = 'Won\'t auto-notify — you chose "Do nothing" in Step 3';

/** The line shown under "Server alert status" after a missed check-in. */
export function alertStatusText(input: {
  state: AlertReportState;
  autoNotifyOff: boolean;
  pendingSafe: boolean;
  graceCountdown: string;
}): string {
  const { state, autoNotifyOff, pendingSafe, graceCountdown } = input;
  if (pendingSafe) {
    return "You marked yourself safe, but this phone could not tell DHARA's server. " +
      'The server may still alert your circle. Still trying.';
  }
  switch (state.report) {
    case 'sending':
      return "Raising the alert with DHARA's server…";
    case 'failed':
      return "Not confirmed. This phone cannot reach DHARA's server. Trying again…";
    case 'skipped':
      if (state.skippedReason === 'sharing_withdrawn') return 'No alert was raised, because you stopped sharing this journey.';
      if (state.skippedReason === 'journey_completed') return 'No alert was raised. This journey was already marked safe.';
      if (state.skippedReason === 'auto_notify_off') return DO_NOTHING_TEXT;
      return 'No alert was raised for this journey.';
    case 'confirmed': {
      const seen = 'DHARA cannot tell yet whether they have seen it.';
      if (state.alertedLinkIds === null) return `DHARA's server has raised the alert. ${seen}`;
      const a = state.alertedLinkIds.length;
      const n = state.selected ?? a;
      if (a === 0) {
        return 'No alert was raised. The people you chose have not accepted your invitation or have not allowed late alerts.';
      }
      return `Alert raised for ${a} of ${n} ${n === 1 ? 'person' : 'people'}. ${seen}`;
    }
    default:
      return autoNotifyOff ? DO_NOTHING_TEXT : `Will notify your circle in ${graceCountdown}`;
  }
}

/** The short label beside each person on the missed-check-in screen. */
export function recipientAlertLabel(input: {
  state: AlertReportState;
  linkId: string;
  autoNotifyOff: boolean;
  pendingSafe: boolean;
  graceCountdown: string;
}): string {
  const { state, linkId, autoNotifyOff, pendingSafe, graceCountdown } = input;
  if (pendingSafe) return 'Not confirmed';
  switch (state.report) {
    case 'sending': return 'Alerting…';
    case 'failed': return 'Not confirmed';
    case 'skipped': return state.skippedReason === 'auto_notify_off' ? 'Not auto-notified' : 'Not alerted';
    case 'confirmed':
      if (state.alertedLinkIds === null) return 'Alert raised';
      return state.alertedLinkIds.includes(linkId) ? 'Alert raised' : 'Not alerted';
    default:
      return autoNotifyOff ? 'Not auto-notified' : `In ${graceCountdown}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// A35: "I'm safe" and "Stop sharing" when the server cannot be reached
// ─────────────────────────────────────────────────────────────────────────────
// Both used to be sent once. A failed "I'm safe" still cleared the journey on
// the phone, so the server's alarm kept running and could alert her circle
// after she had said she was safe. A failed "Stop sharing" did nothing and
// showed nothing. Now each stays pending, is shown as pending, and is retried.

/**
 * Decide what a reply to PATCH .../safe or POST .../revoke means.
 * 2xx: done. 403, 404, 410: the server has no open journey of hers under this
 * token, so there is nothing left to close. Anything else, or no reply: retry.
 */
export function closeOutcome(httpStatus: number | null | undefined): 'done' | 'retry' {
  if (typeof httpStatus !== 'number' || !Number.isFinite(httpStatus)) return 'retry';
  if (httpStatus >= 200 && httpStatus < 300) return 'done';
  if (httpStatus === 403 || httpStatus === 404 || httpStatus === 410) return 'done';
  return 'retry';
}

export const CLOSE_COPY = {
  safe_pending: {
    title: "Not confirmed yet: this journey is still open on DHARA's server",
    body:
      "This phone cannot reach DHARA's server to say you are safe. Until it does, your trusted " +
      'circle may still be alerted when your check-in time passes. Still trying. ' +
      'If you can, tell them yourself that you are safe.',
  },
  revoke_pending: {
    title: 'Sharing has NOT stopped yet',
    body:
      "This phone cannot reach DHARA's server. Your trusted circle can still see this journey. Still trying.",
  },
  retry: 'Try again now',
  retrying: 'Trying…',
} as const;
