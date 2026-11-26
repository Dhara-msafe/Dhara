/**
 * D-42: Uber/Rapido-style live tracking for Head Out, behind
 * EXPO_PUBLIC_HEADOUT_BG_TRACKING (default OFF).
 *
 * While a journey is active — and ONLY then — an Android foreground service
 * with a visible notification keeps sending location updates to the existing
 * PATCH /api/journey/status/{token}/location endpoint, even with the app
 * closed or the screen off. The server throttles (25 s), keeps only
 * last_location + a short location_log, and the A12 retention tiers apply
 * unchanged: the live trail dies with the journey; nothing new is stored.
 *
 * Hard conditions (owner mandate, 26 Nov, recorded in D-42):
 *  - per-journey opt-in, after the Play "prominent disclosure" screen, BEFORE
 *    any OS permission ask (BgTrackingDisclosure.tsx renders it; this module
 *    refuses to start without `disclosureAgreed: true`);
 *  - auto-stop at arrival/check-in ("I'm safe"), stop-sharing, and timeout —
 *    the app stops it on those actions, and the background task itself
 *    self-stops past the journey's hard deadline, so a killed app can never
 *    leave tracking running;
 *  - Family Journey untouched: this module is only ever started from the Head
 *    Out active screen with a Head Out journey token.
 *
 * Android only. iOS background location is a separate ticket (needs its own
 * plist strings and review); on iOS/web every call here is a safe no-op.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { storage } from '@/src/utils/storage';
import { API_BASE } from '@/src/auth';

export const HEADOUT_BG_TRACKING = process.env.EXPO_PUBLIC_HEADOUT_BG_TRACKING === 'true';

export const BG_TASK = 'headout-journey-location';
const K_CTX = 'headout_bg_tracking_ctx_v1';
// Same key auth.tsx uses (secure store) — read-only here, never copied out.
const AUTH_TOKEN_KEY = 'gk_token';

/** What the background task needs to know, written at start, removed at stop. */
export interface BgTrackingCtx {
  journeyToken: string;
  /** ISO time past which the task must stop itself even if the app never
   * comes back: the journey's deadline plus the grace below. */
  autoStopAt: string;
  startedAt: string;
}

/** Timeout guard: how long past the journey's expected check-in the service
 * may run before self-stopping. Covers the deadline-worker's grace and an
 * "Extend time" the ctx hasn't heard about, without ever tracking for hours. */
export const AUTO_STOP_GRACE_MS = 45 * 60 * 1000;

/** Pure: compute the task's self-stop time from the journey's deadline. */
export function computeAutoStopAt(expectedCheckinAtIso: string | null, nowIso: string): string {
  const base = expectedCheckinAtIso ? Date.parse(expectedCheckinAtIso) : NaN;
  const now = Date.parse(nowIso);
  const from = Number.isFinite(base) ? base : now;
  return new Date(from + AUTO_STOP_GRACE_MS).toISOString();
}

/** Pure: should the background task stop itself? */
export function shouldAutoStop(ctx: Pick<BgTrackingCtx, 'autoStopAt'> | null, nowIso: string): boolean {
  if (!ctx) return true;             // no context = no journey = nothing to track
  const stopAt = Date.parse(ctx.autoStopAt);
  return !Number.isFinite(stopAt) || Date.parse(nowIso) >= stopAt;
}

/** Pure: the upload body for one fix — same shape useJourneyGPS sends, so the
 * server's A07 rules (true capture time, source must be 'gps') hold. */
export function buildLocationBody(loc: { coords: { latitude: number; longitude: number; accuracy: number | null }; timestamp: number }, nowMs: number) {
  return {
    lat: loc.coords.latitude,
    lng: loc.coords.longitude,
    accuracy: loc.coords.accuracy ?? undefined,
    area: '',                                   // reverse-geocoding stays on-device, foreground only
    source: 'gps' as const,
    age_seconds: Math.max(0, Math.round((nowMs - loc.timestamp) / 1000)),
  };
}

const bgSupported = () => HEADOUT_BG_TRACKING && Platform.OS === 'android';

async function readCtx(): Promise<BgTrackingCtx | null> {
  try {
    const raw = await AsyncStorage.getItem(K_CTX);
    return raw ? (JSON.parse(raw) as BgTrackingCtx) : null;
  } catch { return null; }
}

