/**
 * lastGaspGuard.ts — A09: decide whether a cached location may be uploaded
 * as the "last-gasp" fix when the app leaves the foreground mid-journey.
 *
 * Why this exists: getLastLocation() never returns null. When the cache is
 * empty it returns a hardcoded demo coordinate (Chennai city centre,
 * source 'demo'). The last-gasp handler used to upload whatever it got, so a
 * trusted contact could be shown a place the traveller has never been. An
 * old real fix has the same effect, because the server stamps each upload
 * with its own receive time, which makes a stale point look fresh.
 *
 * Rule: upload only a real device fix that is recent. Sending nothing is
 * always safer than sending a location that is not true.
 *
 * Pure function, no React Native imports, so it can be tested in plain Node.
 */

/** A cached fix older than this is not uploaded. */
export const LAST_GASP_MAX_AGE_MS = 10 * 60 * 1000;

/** Tolerance for a capture time slightly ahead of the phone clock. */
const FUTURE_TOLERANCE_MS = 60 * 1000;

export interface LastGaspCandidate {
  lat: number;
  lng: number;
  capturedAt: string;
  source: string;
}

export function isUploadableLastGaspFix(
  cached: LastGaspCandidate | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!cached) return false;

  // Only a fix taken by this device. 'demo' is fabricated; 'server' is a
  // point the server already holds, and re-sending it would only make an
  // old location look new.
  if (cached.source !== 'gps') return false;

  if (
    typeof cached.lat !== 'number' || typeof cached.lng !== 'number' ||
    !Number.isFinite(cached.lat) || !Number.isFinite(cached.lng) ||
    cached.lat < -90 || cached.lat > 90 ||
    cached.lng < -180 || cached.lng > 180
  ) return false;

  const capturedMs = Date.parse(cached.capturedAt);
  if (!Number.isFinite(capturedMs)) return false;

  const ageMs = nowMs - capturedMs;
  if (ageMs > LAST_GASP_MAX_AGE_MS) return false;
  if (ageMs < -FUTURE_TOLERANCE_MS) return false;

  return true;
}
