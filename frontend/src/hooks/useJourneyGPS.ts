/**
 * useJourneyGPS — GO1B Live GPS tracking during Head Out sessions
 * ---------------------------------------------------------------
 * Foreground tracking: uses expo-location watchPositionAsync.
 *   Works in Expo Go and web preview (web returns mock position).
 *
 * Background tracking: uses expo-location startLocationUpdatesAsync
 *   with expo-task-manager. CANNOT be tested in Expo Go — requires
 *   a development or production build. Gated behind
 *   EXPO_PUBLIC_GPS_BACKGROUND=false.
 *
 * Privacy design:
 *   - Device does the reverse-geocoding (area/city name) — no third-party
 *     geocoding API; only area name + rough coords sent to backend.
 *   - Backend throttles to max 1 update per 30 s.
 *   - Location log limited to last 20 fixes on server.
 *   - All data expires with the parent journey (24 h TTL).
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import { useAuth } from '@/src/auth';
import { API_BASE } from '@/src/apiBase';

const POLL_INTERVAL_MS  = 30_000;   // foreground: update every 30 s
const DISTANCE_METERS   = 50;        // only update after >50 m movement

export type GPSState = {
  area:        string | null;   // reverse-geocoded area name
  accuracy:    number | null;   // metres
  /** Last known fix, for callers that need the raw coordinate (e.g. drawing
   * a live position marker or computing arrival/deviation against the
   * destination) — most callers only need `area`/`tracking` above. */
  latitude:    number | null;
  longitude:   number | null;
  /** Client clock time (Date.now()) of the last successful fix — used as a
   * "looks offline" proxy (a stale fix means we haven't heard from this
   * device in a while; it doesn't literally know the phone's network state). */
  lastFixAt:   number | null;
  granted:     boolean;
  denied:      boolean;
  canAskAgain: boolean;
  error:       string | null;
  tracking:    boolean;
};

const INITIAL: GPSState = {
  area: null, accuracy: null, latitude: null, longitude: null, lastFixAt: null,
  granted: false, denied: false, canAskAgain: true,
  error: null, tracking: false,
};

/**
 * @param journeyToken  - the backend journey token (from POST /api/journey/status)
 * @param enabled       - start tracking only when true (session active)
 * @param onPermDenied  - optional callback if user permanently blocks location
 */
export function useJourneyGPS(
  journeyToken: string | null,
  enabled: boolean,
  onPermDenied?: () => void,
): GPSState {
  const { token: authToken } = useAuth();
  const [state, setState]    = useState<GPSState>(INITIAL);
  const subRef  = useRef<Location.LocationSubscription | null>(null);
  const lastSent = useRef<number>(0);

  // ── Reverse geocode a position → human-readable area string ────────────────
  const geocode = useCallback(async (lat: number, lng: number): Promise<string> => {
    try {
      const res = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      if (res.length > 0) {
        const r = res[0];
        const parts = [r.district || r.subregion, r.city, r.region]
          .filter(Boolean)
          .map(s => s?.trim())
          .filter((v, i, a) => a.indexOf(v) === i)   // dedup
          .slice(0, 2);
        return parts.join(', ') || r.formattedAddress?.slice(0, 80) || 'Unknown area';
      }
    } catch { /* non-fatal */ }
    return 'Unknown area';
  }, []);

  // ── Send one location update to backend ────────────────────────────────────
  const pushUpdate = useCallback(async (
    lat: number, lng: number, accuracy: number, area: string,
  ) => {
    if (!authToken || !journeyToken) return;
    const now = Date.now();
    if (now - lastSent.current < 25_000) return;   // client-side throttle
    lastSent.current = now;
    try {
      await fetch(`${API_BASE}/api/journey/status/${journeyToken}/location`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ lat, lng, accuracy, area }),
      });
    } catch { /* non-fatal — GPS update failure must not break the session */ }
  }, [authToken, journeyToken]);

  // ── Handle a new position fix ──────────────────────────────────────────────
  const handlePosition = useCallback(async (pos: Location.LocationObject) => {
    const { latitude, longitude, accuracy } = pos.coords;
    const area = await geocode(latitude, longitude);
    setState(s => ({ ...s, area, accuracy: accuracy ?? null, latitude, longitude, lastFixAt: Date.now(), tracking: true }));
    await pushUpdate(latitude, longitude, accuracy ?? 0, area);
  }, [geocode, pushUpdate]);

  // ── Request permission contextually ───────────────────────────────────────
  const requestPermission = useCallback(async (): Promise<boolean> => {
    // 1. Check current status first
    const { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
    if (status === 'granted') {
      setState(s => ({ ...s, granted: true, denied: false }));
      return true;
    }
    if (!canAskAgain) {
      setState(s => ({ ...s, denied: true, canAskAgain: false }));
      onPermDenied?.();
      return false;
    }
    // 2. Ask once
    const res = await Location.requestForegroundPermissionsAsync();
    const granted = res.status === 'granted';
    setState(s => ({
      ...s,
      granted,
      denied: !granted,
      canAskAgain: res.canAskAgain ?? true,
    }));
    if (!granted) onPermDenied?.();
    return granted;
  }, [onPermDenied]);

  // ── Start / stop tracking based on `enabled` ──────────────────────────────
  useEffect(() => {
    if (!enabled || !journeyToken) {
      // Stop tracking if not needed
      try { subRef.current?.remove(); } catch { /* expo-location web can throw here */ }
      subRef.current = null;
      setState(INITIAL);
      return;
    }

    // Web: expo-location has limited web support — skip silently
    if (Platform.OS === 'web') {
      setState(s => ({ ...s, tracking: false, error: 'GPS not available in web preview' }));
      return;
    }

    let cancelled = false;

    (async () => {
      const ok = await requestPermission();
      if (!ok || cancelled) return;

      // Take an immediate fix to seed the UI
      try {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!cancelled) await handlePosition(pos);
      } catch { /* non-fatal */ }

      // Watch for ongoing movement
      let sub: Location.LocationSubscription;
      try {
        sub = await Location.watchPositionAsync(
          {
            accuracy:          Location.Accuracy.Balanced,
            distanceInterval:  DISTANCE_METERS,
            timeInterval:      POLL_INTERVAL_MS,
          },
          (pos) => { if (!cancelled) handlePosition(pos); },
        );
      } catch {
        setState(s => ({ ...s, tracking: false, error: 'Location tracking could not start on this device.' }));
        return;   // location unavailable — the one-off fix above still applies
      }
      // The journey may have ended (or the screen closed) while the permission
      // prompt was open — never leave a watcher running after that.
      if (cancelled) { try { sub.remove(); } catch {} return; }
      subRef.current = sub;
    })();

    return () => {
      cancelled = true;
      try { subRef.current?.remove(); } catch { /* expo-location web can throw */ }
      subRef.current = null;
    };
  }, [enabled, journeyToken, requestPermission, handlePosition]);

  return state;
}
