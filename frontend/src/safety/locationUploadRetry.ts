/**
 * locationUploadRetry — A10: what to do with a location reading the server
 * did not take, and which held reading to send when the network is back.
 *
 * Pure functions only (no React, no storage) so they run in plain Node tests.
 *
 * Why only the NEWEST held reading is sent: the server keeps one "last
 * location" per journey, accepts at most one upload per 25 seconds, and never
 * lets an older reading replace a newer one (A07). Sending every held reading
 * in a burst would have all but the first ignored. What the trusted person
 * needs after a gap is her most recent real position with its true age, so
 * that one is sent and the older ones for the same journey are let go.
 */

export type UploadOutcome =
  /** Server stored it. */
  | 'stored'
  /** Server answered but will never want this reading (journey closed, sharing
   *  stopped, a newer reading is already stored). Do not send again. */
  | 'superseded'
  /** Not delivered, or delivered too soon after another. Keep and try again. */
  | 'retry'
  /** Server refused it for good (not her journey, journey gone, bad body). */
  | 'drop';

export interface HeldReading {
  id: string;
  journeyToken: string;
  lat: number;
  lng: number;
  accuracy: number;
  area: string;
  /** ISO time the phone took the reading. */
  capturedAt: string;
}

/** How often held readings are retried while the journey screen is open. */
export const RETRY_INTERVAL_MS = 30_000;
/** A reading older than this is never sent (the server refuses it too). */
export const MAX_HELD_AGE_MS = 24 * 60 * 60 * 1000;

const PERMANENT = new Set([400, 403, 404, 410, 422]);

/**
 * @param status HTTP status, or null when the request never got an answer.
 * @param body   parsed JSON reply, if any.
 */
export function uploadOutcome(status: number | null, body?: unknown): UploadOutcome {
  if (status === null) return 'retry';
  if (status >= 200 && status < 300) {
    const skipped = body && typeof body === 'object' ? (body as { skipped?: unknown }).skipped : undefined;
    if (skipped === 'throttled') return 'retry';
    if (skipped) return 'superseded';
    return 'stored';
  }
  if (PERMANENT.has(status)) return 'drop';
  return 'retry';   // 401 (sign-in refreshing), 429, 5xx, anything unexpected
}

/**
 * A14: does this reply mean the journey is over on the server?
 *
 * Three ways the server says so on the location endpoint:
 *   404 the journey is gone,
 *   410 the link has expired,
 *   200 with a "skipped" reason naming completion or withdrawn sharing
 *       ("journey already completed or sharing withdrawn").
 *
 * 403 ("Not your journey") is deliberately NOT treated as closed. It can
 * also mean a mismatched sign-in, and clearing her journey because of a
 * token mix-up would be worse than stopping the uploads, which `drop`
 * already does.
 */
export function journeyIsClosed(status: number | null, body?: unknown): boolean {
  if (status === 404 || status === 410) return true;
  if (status === null || status < 200 || status >= 300) return false;
  const skipped = body && typeof body === 'object' ? (body as { skipped?: unknown }).skipped : undefined;
  if (typeof skipped !== 'string') return false;
  const reason = skipped.toLowerCase();
  return reason.includes('completed') || reason.includes('withdrawn');
}


function capturedMs(e: HeldReading): number | null {
  const t = Date.parse(e.capturedAt);
  return Number.isFinite(t) ? t : null;
}

/** Held readings worth keeping: this journey only, readable time, not too old. */
export function usableFor(queue: HeldReading[], journeyToken: string, nowMs: number): HeldReading[] {
  return queue.filter((e) => {
    if (e.journeyToken !== journeyToken) return false;
    const t = capturedMs(e);
    return t !== null && nowMs - t <= MAX_HELD_AGE_MS && t - nowMs <= 60_000;
  });
}

/** The most recently captured held reading for this journey, or null. */
export function newestFor(queue: HeldReading[], journeyToken: string, nowMs: number): HeldReading | null {
  let best: HeldReading | null = null;
  let bestT = -Infinity;
  for (const e of usableFor(queue, journeyToken, nowMs)) {
    const t = capturedMs(e) as number;
    if (t >= bestT) { best = e; bestT = t; }
  }
  return best;
}

/**
 * After the server settled a reading captured at `settledCapturedMs` (stored,
 * superseded or refused), drop every held reading for that journey that is
 * not newer than it. Readings for other journeys are dropped too: only one
 * journey is ever active, so they are leftovers.
 */
export function afterSettled(
  queue: HeldReading[], journeyToken: string, settledCapturedMs: number, nowMs: number,
): HeldReading[] {
  return usableFor(queue, journeyToken, nowMs).filter((e) => (capturedMs(e) as number) > settledCapturedMs);
}
