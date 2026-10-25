/**
 * locationCache.ts — F0-B: account-scoped encrypted location cache.
 *
 * Wraps expo-secure-store to persist the user's last known location
 * across app restarts. The cache key is scoped to the signed-in user
 * so that a different user on the same device never reads another user's data.
 *
 * Source priority (highest → lowest):
 *   1. Device GPS fix — via cacheGPSFix() (activated when GO1B_GPS flag is ON)
 *   2. Server location_log entry — via seedFromJourneyRecord()
 *   3. Demo fallback (Chennai city centre, 13.0827° N 80.2707° E) — returned
 *      by getLastLocation() when the cache is empty so the Plus Code card
 *      always renders a value during preview while GPS flag is OFF.
 *
 * No network calls; no map or geocoding SDK; uses only the open-location-code
 * library already referenced by locationPresentation.ts.
 */
import * as SecureStore from 'expo-secure-store';
import { formatLocationFix } from './locationPresentation';

// ── Public types ──────────────────────────────────────────────────────────────

export type LocationSource = 'gps' | 'server' | 'demo';

export interface CachedLocation {
  lat: number;
  lng: number;
  accuracyM: number | null;
  capturedAt: string;    // ISO-8601
  plusCode: string;      // 10-char OLC code, or "" when coords are invalid
  source: LocationSource;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _key(userId: string): string {
  // Per-user scope.  userId should be the signed-in account's id; a fallback
  // string keeps the code safe even when called before sign-in completes.
  return `dhara_loc_${userId || 'anon'}`;
}

function _encode(lat: number, lng: number): string {
  return formatLocationFix(
    { latitude: lat, longitude: lng, accuracyM: null, capturedAt: new Date().toISOString() },
    new Date(),
  ).plusCode;   // "" when coords are invalid
}

// ── Demo fallback ─────────────────────────────────────────────────────────────
// Chennai city centre — shown only when the cache is empty and GPS is OFF.

const DEMO_LAT = 13.0827;
const DEMO_LNG = 80.2707;

function _demoEntry(): CachedLocation {
  return {
    lat:       DEMO_LAT,
    lng:       DEMO_LNG,
    accuracyM: null,
    capturedAt: new Date().toISOString(),
    plusCode:  _encode(DEMO_LAT, DEMO_LNG),
    source:    'demo',
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Persist a location entry for this user.
 * Silently ignored on SecureStore failure (best-effort; never throws).
 */
export async function cacheLocation(
  userId: string,
  entry: Omit<CachedLocation, 'plusCode'>,
): Promise<void> {
  try {
    const full: CachedLocation = { ...entry, plusCode: _encode(entry.lat, entry.lng) };
    await SecureStore.setItemAsync(_key(userId), JSON.stringify(full));
  } catch {}
}

/**
 * Convenience: cache a device GPS fix (source = 'gps').
 */
export async function cacheGPSFix(
  userId: string,
  lat: number,
  lng: number,
  accuracyM: number | null,
): Promise<void> {
  await cacheLocation(userId, {
    lat,
    lng,
    accuracyM,
    capturedAt: new Date().toISOString(),
    source: 'gps',
  });
}

/**
 * Seed the cache from a server-side location_log array.
 * Picks the last (most recent) entry.  Does nothing if the array is
 * empty, malformed, or lacks valid coordinates.
 */
export async function seedFromJourneyRecord(
  userId: string,
  locationLog: { lat?: number; lng?: number; accuracy?: number; updated_at?: string }[],
): Promise<void> {
  if (!Array.isArray(locationLog) || locationLog.length === 0) return;
  const last = locationLog[locationLog.length - 1];
  if (typeof last?.lat !== 'number' || typeof last?.lng !== 'number') return;
  await cacheLocation(userId, {
    lat:       last.lat,
    lng:       last.lng,
    accuracyM: typeof last.accuracy === 'number' ? last.accuracy : null,
    capturedAt: last.updated_at ?? new Date().toISOString(),
    source:    'server',
  });
}

/**
 * Read the last cached location for this user.
 * Returns the demo fallback if the cache is empty or unreadable.
 * Never throws.
 */
export async function getLastLocation(userId: string): Promise<CachedLocation> {
  try {
    const raw = await SecureStore.getItemAsync(_key(userId));
    if (raw) {
      const parsed = JSON.parse(raw) as CachedLocation;
      if (typeof parsed.lat === 'number' && typeof parsed.lng === 'number') {
        // Recompute Plus Code in case the OLC library version changed.
        return { ...parsed, plusCode: _encode(parsed.lat, parsed.lng) || parsed.plusCode };
      }
    }
  } catch {}
  return _demoEntry();
}

/**
 * Delete the cache for this user (call on sign-out).
 * Silently ignored on failure.
 */
export async function clearLocationCache(userId: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(_key(userId));
  } catch {}
}