async function stopUpdates(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(BG_TASK)) {
      await Location.stopLocationUpdatesAsync(BG_TASK);
    }
  } catch { /* already stopped or task never registered */ }
  AsyncStorage.removeItem(K_CTX).catch(() => {});
}

// ── The background task ──────────────────────────────────────────────────────
// Defined at module scope (TaskManager requirement) and registered on app
// start via the import in app/_layout.tsx, so fixes delivered to a cold,
// headless process still reach the handler.
if (bgSupported()) {
  TaskManager.defineTask(BG_TASK, async ({ data, error }) => {
    if (error) return;
    const ctx = await readCtx();
    const now = Date.now();
    if (shouldAutoStop(ctx, new Date(now).toISOString())) {
      await stopUpdates();                       // timeout / no journey: self-stop
      return;
    }
    const locations = (data as { locations?: Array<any> } | undefined)?.locations ?? [];
    const latest = locations[locations.length - 1];
    if (!latest) return;
    let authToken: string | null = null;
    try { authToken = await storage.secureGet<string | null>(AUTH_TOKEN_KEY, null); } catch { /* stay null */ }
    if (!authToken || !ctx) return;              // signed out mid-journey: upload nothing
    try {
      await fetch(`${API_BASE}/api/journey/status/${ctx.journeyToken}/location`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(buildLocationBody(latest, now)),
      });
    } catch { /* offline: the next fix retries; nothing is queued on-device */ }
  });
}

/**
 * Start the foreground-service tracking for one journey. Refuses unless the
 * per-journey disclosure was agreed (Play prominent disclosure comes BEFORE
 * any OS permission ask). Returns what happened so the screen can say it.
 */
export async function startJourneyBgTracking(opts: {
  journeyToken: string;
  expectedCheckinAt: string | null;
  disclosureAgreed: boolean;
}): Promise<'started' | 'unsupported' | 'no_disclosure' | 'fg_denied' | 'bg_denied' | 'failed'> {
  if (!bgSupported()) return 'unsupported';
  if (!opts.disclosureAgreed) return 'no_disclosure';
  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') return 'fg_denied';
    // Android 10+: "Allow all the time" is a second, separate ask.
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg.status !== 'granted') return 'bg_denied';
    const ctx: BgTrackingCtx = {
      journeyToken: opts.journeyToken,
      autoStopAt: computeAutoStopAt(opts.expectedCheckinAt, new Date().toISOString()),
      startedAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(K_CTX, JSON.stringify(ctx));
    await Location.startLocationUpdatesAsync(BG_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 20_000,                      // the server throttles to 25 s anyway
      distanceInterval: 25,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        // The visible notification D-42 requires: honest about what runs and why.
        notificationTitle: 'DHARA — journey sharing is on',
        notificationBody: 'Your live location is shared with your Trusted Circle until you mark yourself safe.',
        notificationColor: '#0B2545',
        killServiceOnDestroy: false,             // keep tracking with the app swiped away
      },
    });
    return 'started';
  } catch {
    await stopUpdates();
    return 'failed';
  }
}

/** Stop tracking (arrival / "I'm safe" / check-in close / stop sharing / journey gone). */
export async function stopJourneyBgTracking(): Promise<void> {
  if (!HEADOUT_BG_TRACKING || Platform.OS === 'web') return;
  await stopUpdates();
}

/** Safety net for app launches: if the service is running but the given
 * journey is no longer the active one (or none is), stop it. */
export async function reconcileBgTracking(activeJourneyToken: string | null): Promise<void> {
  if (!bgSupported()) return;
  const ctx = await readCtx();
  if (!ctx) { await stopUpdates(); return; }
  if (!activeJourneyToken || ctx.journeyToken !== activeJourneyToken
      || shouldAutoStop(ctx, new Date().toISOString())) {
    await stopUpdates();
  }
}

/** For the active screen's status line. */
export async function isBgTrackingRunning(): Promise<boolean> {
  if (!bgSupported()) return false;
  try { return await Location.hasStartedLocationUpdatesAsync(BG_TASK); } catch { return false; }
}
