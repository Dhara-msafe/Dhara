/**
 * serverClock — A28: keep the countdown on the server's clock, not the phone's.
 *
 * The deadline that matters is the one the server holds: deadline_worker.py
 * alerts her circle from `expected_checkin_at`, whatever her phone thinks the
 * time is. A phone whose clock is ten minutes fast would show "10 minutes
 * left" when the server has already alerted, or the reverse — the countdown
 * would be lying at the one moment it must not.
 *
 * So the app measures how far its own clock sits from the server's, once per
 * reply that carries `server_time`, and counts down to the server's deadline
 * through that offset. Pure functions only (no React, no storage) so they run
 * in plain Node tests.
 */

/** Ignore an offset beyond this: a reply that old (or that far in the future)
 *  is a clock so broken, or a response so stale, that trusting it would make
 *  the countdown worse rather than better. 24 hours. */
export const MAX_SANE_OFFSET_MS = 24 * 60 * 60 * 1000;

export function parseIsoMs(iso?: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * How many milliseconds to add to this phone's clock to get the server's.
 *
 * `sentAtMs` and `receivedAtMs` bracket the request, so half the round trip
 * is taken off: the server stamped its time somewhere inside that window, and
 * the midpoint is the best guess available without a time protocol.
 *
 * Returns 0 — "assume the clocks agree" — when the reply carries no readable
 * time or the result is beyond MAX_SANE_OFFSET_MS.
 */
export function clockOffsetMs(args: {
  serverTimeIso?: string | null;
  sentAtMs: number;
  receivedAtMs: number;
}): number {
  const serverMs = parseIsoMs(args.serverTimeIso);
  if (serverMs === null) return 0;
  const midpoint = args.sentAtMs + (args.receivedAtMs - args.sentAtMs) / 2;
  const offset = Math.round(serverMs - midpoint);
  return Math.abs(offset) > MAX_SANE_OFFSET_MS ? 0 : offset;
}

/** The server's time now, as best this phone can tell. */
export function serverNowMs(offsetMs: number | undefined, nowMs: number): number {
  return nowMs + (Number.isFinite(offsetMs as number) ? (offsetMs as number) : 0);
}

export interface CountdownInput {
  /** The deadline the server holds, as it sent it. */
  serverDeadlineAt?: string | null;
  /** Offset measured when that deadline arrived. */
  clockOffsetMs?: number;
  /** The phone's own idea of the deadline, for sessions that have no server
   *  deadline yet (started offline, or saved before this existed). */
  localDeadlineMs: number;
}

/**
 * Seconds until the check-in deadline, never negative.
 *
 * The server's deadline wins whenever there is one. The phone's own deadline
 * is the fallback, so a journey created while offline still counts down.
 */
export function secondsLeft(input: CountdownInput, nowMs: number): number {
  return Math.max(0, Math.ceil((deadlineAgainstNow(input, nowMs)) / 1000));
}

/** Seconds until the grace window after the deadline runs out. */
export function graceSecondsLeft(input: CountdownInput, graceMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((deadlineAgainstNow(input, nowMs) + graceMs) / 1000));
}

/** Milliseconds from "now on the server" to the deadline. May be negative. */
function deadlineAgainstNow(input: CountdownInput, nowMs: number): number {
  const serverDeadline = parseIsoMs(input.serverDeadlineAt);
  if (serverDeadline === null) return input.localDeadlineMs - nowMs;
  return serverDeadline - serverNowMs(input.clockOffsetMs, nowMs);
}

/** True once the deadline has passed. */
export function hasExpired(input: CountdownInput, nowMs: number): boolean {
  return deadlineAgainstNow(input, nowMs) <= 0;
}

/**
 * How old a location reading is, in whole minutes.
 *
 * `serverAgeSeconds` is the server's own answer (A28) and is used whenever it
 * is there. The fallback works it out from the capture time and this device's
 * offset, for an older server that does not send it. Null when neither is
 * available.
 */
export function ageMinutes(args: {
  serverAgeSeconds?: number | null;
  capturedAtIso?: string | null;
  clockOffsetMs?: number;
  nowMs: number;
}): number | null {
  if (typeof args.serverAgeSeconds === 'number' && Number.isFinite(args.serverAgeSeconds)) {
    return Math.max(0, Math.floor(args.serverAgeSeconds / 60));
  }
  const captured = parseIsoMs(args.capturedAtIso);
  if (captured === null) return null;
  return Math.max(0, Math.floor((serverNowMs(args.clockOffsetMs, args.nowMs) - captured) / 60_000));
}
