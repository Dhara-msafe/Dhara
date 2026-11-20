/**
 * locationUploadBody.ts — A06: tell the server how old each location really is.
 *
 * The server used to stamp every upload with the time it ARRIVED. A fix that
 * was delayed (slow network, a retry, a queued upload sent later) then looked
 * brand new to the trusted person.
 *
 * Each upload now carries:
 *   - age_seconds: how long ago the phone took this fix, measured at the
 *     moment of sending. An age, not a clock time, on purpose: it stays
 *     correct even when the phone's clock or time zone is wrong, because both
 *     ends of the subtraction come from the same phone clock. The server
 *     turns it into a capture time on its own clock.
 *   - source: 'gps' for a real fix taken by this device. The server refuses
 *     anything else, so a made-up or re-sent point can never be stored.
 *
 * Pure functions, no React Native imports, so they run in plain Node tests.
 */

/** The server refuses an age beyond this (a journey lives at most 24 hours). */
export const MAX_AGE_SECONDS = 86_400;

export type LocationSource = 'gps';

export interface LocationUploadBody {
  lat: number;
  lng: number;
  accuracy: number;
  area: string;
  source: LocationSource;
  /** Omitted when the capture time is unknown; the server then uses arrival time. */
  age_seconds?: number;
}

/** Seconds between capture and now, never negative, or null when unknown. */
export function ageSeconds(capturedAtMs: number | null | undefined, nowMs: number = Date.now()): number | null {
  if (typeof capturedAtMs !== 'number' || !Number.isFinite(capturedAtMs) || capturedAtMs <= 0) return null;
  if (!Number.isFinite(nowMs)) return null;
  const age = Math.round((nowMs - capturedAtMs) / 1000);
  if (age < 0) return 0;                 // capture stamped slightly ahead of the clock
  return Math.min(age, MAX_AGE_SECONDS);
}

export function buildLocationUploadBody(input: {
  lat: number;
  lng: number;
  accuracy: number | null | undefined;
  area: string;
  capturedAtMs: number | null | undefined;
  nowMs?: number;
}): LocationUploadBody {
  const body: LocationUploadBody = {
    lat: input.lat,
    lng: input.lng,
    accuracy: typeof input.accuracy === 'number' && Number.isFinite(input.accuracy) && input.accuracy >= 0 ? input.accuracy : 0,
    area: input.area,
    source: 'gps',
  };
  const age = ageSeconds(input.capturedAtMs, input.nowMs ?? Date.now());
  if (age !== null) body.age_seconds = age;
  return body;
}

/** Parse the ISO capture time kept on queued and cached fixes. null when unreadable. */
export function capturedAtToMs(capturedAt: string | null | undefined): number | null {
  if (typeof capturedAt !== 'string' || !capturedAt) return null;
  const ms = Date.parse(capturedAt);
  return Number.isFinite(ms) ? ms : null;
}
