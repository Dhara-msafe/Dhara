/**
 * locationPresentation.ts  — F0-A offline location formatting utility.
 *
 * Converts raw GPS data into display-ready strings including a full Plus Code.
 *
 * Design constraints:
 *   - No geocoding, no network calls, no map SDK, no location requests.
 *   - currentTime is injected so every function is deterministic under test.
 *   - Coordinate validity is checked strictly; accept lat=0 or lng=0.
 *   - Plus Code encodes the coordinate; it does not improve fix accuracy.
 *   - Large or approximate accuracy is shown as-is; never silently replaced.
 *   - capturedAt is preserved as the device's own timestamp and never
 *     overwritten. age is derived from (capturedAt, now) and always reflects
 *     how old the sample is — it cannot make an old fix appear newly captured.
 */
import { OpenLocationCode } from 'open-location-code';

const _olc = new OpenLocationCode();

// ── Public types ──────────────────────────────────────────────────────────────

export interface RawLocationFix {
  latitude: number;
  longitude: number;
  /** Horizontal accuracy radius in metres. null/undefined → 'Accuracy unavailable'. */
  accuracyM: number | null | undefined;
  /** ISO-8601 string or Date when the device recorded the fix. */
  capturedAt: string | Date | null | undefined;
}

export interface FormattedLocation {
  plusCode: string;       // full 10-char OLC code, or "" when coords are invalid
  coordinates: string;    // "lat, lng" to 6 dp, or "" when coords are invalid
  accuracy: string;       // "±X m" | "Accuracy unavailable"
  age: string;            // "just now" | "X min ago" | "X h ago" | "X days ago" | "unknown" | "future timestamp"
  capturedAtLabel: string;// human-readable capture time, or "Unknown"
  isValid: boolean;       // false if latitude/longitude failed validation
}

// ── Validation ────────────────────────────────────────────────────────────────

function _validCoords(lat: number, lng: number): boolean {
  return (
    typeof lat === 'number' && isFinite(lat) &&
    typeof lng === 'number' && isFinite(lng) &&
    lat >= -90 && lat <= 90 &&
    lng >= -180 && lng <= 180
  );
}

// ── Accuracy ──────────────────────────────────────────────────────────────────

function _formatAccuracy(accuracyM: number | null | undefined): string {
  if (accuracyM === null || accuracyM === undefined) return 'Accuracy unavailable';
  if (typeof accuracyM !== 'number' || !isFinite(accuracyM)) return 'Accuracy unavailable';
  if (accuracyM <= 0) return 'Accuracy unavailable';   // 0 and negative are not valid radii
  // Valid positive value: show it as-is. A large value (e.g. 5000 m) is an
  // honest approximate estimate; silently replacing it would mislead the user.
  return `\u00b1${Math.round(accuracyM)} m`;
}

// ── Age ───────────────────────────────────────────────────────────────────────

function _formatAge(capturedAt: string | Date | null | undefined, now: Date): string {
  if (!capturedAt) return 'unknown';
  let ts: number;
  try {
    ts = capturedAt instanceof Date
      ? capturedAt.getTime()
      : new Date(capturedAt as string).getTime();
  } catch {
    return 'unknown';
  }
  if (!isFinite(ts)) return 'unknown';
  const diffMs = now.getTime() - ts;
  if (diffMs < 0) return 'future timestamp';
  if (diffMs < 60_000) return 'just now';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

function _formatCapturedAt(capturedAt: string | Date | null | undefined): string {
  if (!capturedAt) return 'Unknown';
  try {
    const d = capturedAt instanceof Date ? capturedAt : new Date(capturedAt as string);
    if (!isFinite(d.getTime())) return 'Unknown';
    return d.toLocaleString();
  } catch {
    return 'Unknown';
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Format a raw GPS fix into display-ready strings.
 *
 * @param fix   Raw location data from the device.
 * @param now   Injected current time (pass `new Date()` in production).
 */
export function formatLocationFix(
  fix: RawLocationFix,
  now: Date,
): FormattedLocation {
  const { latitude, longitude, accuracyM, capturedAt } = fix;

  if (!_validCoords(latitude, longitude)) {
    return {
      plusCode: '',
      coordinates: '',
      accuracy: _formatAccuracy(accuracyM),
      age: _formatAge(capturedAt, now),
      capturedAtLabel: _formatCapturedAt(capturedAt),
      isValid: false,
    };
  }

  const plusCode = _olc.encode(latitude, longitude); // 10 chars for full-precision encode
  const coordinates = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;

  return {
    plusCode,
    coordinates,
    accuracy: _formatAccuracy(accuracyM),
    age: _formatAge(capturedAt, now),
    capturedAtLabel: _formatCapturedAt(capturedAt),
    isValid: true,
  };
}
