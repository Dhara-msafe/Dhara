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
import { cacheLocation } from '@/src/safety/locationCache';
import { buildLocationUploadBody } from '@/src/safety/locationUploadBody';
import { useLocationUploadQueue } from '@/src/safety/locationUploadQueue';
import {
  uploadOutcome, newestFor, afterSettled, usableFor, RETRY_INTERVAL_MS,
  type UploadOutcome,
} from '@/src/safety/locationUploadRetry';

const POLL_INTERVAL_MS  = 30_000;   // foreground: update every 30 s
/** A40: how often a real fix is written to the on-phone store. */
const CACHE_INTERVAL_MS = 20_000;
const DISTANCE_METERS   = 50;        // only update after >50 m movement
const WEB_UNAVAILABLE   = 'GPS not available in web preview';

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
 * @param opts.keepRetryingHeld - A10b: keep sending readings already held on
 *        the phone even while `enabled` is false. Set while the check-in has
 *        been missed: no new readings are taken, but the last real one she
 *        has must still reach the people who were just alerted.
 */
export function useJourneyGPS(
  journeyToken: string | null,
  enabled: boolean,
  onPermDenied?: () => void,
  opts?: { keepRetryingHeld?: boolean },
): GPSState {
  const keepRetryingHeld = opts?.keepRetryingHeld ?? false;
  const { token: authToken, user } = useAuth();
  const [state, setState]    = useState<GPSState>(INITIAL);
  const subRef  = useRef<Location.LocationSubscription | null>(null);
  const lastSent = useRef<number>(0);
  // A40: the on-phone location store is kept per signed-in user. Read the id
  // through a ref so a changed user object never restarts the GPS watcher.
  const userIdRef = useRef<string>('anon');
  useEffect(() => { userIdRef.current = user?.id ?? 'anon'; }, [user]);
  const lastCached = useRef<number>(0);

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

  // ── A10: one PATCH to the server, with a verdict on what to do next ───────
  const sendReading = useCallback(async (
    lat: number, lng: number, accuracy: number, area: string, capturedAtMs: number,
  ): Promise<UploadOutcome> => {
    if (!authToken || !journeyToken) return 'retry';
    try {
      const resp = await fetch(`${API_BASE}/api/journey/status/${journeyToken}/location`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        // A06: send how old this fix is and that it is a real device fix, so
        // the server stores the true capture time instead of the arrival time.
        body: JSON.stringify(buildLocationUploadBody({ lat, lng, accuracy, area, capturedAtMs })),
      });
      let body: unknown = null;
      try { body = await resp.json(); } catch { /* no JSON body */ }
      return uploadOutcome(resp.status, body);
    } catch {
      return uploadOutcome(null);   // no answer: offline, timeout
    }
  }, [authToken, journeyToken]);

  // ── Send one location update to backend ────────────────────────────────────
  // A10: a reading the server did not take is no longer thrown away. It is
  // held on the phone (locationUploadQueue) and retried by flushHeld below.
  const pushUpdate = useCallback(async (
    lat: number, lng: number, accuracy: number, area: string, capturedAtMs: number,
  ) => {
    if (!authToken || !journeyToken) return;
    const now = Date.now();
    if (now - lastSent.current < 25_000) return;   // client-side throttle
    lastSent.current = now;
    try {
      const outcome = await sendReading(lat, lng, accuracy, area, capturedAtMs);
      const q = useLocationUploadQueue.getState();
      if (outcome === 'retry') {
        q.enqueue({ journeyToken, lat, lng, accuracy, area, capturedAt: new Date(capturedAtMs).toISOString() });
      } else {
        // Settled: anything held that is not newer than this reading is obsolete.
        const kept = afterSettled(q.queue, journeyToken, capturedAtMs, Date.now());
        if (kept.length !== q.queue.length) useLocationUploadQueue.setState({ queue: kept });
      }
    } catch { /* non-fatal — GPS update failure must not break the session */ }
  }, [authToken, journeyToken, sendReading]);

  // ── A10: retry the newest held reading ────────────────────────────────────
  // Called every RETRY_INTERVAL_MS while tracking is on. Sends only the most
  // recent held reading for this journey (see locationUploadRetry.ts for why).
  const flushing = useRef(false);
  const flushHeld = useCallback(async () => {
    if (!authToken || !journeyToken || flushing.current) return;
    flushing.current = true;
    try {
      const { queue } = useLocationUploadQueue.getState();
      const nowMs = Date.now();
      const entry = newestFor(queue, journeyToken, nowMs);
      if (!entry) {
        // Nothing sendable: clear out leftovers (other journeys, too old).
        if (queue.length > 0) useLocationUploadQueue.setState({ queue: usableFor(queue, journeyToken, nowMs) });
        return;
      }
      const capturedAtMs = Date.parse(entry.capturedAt);
      const outcome = await sendReading(entry.lat, entry.lng, entry.accuracy, entry.area, capturedAtMs);
      if (outcome === 'retry') return;   // stays held for the next round
      lastSent.current = Date.now();
      const latest = useLocationUploadQueue.getState().queue;
      useLocationUploadQueue.setState({ queue: afterSettled(latest, journeyToken, capturedAtMs, Date.now()) });
    } catch { /* non-fatal */ } finally {
      flushing.current = false;
    }
  }, [authToken, journeyToken, sendReading]);

  // ── Handle a new position fix ──────────────────────────────────────────────
  const handlePosition = useCallback(async (pos: Location.LocationObject) => {
    const { latitude, longitude, accuracy } = pos.coords;
    // A40: remember this real fix on the phone (encrypted, per user) so the
    // last-gasp upload and the Plus Code have a true location to use. Done
    // BEFORE the area lookup, which can be slow or fail with no network.
    // Written at most once per CACHE_INTERVAL_MS. Cleared when the journey
    // ends and on sign-out. Best-effort: a failed write never breaks tracking.
    const nowMs = Date.now();
    // The time the phone actually took this fix (used for the cache and, A06, the upload).
    const fixMs = Number.isFinite(pos.timestamp) && pos.timestamp > 0 ? pos.timestamp : nowMs;
    if (nowMs - lastCached.current >= CACHE_INTERVAL_MS) {
      lastCached.current = nowMs;
      void cacheLocation(userIdRef.current, {
        lat: latitude,
        lng: longitude,
        accuracyM: accuracy ?? null,
        capturedAt: new Date(fixMs).toISOString(),
        source: 'gps',
      });
    }
    const area = await geocode(latitude, longitude);
    setState(s => ({ ...s, area, accuracy: accuracy ?? null, latitude, longitude, lastFixAt: Date.now(), tracking: true }));
    await pushUpdate(latitude, longitude, accuracy ?? 0, area, fixMs);
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

  // The start/stop effect below must run only when tracking really has to
  // start or stop (enabled / journeyToken change). The functions it calls
  // change identity far more often: `onPermDenied` is usually an inline arrow
  // from the screen (new on every render), and `pushUpdate` changes when the
  // auth token refreshes. If they were effect dependencies, every render
  // would stop and restart permission + GPS watching (and on web it looped
  // forever: "Maximum update depth exceeded"). So the effect reads the latest
  // versions through refs instead.
  const requestPermissionRef = useRef(requestPermission);
  const handlePositionRef    = useRef(handlePosition);
  requestPermissionRef.current = requestPermission;
  handlePositionRef.current    = handlePosition;
  const flushHeldRef = useRef(flushHeld);
  flushHeldRef.current = flushHeld;

  // ── Start / stop tracking based on `enabled` ──────────────────────────────
  useEffect(() => {
    if (!enabled || !journeyToken) {
      // Stop tracking if not needed
      try { subRef.current?.remove(); } catch { /* expo-location web can throw here */ }
      subRef.current = null;
      setState(INITIAL);
      return;
    }

    // Web: expo-location has limited web support — skip silently.
    // Return the SAME state object when nothing changes so React skips the
    // re-render.
    if (Platform.OS === 'web') {
      setState(s => (
        s.tracking === false && s.error === WEB_UNAVAILABLE
          ? s
          : { ...s, tracking: false, error: WEB_UNAVAILABLE }
      ));
      return;
    }

    let cancelled = false;

    (async () => {
      const ok = await requestPermissionRef.current();
      if (!ok || cancelled) return;

      // Take an immediate fix to seed the UI
      try {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!cancelled) await handlePositionRef.current(pos);
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
          (pos) => { if (!cancelled) handlePositionRef.current(pos); },
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
  }, [enabled, journeyToken]);

  // ── A10: retry held readings on a timer ───────────────────────────────────
  // Needed because a new GPS reading only arrives after she moves 50 m, so
  // "retry on the next reading" could leave her last position unsent for a
  // long time while she stands still.
  //
  // A10b: this runs on its own, not inside the watcher effect above, because
  // it must outlive the watcher. When the check-in time passes, tracking
  // stops but the journey is still open and her circle has just been told
  // something is wrong — that is exactly when the reading still waiting on
  // the phone matters most. It keeps going until she taps "I'm safe", stops
  // sharing, or the journey is cleared (the screen then passes
  // keepRetryingHeld = false, and those paths also clear what is held).
  useEffect(() => {
    if (!journeyToken || Platform.OS === 'web') return;
    if (!enabled && !keepRetryingHeld) return;
    void flushHeldRef.current();   // once now (readings held before the app was reopened)
    const retryTimer = setInterval(() => { void flushHeldRef.current(); }, RETRY_INTERVAL_MS);
    return () => clearInterval(retryTimer);
  }, [enabled, keepRetryingHeld, journeyToken]);

  return state;
}