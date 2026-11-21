import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Linking, Modal, AppState, TextInput, Image, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { theme } from '@/src/theme';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { getCircle, type Contact } from '@/src/women/api';
import { useAuth } from '@/src/auth';
import { useJourneyGPS } from '@/src/hooks/useJourneyGPS';
import { API_BASE } from '@/src/apiBase';
import { getLastLocation, clearLocationCache } from '@/src/safety/locationCache';
import { isUploadableLastGaspFix } from '@/src/safety/lastGaspGuard';
import { alarmStatus, needsServerJourney, retryDelayMs, journeyClientRef, ALARM_COPY } from '@/src/safety/journeyAlarm';
import {
  IDLE_ALERT_REPORT, parseMissedCheckinReply, alertStatusText, recipientAlertLabel,
  closeOutcome, CLOSE_COPY, type AlertReportState,
} from '@/src/safety/journeyAlarm';
import { formatLocationFix } from '@/src/safety/locationPresentation';
import { useLocationUpload } from '@/src/hooks/useLocationUpload';
import { ActiveJourneyMap } from '@/src/women/ActiveJourneyMap';
import { DestinationMapPicker } from '@/src/women/DestinationMapPicker';
import { isValidCoord, isValidRadius, haversineMeters, distanceToPolylineMeters } from '@/src/utils/mapValidation';
import { listAcceptedRecipients, getPhotoViewToken, type InviteLink } from '@/src/trustedCircle/api';

import { openExternal } from '@/src/outbound';
// NF-UI-REV-13 (Group G follow-up, DHARA UI Revision v2.2.1): visible
// keyboard-focus ring only — accessibility roles/labels/touch-targets were
// already compliant on this screen. No journey/GPS/alert logic changes.
import { focusRingStyle } from '@/src/a11yFocus';
const c = theme.colors;
const GUARDIAN_SHARE_ENABLED   = process.env.EXPO_PUBLIC_GUARDIAN_SHARE === 'true';
// GO1B: Live GPS tracking — default OFF; guardian status page shows last known area
const GO1B_GPS_ENABLED = process.env.EXPO_PUBLIC_GO1B_GPS === 'true';
const TRUSTED_CIRCLE_RECIPIENT = process.env.EXPO_PUBLIC_TRUSTED_CIRCLE_RECIPIENT === 'true';
// Pilot simulation environment: when ON, "Prepare alert" shows an in-app
// "Simulated — nothing sent" preview instead of opening the device's real
// SMS composer. Default ON for this isolated pilot. Set to "false" to
// restore the original production sms: intent behaviour everywhere.
const ALERT_SIMULATION_MODE = process.env.EXPO_PUBLIC_ALERT_SIMULATION_MODE !== 'false';
// GO1C: live route map, ETA, arrival-zone detection, route-deviation
// detection. Independently gated from GO1B (raw GPS upload) — GO1C reuses
// GO1B's position stream but adds the Directions fetch + client-side
// geofence/deviation math, so an operator can keep GO1B (location sharing
// with the circle) on while leaving this heavier/newer layer off.
const GO1C_LIVE_ROUTE_ENABLED = process.env.EXPO_PUBLIC_GO1C_LIVE_ROUTE === 'true';
// Demo simulator — QA-only. When false (the default) this flag has zero
// effect on the production code path: all state/refs it uses are never
// allocated, all handlers are no-ops, and no JSX is rendered.
const HEADOUT_DEMO_ENABLED = process.env.EXPO_PUBLIC_HEADOUT_DEMO === 'true';
const DEFAULT_ARRIVAL_RADIUS_M = 200;
// Re-fetch the route/ETA at most this often — a live safety map should stay
// reasonably current, but re-querying Directions on every 30s GPS tick would
// multiply a billed API's call volume for no real accuracy gain at this scale.
const DIRECTIONS_REFRESH_MS = 2 * 60 * 1000;
// "Outside the expected route" trigger: perpendicular distance from the route
// line. Wide enough to absorb ordinary GPS drift and minor path choices
// (crossing a street, the other side of a block) without false-alarming.
const ROUTE_DEVIATION_METERS = 150;
// "Moving away from your destination" trigger: this many consecutive GPS
// fixes with strictly increasing distance-to-destination, not just one noisy
// reading.
const MOVING_AWAY_STREAK = 3;
// How long a dismissed arrived/deviated prompt stays dismissed before it's
// eligible to reappear (it can still reappear sooner if the underlying
// condition clears and re-triggers, e.g. leaving and re-entering the zone).
const DISMISS_COOLDOWN_MS = 5 * 60 * 1000;
// Row 25 (21 Nov 2026): the 15-minute deviation auto-escalation to the
// trusted circle was REMOVED by owner decision. Deviation is now an in-app
// prompt only ("Off your usual route — are you okay?"); nothing is ever sent
// to the circle automatically because of a deviation. The circle is only
// contacted by the missed-check-in path (deadline_worker.py) or an explicit
// "Need help" from the traveller.

// "Check-in not received" screen (shown once the check-in timer expires).
// GRACE_MINUTES must match deadline_worker.py's _GRACE_MINUTES on the
// backend — this is purely a DISPLAY countdown to the same server-side grace
// window that already exists; it does not independently control when the
// server actually escalates (changing one without the other would make this
// countdown lie about when the circle actually gets notified).
const GRACE_MINUTES = 5;
// A GPS fix older than this is shown as "looks offline" — this can't know
// the phone's actual network state, only that we haven't heard a new
// position in a while, which is the honest signal actually available here.
const OFFLINE_THRESHOLD_MS = 2 * 60 * 1000;

interface RouteInfo {
  polyline: [number, number][];
  distanceMeters: number;
  durationSeconds: number;
  provider: string;
  fetchedAt: number;
}

// Must match head-out/destination.tsx, radius.tsx and circle.tsx's own
// SESSION_KEY literal exactly — those screens write a session here; this one
// only ever reads it. Setup itself now lives in the 3-step wizard
// (app/women/head-out/*) — this screen redirects there when no session exists.
const SESSION_KEY = 'ws_head_out_session';

interface HeadOutSession {
  destination: string;
  startTime: number;
  durationMins: number;
  radiusMeters?: number;   // GO1A: optional, undefined in sessions created before GO1A
  savedPlaceId?: string;   // GO1A: optional reference to a saved place
  latitude?: number | null;  // GO1A map pilot: manual pin position, never device GPS
  longitude?: number | null;
  /** Trusted Circle link ids to notify for this journey — persisted (unlike
   * the old selectedRecipients React state) so a journey record can still be
   * created/recreated for this session after a remount, e.g. when the Head
   * Out wizard hands off a freshly created session that hasn't gotten its
   * journey token yet. Undefined for sessions created before this field existed. */
  recipientLinkIds?: string[];
  /** Minutes before expected_checkin_at the OWNER gets a reminder push.
   * null/undefined = no reminder. Undefined for sessions created before this
   * field existed. See deadline_worker.py's _run_reminders. */
  remindBeforeMins?: number | null;
  /** Whether a missed check-in should actually escalate to the trusted
   * circle. Undefined is treated as true (matches the backend's default —
   * sessions created before this field existed keep the original always-notify
   * behaviour). See deadline_worker.py's auto_notify_on_no_response gate. */
  autoNotifyOnNoResponse?: boolean;
  /** A35: she tapped "I'm safe" but the server has not confirmed it yet.
   * Persisted so the retry resumes if the app is closed and reopened. */
  pendingSafe?: boolean;
  /** A35: she tapped "Stop sharing" but the server has not confirmed it yet. */
  pendingRevoke?: boolean;
  /** Server journey token, persisted so a remount never creates a second journey. */
  journeyToken?: string | null;
}

function formatCountdown(secs: number): string {
  if (secs <= 0) return '0:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Demo simulator coordinates (University of Hyderabad, Gachibowli) ──────────
// Dead code when EXPO_PUBLIC_HEADOUT_DEMO is absent or false.
const DEMO_ROUTE_WAYPOINTS = [
  { lat: 17.4652, lng: 78.3488 }, // Main Gate — departure
  { lat: 17.4645, lng: 78.3498 },
  { lat: 17.4635, lng: 78.3510 },
  { lat: 17.4625, lng: 78.3520 }, // near Hostel, still outside 200 m zone
];
const DEMO_OFF_ROUTE_POINTS = [
  { lat: 17.4680, lng: 78.3450 },
  { lat: 17.4700, lng: 78.3430 },
  { lat: 17.4720, lng: 78.3415 },
  { lat: 17.4740, lng: 78.3400 }, // clearly moving away
];

export default function HeadOut() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token: authToken, user } = useAuth() as any;

  const [session, setSession] = useState<HeadOutSession | null>(null);
  const [secsLeft, setSecsLeft] = useState(0);
  const [expired, setExpired] = useState(false);
  // Seconds remaining in the post-expiry grace window before the server's
  // own deadline_worker would auto-notify the circle — null until expired.
  const [graceSecsLeft, setGraceSecsLeft] = useState<number | null>(null);
  const [circle, setCircle] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  // GO1B: journey token created when session starts (so GPS can start immediately)
  const [journeyToken, setJourneyToken] = useState<string | null>(null);
  // GPS permission-contract states (handle_permissions_contract)
  // locationConsentGiven: user tapped "Allow location" on the pre-OS rationale card
  const [locationConsentGiven, setLocationConsentGiven] = useState(false);
  // showPermDeniedSettings: hook reported canAskAgain=false — show "Open Settings" prompt
  const [showPermDeniedSettings, setShowPermDeniedSettings] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Pilot simulation preview for "Prepare alert" (Batch 2) — holds the
  // message body + recipient names shown in the preview Modal; never sent.
  const [simPreview, setSimPreview] = useState<{ body: string; recipients: string[] } | null>(null);
  // A30: registering the journey with the server is retried until it works.
  // createInFlightRef stops two requests overlapping; createFailures drives
  // the retry timing and what the screen tells her (see src/safety/journeyAlarm.ts).
  const createInFlightRef = useRef(false);
  const [createFailures, setCreateFailures] = useState(0);
  const [creatingJourney, setCreatingJourney] = useState(false);
  // A35: "I'm safe" and "Stop sharing" wait for the server's answer and are
  // retried until it comes. closeInFlightRef stops two "safe" requests overlapping.
  const closeInFlightRef = useRef(false);
  const [closingJourney, setClosingJourney] = useState(false);
  const [closeFailures, setCloseFailures] = useState(0);
  const [revokeFailures, setRevokeFailures] = useState(0);
  // Who to notify for this journey now comes from the session itself (set by
  // the Head Out wizard's Trusted Circle step), not from a checkbox list on
  // this screen — this screen no longer has one.
  // useMemo (not a plain `?? []`) so this is the SAME array reference across
  // renders when recipientLinkIds is absent — otherwise every render would
  // hand effects/deps a fresh empty-array identity and re-run them needlessly.
  const selectedRecipients = useMemo(() => session?.recipientLinkIds ?? [], [session?.recipientLinkIds]);

  // "Check-in not received" screen: who specifically will be notified, with
  // their name/photo — reuses the same Trusted Circle API circle.tsx already
  // uses, fetched only once we actually need it (the journey has expired),
  // not on every Head Out screen load.
  const [notifyRecipients, setNotifyRecipients] = useState<InviteLink[]>([]);
  const [notifyPhotoToken, setNotifyPhotoToken] = useState<string | null>(null);
  const [failedNotifyPhotos, setFailedNotifyPhotos] = useState<Record<string, boolean>>({});
  const notifyFetchedRef = useRef(false);
  useEffect(() => {
    if (!expired || notifyFetchedRef.current || !authToken || selectedRecipients.length === 0) return;
    notifyFetchedRef.current = true;
    Promise.all([listAcceptedRecipients(authToken), getPhotoViewToken(authToken)])
      .then(([all, token]) => {
        setNotifyRecipients(all.filter(l => selectedRecipients.includes(l.id)));
        setNotifyPhotoToken(token);
      })
      .catch(() => {});
  }, [expired, authToken, selectedRecipients]);
  useEffect(() => { if (!expired) notifyFetchedRef.current = false; }, [expired]);

  const notifyPhotoUri = (ownerId: string | null) =>
    ownerId && notifyPhotoToken ? `${API_BASE}/api/profile/photo/${ownerId}?token=${encodeURIComponent(notifyPhotoToken)}` : null;

  // GO1C: live route / ETA / arrival / deviation
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const distanceHistoryRef = useRef<number[]>([]);   // recent distance-to-destination readings, oldest first
  const [arrivedDismissedAt, setArrivedDismissedAt] = useState<number | null>(null);
  const [deviatedDismissedAt, setDeviatedDismissedAt] = useState<number | null>(null);
  const [extending, setExtending] = useState(false);
  // Fix 6 (21 Nov): after "I'm safe" is confirmed by the server, show a
  // "You're marked safe" screen instead of silently bouncing to wizard step 1.
  const [safeConfirmed, setSafeConfirmed] = useState(false);
  const [extendError, setExtendError] = useState<string | null>(null);
  const [showChangeDest, setShowChangeDest] = useState(false);
  const [changeDestLabel, setChangeDestLabel] = useState('');
  const [changeDestCoord, setChangeDestCoord] = useState<{ lat: number; lng: number } | null>(null);
  const [changingDest, setChangingDest] = useState(false);
  const [changeDestError, setChangeDestError] = useState<string | null>(null);

  // Load persisted session + circle every time this screen gains focus —
  // NOT just on first mount. A mount-only effect would never see a session
  // written moments earlier by the Head Out wizard's last step (circle.tsx,
  // which does router.replace('/women/head-out') after writing it) and
  // would keep showing stale state. Re-running on every focus also means
  // ending a session and starting a fresh one immediately picks up
  // correctly without needing a full remount.
  //
  // NOTE: this file lives at app/women/head-out/index.tsx (not a sibling
  // app/women/head-out.tsx file next to the head-out/ folder) specifically
  // to avoid a file+folder name collision at the router level for the
  // exact path "/women/head-out" — see git history around Nov 2026 for the
  // routing bug that motivated this move.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          const [raw, contacts] = await Promise.all([
            AsyncStorage.getItem(SESSION_KEY),
            getCircle(),
          ]);
          if (!active) return;
          setCircle(contacts);
          const saved = raw ? JSON.parse(raw) : null;
          setSession(saved);
          if (saved?.journeyToken) setJourneyToken(saved.journeyToken);
        } catch {}
        if (active) setLoading(false);
      })();
      return () => { active = false; };
    }, []),
  );

  // Journey-token recovery: creates the backend journey record for a session
  // that doesn't have one yet — the ONLY journey-creation path now that the
  // Head Out wizard (app/women/head-out/*) writes the session directly and
  // hands off here. Also covers this screen remounting after the app was
  // closed and reopened mid-session, since journeyToken has never been
  // persisted — only the session itself is.
  //
  // A30: this used to be ONE silent attempt. If it failed, the server never
  // learned about the journey, so no server alarm existed, yet the screen
  // still showed a running timer and she was not told. Now:
  //   - the attempt is retried (2 s, 5 s, 10 s, then every 30 s) for as long
  //     as the journey is active on this screen and no token has come back;
  //   - every attempt carries the same client_ref, so the server returns the
  //     same journey if an earlier attempt got through but its reply was lost;
  //   - the screen says plainly whether the server alarm is armed (see the
  //     "headout-alarm-*" blocks in the render below).
  const serverJourneyNeeded = !!session &&
    needsServerJourney(GO1B_GPS_ENABLED, session.recipientLinkIds?.length ?? 0);

  // Read the session and user through refs so createJourney keeps one
  // identity while the journey runs. Otherwise any session update (extend
  // time, change destination) would restart the retry wait from the top.
  const createSessionRef = useRef(session);
  useEffect(() => { createSessionRef.current = session; }, [session]);
  const userIdForRef = useRef<string | null>(null);
  useEffect(() => { userIdForRef.current = (user as any)?.id ?? null; }, [user]);

  const createJourney = useCallback(async (): Promise<boolean> => {
    const session = createSessionRef.current;
    if (!session || !authToken || journeyToken || createInFlightRef.current) return false;
    createInFlightRef.current = true;
    setCreatingJourney(true);
    try {
      const r = await fetch(`${API_BASE}/api/journey/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          destination: session.destination,
          // Send the time actually LEFT so the server deadline matches the on-screen timer.
          duration_mins: Math.max(1, Math.ceil((session.startTime + session.durationMins * 60000 - Date.now()) / 60000)),
          recipient_link_ids: session.recipientLinkIds ?? [],
          remind_before_mins: session.remindBeforeMins ?? null,
          auto_notify_on_no_response: session.autoNotifyOnNoResponse ?? true,
          destination_lat: session.latitude ?? null,
          destination_lng: session.longitude ?? null,
          radius_meters: session.radiusMeters ?? null,
          client_ref: journeyClientRef(userIdForRef.current, session.startTime),
        }),
      });
      if (!r.ok) throw new Error(`journey create failed: ${r.status}`);
      const data = await r.json();
      if (!data?.token) throw new Error('journey create returned no token');
      // She may have ended this journey (or started another) while the
      // request was in flight. The server now holds a journey the phone has
      // already finished with: close it straight away, or its alarm would
      // fire later and alert her circle for a journey she ended safely.
      const latest = createSessionRef.current;
      if (!latest || latest.startTime !== session.startTime) {
        fetch(`${API_BASE}/api/journey/status/${data.token}/safe`, {
          method: 'PATCH', headers: { Authorization: `Bearer ${authToken}` },
        }).catch(() => {});
        return false;
      }
      setJourneyToken(data.token);
      setCreateFailures(0);
      const updated = { ...latest, journeyToken: data.token };
      setSession(updated);
      AsyncStorage.setItem(SESSION_KEY, JSON.stringify(updated)).catch(() => {});
      return true;
    } catch {
      setCreateFailures(n => n + 1);
      return false;
    } finally {
      createInFlightRef.current = false;
      setCreatingJourney(false);
    }
  }, [authToken, journeyToken]);

  useEffect(() => {
    if (!serverJourneyNeeded || expired || !authToken || journeyToken) return;
    const timer = setTimeout(() => { void createJourney(); }, retryDelayMs(createFailures));
    return () => clearTimeout(timer);
  }, [serverJourneyNeeded, expired, authToken, journeyToken, createFailures, createJourney]);

  const journeyAlarm = alarmStatus({
    needsServerJourney: serverJourneyNeeded,
    hasJourneyToken: !!journeyToken,
    failedAttempts: createFailures,
  });

  // Tick the countdown whenever session changes. Keeps running past the main
  // deadline (instead of stopping dead at 0) so it can also surface a live
  // "time until the server actually notifies your circle" grace countdown —
  // only stops once BOTH the check-in deadline AND the grace window have
  // fully elapsed, since nothing on this screen needs to keep updating after that.
  useEffect(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (!session) { setSecsLeft(0); setExpired(false); setGraceSecsLeft(null); return; }

    const tick = () => {
      const deadline = session.startTime + session.durationMins * 60 * 1000;
      const left = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
      setSecsLeft(left);
      if (left > 0) {
        setExpired(false);
        setGraceSecsLeft(null);
        return;
      }
      setExpired(true);
      const graceDeadline = deadline + GRACE_MINUTES * 60 * 1000;
      const graceLeft = Math.max(0, Math.floor((graceDeadline - Date.now()) / 1000));
      setGraceSecsLeft(graceLeft);
      if (graceLeft === 0 && timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [session]);

  // No session → nothing to do here anymore; send the user into the wizard's
  // first step instead of rendering an inline form (that form now lives at
  // app/women/head-out/destination.tsx, as Step 1 of 3).
  useEffect(() => {
    if (!loading && !session && !safeConfirmed) router.replace('/women/head-out/destination');
  }, [loading, session, router]);

  const endSession = useCallback(async () => {
    // A35: this used to send "safe" once and clear the journey on the phone
    // whatever happened. If the request failed, the server's alarm kept
    // running and could alert her circle after she had said she was safe.
    // Now the journey is cleared here only once the server has confirmed.
    // Until then it is marked pendingSafe, shown as pending, and retried.
    if (authToken && journeyToken) {
      if (closeInFlightRef.current) return;
      closeInFlightRef.current = true;
      setClosingJourney(true);
      let status: number | null = null;
      try {
        const r = await fetch(`${API_BASE}/api/journey/status/${journeyToken}/safe`, {
          method: 'PATCH', headers: { Authorization: `Bearer ${authToken}` },
        });
        status = r.status;
      } catch { /* no reply: stays null and is retried */ }
      closeInFlightRef.current = false;
      setClosingJourney(false);
      if (closeOutcome(status) !== 'done') {
        setCloseFailures(n => n + 1);
        const current = createSessionRef.current;
        if (current && !current.pendingSafe) {
          const updated = { ...current, pendingSafe: true };
          setSession(updated);
          AsyncStorage.setItem(SESSION_KEY, JSON.stringify(updated)).catch(() => {});
        }
        return;
      }
    }
    setCloseFailures(0);
    setRevokeFailures(0);
    setSafeConfirmed(true);   // fix 6: show the confirmation instead of jumping to step 1
    await AsyncStorage.removeItem(SESSION_KEY).catch(() => {});
    // A40: the journey is over, so the location remembered on this phone for
    // it must not stay behind. (Not cleared on a missed check-in: she may
    // still need the Plus Code for her own alert SMS.)
    await clearLocationCache(((user as any)?.id) ?? 'anon');
    setSession(null);
    setExpired(false);
    setJourneyToken(null);
    setSharingRevoked(false);
    setRouteInfo(null);
    referenceRouteRef.current = null;
    referenceRouteProviderRef.current = null;
    distanceHistoryRef.current = [];
    setCreateFailures(0); // A30: a future session starts its own create attempts from zero
  }, [authToken, journeyToken, user]);

  // A35: keep trying a pending "I'm safe" until the server confirms. Starts
  // straight away when the screen reopens with a pending one saved.
  const pendingSafe = !!session?.pendingSafe;
  useEffect(() => {
    if (!pendingSafe || !authToken || !journeyToken) return;
    const timer = setTimeout(() => { void endSession(); }, retryDelayMs(closeFailures));
    return () => clearTimeout(timer);
  }, [pendingSafe, authToken, journeyToken, closeFailures, endSession]);

  // Part B/P4: report a missed check-in to the backend — waits out the SAME
  // grace window shown on the "Check-in not received" screen (GRACE_MINUTES)
  // rather than firing the instant the timer hits zero, so "Will notify your
  // circle in X" on that screen is an honest countdown, not a lie about a
  // notification that already went out. "Raise alert now" (below) is the
  // only way to skip this wait deliberately. Idempotent either way —
  // deadline_worker.py's own server-side grace period (independent of this
  // client-driven call) would eventually fire the same alert if this device
  // goes offline/backgrounded before the countdown finishes; both paths
  // share one idempotency key per journey+recipient, so the circle is never
  // double-notified regardless of which path actually fires first.
  const missedReportedRef = useRef(false);
  // A31: what the server said happened to the alert. The screen wording
  // follows this, never the phone's own countdown.
  const [alertReport, setAlertReport] = useState<AlertReportState>(IDLE_ALERT_REPORT);
  const [alertReportFailures, setAlertReportFailures] = useState(0);
  const alertTriggerRef = useRef<'auto' | 'manual' | null>(null);

  // ── Demo simulator state (allocated only when HEADOUT_DEMO_ENABLED) ────────
  // When the flag is off every ref/state here stays at its initial value and
  // has no observable effect on the production render path.
  const [demoGpsPoint, setDemoGpsPoint] = useState<{
    latitude: number; longitude: number; accuracy: number; lastFixAt: number;
  } | null>(null);
  const demoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Cleanup on unmount
  useEffect(() => () => {
    if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
  }, []);
  const reportMissedCheckin = useCallback(async (trigger: 'auto' | 'manual') => {
    if (!authToken || !journeyToken) return;
    setAlertReport(prev => ({ ...prev, report: 'sending' }));
    try {
      const r = await fetch(`${API_BASE}/api/journey/status/${journeyToken}/missed-checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ trigger }),
      });
      if (!r.ok) throw new Error(`missed-checkin failed: ${r.status}`);
      setAlertReport(parseMissedCheckinReply(await r.json()));
      setAlertReportFailures(0);
    } catch {
      setAlertReport(prev => ({ ...prev, report: 'failed' }));
      setAlertReportFailures(n => n + 1);
    }
  }, [authToken, journeyToken]);

  const autoNotifyOff = session?.autoNotifyOnNoResponse === false;
  useEffect(() => {
    if (!expired) {
      missedReportedRef.current = false;
      alertTriggerRef.current = null;
      setAlertReport(IDLE_ALERT_REPORT);
      setAlertReportFailures(0);
      return;
    }
    // Automatic report when the grace countdown ends. Not sent when she chose
    // "Do nothing" for missed check-ins (her choice was being overridden
    // here before), and not sent while an "I'm safe" is waiting to reach the
    // server (she has told us she is safe).
    if (
      graceSecsLeft === 0 && authToken && journeyToken && !missedReportedRef.current &&
      !autoNotifyOff && !pendingSafe
    ) {
      missedReportedRef.current = true;
      alertTriggerRef.current = 'auto';
      void reportMissedCheckin('auto');
    }
  }, [expired, graceSecsLeft, authToken, journeyToken, autoNotifyOff, pendingSafe, reportMissedCheckin]);

  // A31: a report that could not reach the server is retried, on the same
  // timing as journey registration. The server will not raise a second alert
  // for the same journey and person, so repeating it is safe.
  useEffect(() => {
    if (alertReport.report !== 'failed' || !expired || !alertTriggerRef.current || pendingSafe) return;
    const trigger = alertTriggerRef.current;
    const timer = setTimeout(() => { void reportMissedCheckin(trigger); }, retryDelayMs(alertReportFailures));
    return () => clearTimeout(timer);
  }, [alertReport.report, expired, alertReportFailures, pendingSafe, reportMissedCheckin]);

  const raiseAlertNow = useCallback(() => {
    if (!authToken || !journeyToken || missedReportedRef.current) return;
    missedReportedRef.current = true;
    alertTriggerRef.current = 'manual';
    void reportMissedCheckin('manual');
  }, [authToken, journeyToken, reportMissedCheckin]);

  // "Stop sharing" — withdraws location/status sharing without claiming
  // arrival (distinct from endSession/"I'm home safely"). Reuses the same
  // /revoke endpoint guardian-share.tsx already calls; this is just the first
  // time it's exposed from the main Head Out screen itself rather than only
  // the separate guardian-link flow. The check-in timer keeps running —
  // revoking sharing stops what your circle can see, it doesn't end the journey.
  const [sharingRevoked, setSharingRevoked] = useState(false);
  const [revokingShare, setRevokingShare] = useState(false);
  const stopSharing = useCallback(async () => {
    if (!journeyToken || !authToken || revokingShare) return;
    setRevokingShare(true);
    // A35: a failed request used to do nothing and show nothing, so she could
    // believe sharing had stopped when it had not. Now it is marked
    // pendingRevoke, shown as pending, and retried until the server confirms.
    let status: number | null = null;
    try {
      const r = await fetch(`${API_BASE}/api/journey/status/${journeyToken}/revoke`, {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}` },
      });
      status = r.status;
    } catch { /* no reply: stays null and is retried */ }
    setRevokingShare(false);
    const current = createSessionRef.current;
    if (closeOutcome(status) === 'done') {
      setSharingRevoked(true);
      setRevokeFailures(0);
      if (current?.pendingRevoke) {
        const updated = { ...current, pendingRevoke: false };
        setSession(updated);
        AsyncStorage.setItem(SESSION_KEY, JSON.stringify(updated)).catch(() => {});
      }
      return;
    }
    setRevokeFailures(n => n + 1);
    if (current && !current.pendingRevoke) {
      const updated = { ...current, pendingRevoke: true };
      setSession(updated);
      AsyncStorage.setItem(SESSION_KEY, JSON.stringify(updated)).catch(() => {});
    }
  }, [journeyToken, authToken, revokingShare]);

  const pendingRevoke = !!session?.pendingRevoke && !sharingRevoked;
  useEffect(() => {
    if (!pendingRevoke || pendingSafe || !authToken || !journeyToken) return;
    const timer = setTimeout(() => { void stopSharing(); }, retryDelayMs(revokeFailures));
    return () => clearTimeout(timer);
  }, [pendingRevoke, pendingSafe, authToken, journeyToken, revokeFailures, stopSharing]);

  // L2 (21 Nov): helpRequested only drives the confirmation line under the
  // button — the send path itself is unchanged (existing help_requested flow).
  const [helpRequested, setHelpRequested] = useState(false);
  const requestHelp = useCallback(() => {
    if (authToken && journeyToken) {
      setHelpRequested(true);
      fetch(`${API_BASE}/api/journey/status/${journeyToken}/help`, {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}` },
      }).catch(() => {});
    }
  }, [authToken, journeyToken]);

  // GO1C: "Extend time" — pushes the check-in deadline forward without
  // ending the session. Updates the LOCAL session too (startTime/durationMins
  // math) so the on-device countdown stays in sync with the server's new
  // expected_checkin_at rather than drifting until the next recovery effect run.
  const handleExtendTime = useCallback(async (additionalMins: number) => {
    if (!authToken || !journeyToken || !session || extending) return;
    setExtending(true);
    setExtendError(null);
    try {
      const r = await fetch(`${API_BASE}/api/journey/status/${journeyToken}/extend`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ additional_mins: additionalMins }),
      });
      if (!r.ok) throw new Error();
      const updated = { ...session, durationMins: session.durationMins + additionalMins };
      await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(updated)).catch(() => {});
      setSession(updated);
      setArrivedDismissedAt(Date.now());   // the prompt that led here shouldn't immediately reappear
    } catch {
      setExtendError('Could not extend your check-in time. Try again.');
    } finally {
      setExtending(false);
    }
  }, [authToken, journeyToken, session, extending]);

  const handleDismissArrived = useCallback(() => setArrivedDismissedAt(Date.now()), []);

  // ── Demo auto-consent: skip the GPS rationale card in demo mode ────────────
  useEffect(() => { if (HEADOUT_DEMO_ENABLED) setLocationConsentGiven(true); }, []);

  // ── Demo simulator handlers ────────────────────────────────────────────────
  // Each handler is a no-op when HEADOUT_DEMO_ENABLED is false (the guard at
  // the top means the entire block is unreachable in production).
  const handleDemoStartRoute = useCallback(() => {
    if (!HEADOUT_DEMO_ENABLED) return;
    if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
    let idx = 0;
    const advance = () => {
      const pt = DEMO_ROUTE_WAYPOINTS[idx];
      setDemoGpsPoint({ latitude: pt.lat, longitude: pt.lng, accuracy: 12, lastFixAt: Date.now() });
      idx++;
      if (idx >= DEMO_ROUTE_WAYPOINTS.length) {
        if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
        demoIntervalRef.current = null;
      }
    };
    advance();
    demoIntervalRef.current = setInterval(advance, 1500);
  }, []);

  const handleDemoEnterZone = useCallback(() => {
    if (!HEADOUT_DEMO_ENABLED || !session?.latitude || !session?.longitude) return;
    if (demoIntervalRef.current) { clearInterval(demoIntervalRef.current); demoIntervalRef.current = null; }
    // Place the simulated GPS exactly on the destination so distanceToDestination ≈ 0,
    // which makes the real hasArrived logic evaluate to true.
    setDemoGpsPoint({ latitude: session.latitude, longitude: session.longitude, accuracy: 10, lastFixAt: Date.now() });
  }, [session]);

  const handleDemoGoOffRoute = useCallback(() => {
    if (!HEADOUT_DEMO_ENABLED) return;
    if (demoIntervalRef.current) { clearInterval(demoIntervalRef.current); demoIntervalRef.current = null; }
    // Fire four positions with strictly increasing distance from destination to
    // fill distanceHistoryRef (MOVING_AWAY_STREAK=3) so the real movingAway
    // logic evaluates to true without needing a live route reference.
    DEMO_OFF_ROUTE_POINTS.forEach((pt, i) => {
      setTimeout(() => {
        setDemoGpsPoint({ latitude: pt.lat, longitude: pt.lng, accuracy: 15, lastFixAt: Date.now() });
      }, i * 300);
    });
  }, []);

  const handleDemoMissCheckIn = useCallback(() => {
    if (!HEADOUT_DEMO_ENABLED || !session) return;
    if (demoIntervalRef.current) { clearInterval(demoIntervalRef.current); demoIntervalRef.current = null; }
    // Backdate the session so the timer reads 0 — the real expired logic fires
    // unchanged. Nothing is persisted to AsyncStorage so the session restores
    // normally if the user refreshes.
    setSession({ ...session, startTime: Date.now() - (session.durationMins * 60000 + 10000) });
  }, [session]);

  // "Check in now" (post-expiry): handleExtendTime ADDS minutes to the
  // existing deadline, which is correct for the 'arrived' screen (deadline is
  // still in the future there). Here, the deadline may already be well in the
  // past (the whole point of this screen), so a flat +15 could still land in
  // the past if more than 15 minutes have elapsed since expiry. This instead
  // computes however many minutes are needed to land the deadline at
  // "now + 15 min" specifically, then reuses handleExtendTime with THAT value.
  const handleCheckInNow = useCallback(async () => {
    if (!session || extending) return;
    const desiredDeadline = Date.now() + 15 * 60 * 1000;
    const currentDeadline = session.startTime + session.durationMins * 60 * 1000;
    const additionalMins = Math.max(1, Math.ceil((desiredDeadline - currentDeadline) / 60000));
    if (authToken && journeyToken) {
      handleExtendTime(additionalMins);   // keeps the server record (and its grace/reminder tracking) in sync too
      return;
    }
    // No backend journey record at all (GO1B_GPS_ENABLED off) — "check in"
    // still means something locally: reset the on-device timer.
    const updated = { ...session, durationMins: session.durationMins + additionalMins };
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(updated)).catch(() => {});
    setSession(updated);
  }, [session, extending, authToken, journeyToken, handleExtendTime]);

  // "I'm okay" acknowledges the deviation AND re-plans from here — forcing a
  // fresh Directions fetch (rather than waiting up to DIRECTIONS_REFRESH_MS)
  // so the reference route the next deviation check runs against reflects
  // where the traveller actually is now, not the path they already left.
  const handleOkayDeviated = useCallback(() => {
    setDeviatedDismissedAt(Date.now());
    setRouteInfo(null);
  }, []);

  // GO1C: "Change destination" — a lightweight inline picker rather than
  // re-entering the full 3-step wizard (which is designed for first-time
  // setup, not editing a journey already in progress).
  const handleOpenChangeDestination = useCallback(() => {
    setChangeDestLabel(session?.destination ?? '');
    setChangeDestCoord(
      isValidCoord(session?.latitude ?? null, session?.longitude ?? null)
        ? { lat: session!.latitude!, lng: session!.longitude! } : null,
    );
    setChangeDestError(null);
    setShowChangeDest(true);
  }, [session]);

  const handleSaveChangeDestination = useCallback(async () => {
    if (!session || !changeDestLabel.trim() || changingDest) return;
    setChangingDest(true);
    setChangeDestError(null);
    try {
      if (authToken && journeyToken) {
        const r = await fetch(`${API_BASE}/api/journey/status/${journeyToken}/destination`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({
            destination: changeDestLabel.trim(),
            lat: changeDestCoord?.lat ?? null,
            lng: changeDestCoord?.lng ?? null,
          }),
        });
        if (!r.ok) throw new Error();
      }
      const updated: HeadOutSession = {
        ...session,
        destination: changeDestLabel.trim(),
        latitude: changeDestCoord?.lat ?? session.latitude ?? null,
        longitude: changeDestCoord?.lng ?? session.longitude ?? null,
      };
      await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(updated)).catch(() => {});
      setSession(updated);
      setRouteInfo(null);                // force a fresh Directions fetch for the new destination
      referenceRouteRef.current = null;  // old route is meaningless against a different destination
      referenceRouteProviderRef.current = null;
      distanceHistoryRef.current = [];   // old trend data no longer means anything against a new destination
      setDeviatedDismissedAt(null);
      setShowChangeDest(false);
    } catch {
      setChangeDestError('Could not update your destination. Try again.');
    } finally {
      setChangingDest(false);
    }
  }, [session, changeDestLabel, changeDestCoord, changingDest, authToken, journeyToken]);

  // GO1B: GPS tracking — active only when session running, flag on, AND user
  // has seen the pre-permission rationale (handle_permissions_contract).
  // Fix 2 (21 Nov): stable callback — an inline arrow here is a new function
  // every render, which (before the hook's own ref-guard) recreated
  // requestPermission and re-ran the GPS start/stop effect in a loop
  // ('Maximum update depth exceeded' after Allow for this journey).
  const handlePermDenied = useCallback(() => setShowPermDeniedSettings(true), []);
  const realGps = useJourneyGPS(
    journeyToken,
    // A35: once she has tapped "I'm safe", stop reading and sending location,
    // even while that request is still waiting to reach the server.
    GO1B_GPS_ENABLED && !!session && !expired && locationConsentGiven && !session.pendingSafe,
    handlePermDenied,
  );
  // Demo simulator: when HEADOUT_DEMO_ENABLED and a demo control button has
  // been pressed, replace the GPS values with the simulated point. Every
  // downstream calculation (hasArrived, hasDeviated, offRoute, distanceToDestination)
  // runs against this data unchanged — the REAL screen logic determines what
  // is shown, not a shortcut. When the flag is off, realGps flows through
  // unchanged so this whole block is unreachable at runtime.
  const gps = (HEADOUT_DEMO_ENABLED && demoGpsPoint)
    ? {
        ...realGps,
        latitude:  demoGpsPoint.latitude,
        longitude: demoGpsPoint.longitude,
        accuracy:  demoGpsPoint.accuracy,
        tracking:  true,
        granted:   true,
        denied:    false,
        lastFixAt: demoGpsPoint.lastFixAt,
      }
    : realGps;

  const hasDestCoord = isValidCoord(session?.latitude ?? null, session?.longitude ?? null);

  // GO1C: fetch/refresh the route line + ETA. Runs once a live fix is
  // available, then again whenever DIRECTIONS_REFRESH_MS has elapsed or the
  // destination itself changed (routeInfo reset to null by handleSaveChangeDestination).
  useEffect(() => {
    if (!GO1C_LIVE_ROUTE_ENABLED || expired || !hasDestCoord || !isValidCoord(gps.latitude, gps.longitude)) return;
    if (routeInfo && Date.now() - routeInfo.fetchedAt < DIRECTIONS_REFRESH_MS) return;
    let cancelled = false;
    if (!authToken) return; // N-02: directions now requires an authenticated session
    fetch(
      `${API_BASE}/api/geo/directions?origin_lat=${gps.latitude}&origin_lng=${gps.longitude}` +
      `&dest_lat=${session!.latitude}&dest_lng=${session!.longitude}`,
      { headers: { Authorization: `Bearer ${authToken}` } },
    )
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled || !data) return;
        setRouteInfo({
          polyline: data.polyline, distanceMeters: data.distance_meters,
          durationSeconds: data.duration_seconds, provider: data.provider,
          fetchedAt: Date.now(),
        });
      })
      .catch(() => {});   // non-fatal — map/ETA just stays on the previous (or no) route
    return () => { cancelled = true; };
  }, [gps.latitude, gps.longitude, hasDestCoord, expired, routeInfo, session, authToken]);

  // GO1C: arrival-zone + route-deviation detection — pure client-side math on
  // data already being collected (no extra network calls beyond the
  // Directions fetch above). Recomputes on every GPS fix.
  const distanceToDestination = useMemo(() => {
    if (!hasDestCoord || !isValidCoord(gps.latitude, gps.longitude)) return null;
    return haversineMeters(gps.latitude!, gps.longitude!, session!.latitude!, session!.longitude!);
  }, [gps.latitude, gps.longitude, hasDestCoord, session]);

  useEffect(() => {
    if (distanceToDestination == null) return;
    const hist = distanceHistoryRef.current;
    hist.push(distanceToDestination);
    if (hist.length > MOVING_AWAY_STREAK) hist.shift();
  }, [distanceToDestination]);

  const arrivalRadius = session?.radiusMeters && isValidRadius(session.radiusMeters)
    ? session.radiusMeters : DEFAULT_ARRIVAL_RADIUS_M;

  // Only trust a fix that is recent AND at least as precise as the arrival radius.
  const fixIsFresh = gps.lastFixAt != null && Date.now() - gps.lastFixAt < OFFLINE_THRESHOLD_MS;
  const fixIsAccurate = gps.accuracy != null && gps.accuracy <= arrivalRadius;
  const hasArrived = GO1C_LIVE_ROUTE_ENABLED && distanceToDestination != null
    && fixIsFresh && fixIsAccurate && distanceToDestination <= arrivalRadius;

  const movingAway = useMemo(() => {
    const hist = distanceHistoryRef.current;
    if (hist.length < MOVING_AWAY_STREAK) return false;
    for (let i = 1; i < hist.length; i++) if (hist[i] <= hist[i - 1]) return false;
    return true;
    // distanceToDestination is read via distanceHistoryRef (a ref, not reactive)
    // below, so it's listed as a dependency purely as the recompute TRIGGER each
    // time a new GPS fix lands — removing it, as the linter suggests, would make
    // this memo never recompute at all.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [distanceToDestination]);

  // Deviation must be checked against a STABLE reference route, not whatever
  // routeInfo happens to be this instant. routeInfo refreshes every 2 min
  // from the traveller's CURRENT position — if deviation math used routeInfo
  // directly, every refresh would silently clear an active deviation (a route
  // recalculated from where you already are always has ~0 distance to you).
  // referenceRouteRef only adopts a new route while the traveller is NOT
  // currently flagged as deviated, so a genuine deviation persists until the
  // user acknowledges it (handleOkayDeviated / handleSaveChangeDestination),
  // not until the next unrelated ETA refresh happens to fire.
  const referenceRouteRef = useRef<[number, number][] | null>(null);
  const referenceRouteProviderRef = useRef<string | null>(null);

  const offRoute = GO1C_LIVE_ROUTE_ENABLED
    && !!referenceRouteRef.current
    && referenceRouteProviderRef.current === 'google'   // only meaningful against a real road route
    && isValidCoord(gps.latitude, gps.longitude)
    && distanceToPolylineMeters(gps.latitude!, gps.longitude!, referenceRouteRef.current) > ROUTE_DEVIATION_METERS;

  const hasDeviated = GO1C_LIVE_ROUTE_ENABLED && !hasArrived && (offRoute || movingAway);

  useEffect(() => {
    if (!routeInfo) return;
    if (!hasDeviated) {
      referenceRouteRef.current = routeInfo.polyline;
      referenceRouteProviderRef.current = routeInfo.provider;
    }
    // else: leave the existing reference route in place — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeInfo]);

  const now = Date.now();
  const arrivedDismissed = !!arrivedDismissedAt && now - arrivedDismissedAt < DISMISS_COOLDOWN_MS;
  const deviatedDismissed = !!deviatedDismissedAt && now - deviatedDismissedAt < DISMISS_COOLDOWN_MS;

  const journeyPhase: 'normal' | 'arrived' | 'deviated' =
    hasArrived && !arrivedDismissed ? 'arrived'
    : hasDeviated && !deviatedDismissed ? 'deviated'
    : 'normal';

  // Reset dismissals once their underlying condition clears, so a genuinely
  // new arrival/deviation later in the same journey isn't silently suppressed
  // by an old dismissal that never gets cleared otherwise.
  useEffect(() => { if (!hasArrived) setArrivedDismissedAt(null); }, [hasArrived]);
  useEffect(() => { if (!hasDeviated) setDeviatedDismissedAt(null); }, [hasDeviated]);

  // Row 25: the deviation → trusted-circle auto-escalation that lived here
  // (15-minute episode timer + POST /journey/status/{token}/route-deviation)
  // was removed by owner decision, 21 Nov 2026. hasDeviated now drives the
  // in-app prompt only.

  // F2b / F2c: battery-aware upload hook + stable refs for the AppState handler
  const { lastGaspUpload } = useLocationUpload(authToken, GO1B_GPS_ENABLED ? journeyToken : null);
  const lastGaspUploadRef  = useRef(lastGaspUpload);
  useEffect(() => { lastGaspUploadRef.current = lastGaspUpload; }, [lastGaspUpload]);
  const sessionRef  = useRef<HeadOutSession | null>(null);
  const expiredRef  = useRef(false);
  const userRef     = useRef<unknown>(user);
  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { expiredRef.current = expired; }, [expired]);
  useEffect(() => { userRef.current    = user; },    [user]);
  const lastGaspFiredRef = useRef(false);

  // F2c: fire a last-gasp location upload when the app moves to background/inactive.
  // Registered once; reads dynamic values via refs to avoid stale closures.
  // - Only fires when a session is active and not yet expired.
  // - Guard (lastGaspFiredRef) prevents duplicate uploads per backgrounding event.
  // - Reset when the app returns to the foreground.
  // - When GO1B_GPS_ENABLED is OFF, journeyToken is null so lastGaspUpload is a no-op.
  // - A09: skipped unless the cached fix is a real, recent device fix
  //   (see src/safety/lastGaspGuard.ts).
  useEffect(() => {
    let prevState = AppState.currentState;
    const sub = AppState.addEventListener('change', async (nextState) => {
      const wasActive = prevState === 'active';
      prevState = nextState;
      if (nextState === 'active') {
        // Returned to foreground — reset guard for next backgrounding
        lastGaspFiredRef.current = false;
        return;
      }
      // Only fire once, on an active→background/inactive transition, during a live session
      if (
        !wasActive ||
        lastGaspFiredRef.current ||
        !sessionRef.current ||
        sessionRef.current.pendingSafe ||   // A35: she has said she is safe
        expiredRef.current
      ) return;
      lastGaspFiredRef.current = true;
      try {
        const uid: string = ((userRef.current as any)?.id) ?? 'anon';
        const cached = await getLastLocation(uid);
        // A09: getLastLocation() falls back to a hardcoded demo coordinate when
        // the cache is empty. Never upload that, or a stale fix, to the
        // trusted circle. Sending nothing is safer than sending a false place.
        if (!isUploadableLastGaspFix(cached)) return;
        await lastGaspUploadRef.current(
          cached.lat,
          cached.lng,
          cached.accuracyM,
          cached.plusCode || 'Unknown area',
          cached.capturedAt,   // A06: the fix's own capture time, not "now"
        );
      } catch { /* non-fatal */ }
    });
    return () => sub.remove();
  }, []); // mount-only; dynamic values accessed via refs

  const prepareAlertSMS = useCallback(async () => {
    const notifyContacts = circle.filter(ct => ct.notify !== false && !!ct.phone?.trim());
    let body = `I was heading to ${session?.destination ?? 'a location'} and my check-in timer has expired. Please check on me.`;

    // F3: append Plus Code only for GPS or server-sourced location.
    // Demo fallback is intentionally omitted — a fabricated coordinate in an
    // emergency SMS could misdirect first responders.
    try {
      const uid: string = (user as any)?.id ?? 'anon';
      const cached = await getLastLocation(uid);
      if (cached.source !== 'demo' && cached.plusCode) {
        const { age } = formatLocationFix(
          {
            latitude:   cached.lat,
            longitude:  cached.lng,
            accuracyM:  cached.accuracyM,
            capturedAt: cached.capturedAt,
          },
          new Date(),
        );
        body += `\nPlus Code: ${cached.plusCode} · ${age}`;
      }
    } catch {}

    if (ALERT_SIMULATION_MODE) {
      // Pilot simulation: never open a real sms: intent — show an in-app
      // preview only, so no real alert can leave this device during the
      // pilot. Production behaviour (below) is preserved when this flag
      // is explicitly turned off.
      setSimPreview({ body, recipients: notifyContacts.map(ct => ct.name) });
      return;
    }
    if (notifyContacts.length > 0) {
      const phones = notifyContacts.map(ct => ct.phone).join(',');
      openExternal(`sms:${phones}?body=${encodeURIComponent(body)}`).catch(() => {});
    } else {
      openExternal(`sms:&body=${encodeURIComponent(body)}`).catch(() => {});
    }
  }, [circle, session, user]);

  // Loading: show a spinner instead of a blank white screen while AsyncStorage
  // is read. This takes < 300 ms on most devices but is visually noticeable
  // without a placeholder.
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface }}>
        <ActivityIndicator size="large" color={c.navy} />
      </View>
    );
  }
  // Fix 6: "I'm safe" just succeeded — confirm it calmly instead of
  // teleporting the user back into wizard step 1 with no acknowledgement.
  if (!session && safeConfirmed) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface, padding: 24, gap: 10 }} testID="headout-marked-safe">
        <Ionicons name="checkmark-circle" size={56} color={c.verifiedGreen} />
        <Text style={styles.activeTitle}>{"You're marked safe"}</Text>
        <Text style={[styles.note, { textAlign: 'center' }]}>
          Your journey has ended. If your Trusted Circle was following it, they can no longer see your location.
        </Text>
        <Pressable
          testID="headout-safe-done"
          style={(s) => [styles.button, styles.safeButton, { alignSelf: 'stretch', marginTop: 8 }, focusRingStyle(s)]}
          onPress={() => { setSafeConfirmed(false); router.replace('/women-shield'); }}
          accessibilityRole="button"
          accessibilityLabel="Done"
        >
          <Text style={styles.buttonText}>Done</Text>
        </Pressable>
        <Pressable
          testID="headout-safe-new-journey"
          style={(s) => [focusRingStyle(s)]}
          onPress={() => { setSafeConfirmed(false); router.replace('/women/head-out/destination'); }}
          accessibilityRole="button"
          accessibilityLabel="Plan another journey"
        >
          <Text style={[styles.linkTxt, styles.linkTxtUnderline]}>Plan another journey</Text>
        </Pressable>
      </View>
    );
  }
  // No session yet — the redirect effect above is about to send the user into
  // the wizard. Return null so there is nothing to flash before the transition.
  if (!session) return null;

  // Fix 5/7 (21 Nov): several actions only make sense when somebody is in the
  // journey's circle; with nobody there, show a way to add someone instead.
  const hasCircleRecipients = (session.recipientLinkIds?.length ?? 0) > 0;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      keyboardShouldPersistTaps="handled"
      testID="head-out-screen"
    >
      <ScreenHeader
        title="Head out safely"
        subtitle={authToken ? 'Your trusted circle is told only as per your settings' : 'Set a check-in timer — nothing is sent automatically'}
      />

      {/* ── Demo controller banner — QA only, never shown in production ──── */}
      {HEADOUT_DEMO_ENABLED && (
        <View style={styles.demoBanner} testID="headout-demo-banner">
          <View style={styles.demoBannerHeader}>
            <Ionicons name="flask-outline" size={14} color="#92400e" />
            <Text style={styles.demoBannerTitle}>Demo mode · simulated location, nothing is sent</Text>
          </View>
          <View style={styles.demoBtnRow}>
            <Pressable
              testID="headout-demo-start-route"
              style={styles.demoBtn}
              onPress={handleDemoStartRoute}
              accessibilityRole="button"
              accessibilityLabel="Demo: start simulated route"
            >
              <Text style={styles.demoBtnTxt}>Start route</Text>
            </Pressable>
            <Pressable
              testID="headout-demo-enter-zone"
              style={styles.demoBtn}
              onPress={handleDemoEnterZone}
              accessibilityRole="button"
              accessibilityLabel="Demo: enter arrival zone"
            >
              <Text style={styles.demoBtnTxt}>Enter arrival zone</Text>
            </Pressable>
            <Pressable
              testID="headout-demo-off-route"
              style={styles.demoBtn}
              onPress={handleDemoGoOffRoute}
              accessibilityRole="button"
              accessibilityLabel="Demo: go off route"
            >
              <Text style={styles.demoBtnTxt}>Go off route</Text>
            </Pressable>
            <Pressable
              testID="headout-demo-miss-checkin"
              style={styles.demoBtn}
              onPress={handleDemoMissCheckIn}
              accessibilityRole="button"
              accessibilityLabel="Demo: miss check-in"
            >
              <Text style={styles.demoBtnTxt}>Miss check-in</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* A30: tell her plainly whether the server-held alarm is armed. */}
      {!expired && journeyAlarm === 'connecting' && (
        <View style={styles.alarmPendingBanner} testID="headout-alarm-connecting" accessibilityLiveRegion="polite">
          <Ionicons name="sync-outline" size={18} color="#92400e" />
          <View style={{ flex: 1 }}>
            <Text style={styles.alarmBannerTitle}>{ALARM_COPY.connecting.title}</Text>
            <Text style={styles.alarmBannerBody}>{ALARM_COPY.connecting.body}</Text>
          </View>
        </View>
      )}
      {!expired && journeyAlarm === 'not_active' && (
        <View style={styles.alarmOffBanner} testID="headout-alarm-not-active" accessibilityRole="alert">
          <Ionicons name="warning-outline" size={20} color={c.emergencyRed} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.alarmBannerTitle, { color: c.emergencyRed }]}>{ALARM_COPY.not_active.title}</Text>
            <Text style={styles.alarmBannerBody}>{ALARM_COPY.not_active.body}</Text>
            <Pressable
              testID="headout-alarm-retry"
              disabled={creatingJourney}
              onPress={() => { void createJourney(); }}
              style={(st) => [styles.alarmRetryBtn, focusRingStyle(st)]}
              accessibilityRole="button"
              accessibilityLabel="Try again to reach DHARA's server"
            >
              <Text style={styles.alarmRetryTxt}>
                {creatingJourney ? ALARM_COPY.not_active.retrying : ALARM_COPY.not_active.retry}
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* A35: a request she made that the server has not confirmed yet. */}
      {pendingSafe && (
        <View style={styles.alarmOffBanner} testID="headout-safe-pending" accessibilityRole="alert">
          <Ionicons name="warning-outline" size={20} color={c.emergencyRed} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.alarmBannerTitle, { color: c.emergencyRed }]}>{CLOSE_COPY.safe_pending.title}</Text>
            <Text style={styles.alarmBannerBody}>{CLOSE_COPY.safe_pending.body}</Text>
            <Pressable
              testID="headout-safe-retry"
              disabled={closingJourney}
              onPress={() => { void endSession(); }}
              style={(st) => [styles.alarmRetryBtn, focusRingStyle(st)]}
              accessibilityRole="button"
              accessibilityLabel="Try again to tell DHARA's server you are safe"
            >
              <Text style={styles.alarmRetryTxt}>{closingJourney ? CLOSE_COPY.retrying : CLOSE_COPY.retry}</Text>
            </Pressable>
          </View>
        </View>
      )}
      {pendingRevoke && !pendingSafe && (
        <View style={styles.alarmOffBanner} testID="headout-revoke-pending" accessibilityRole="alert">
          <Ionicons name="warning-outline" size={20} color={c.emergencyRed} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.alarmBannerTitle, { color: c.emergencyRed }]}>{CLOSE_COPY.revoke_pending.title}</Text>
            <Text style={styles.alarmBannerBody}>{CLOSE_COPY.revoke_pending.body}</Text>
            <Pressable
              testID="headout-revoke-retry"
              disabled={revokingShare}
              onPress={() => { void stopSharing(); }}
              style={(st) => [styles.alarmRetryBtn, focusRingStyle(st)]}
              accessibilityRole="button"
              accessibilityLabel="Try again to stop sharing"
            >
              <Text style={styles.alarmRetryTxt}>{revokingShare ? CLOSE_COPY.retrying : CLOSE_COPY.retry}</Text>
            </Pressable>
          </View>
        </View>
      )}

      {expired ? (
            <View style={[styles.activeCard, styles.expiredCard]} testID="headout-expired-card">
              <Ionicons name="cloud-offline-outline" size={32} color={c.emergencyRed} />
              <Text style={styles.expiredTitle}>Check-in not received</Text>
              <Text style={styles.note}>{"We haven't received your check-in."}</Text>

              {GO1B_GPS_ENABLED && (
                <View style={styles.statusCard} testID="headout-phone-status">
                  <Ionicons
                    name={gps.lastFixAt && Date.now() - gps.lastFixAt < OFFLINE_THRESHOLD_MS ? 'wifi-outline' : 'cloud-offline-outline'}
                    size={20} color={gps.lastFixAt && Date.now() - gps.lastFixAt < OFFLINE_THRESHOLD_MS ? c.verifiedGreen : '#B45309'}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.statusCardLabel}>Phone status</Text>
                    <Text style={styles.statusCardValue}>
                      {gps.lastFixAt == null
                        ? 'No location received yet'
                        : Date.now() - gps.lastFixAt < OFFLINE_THRESHOLD_MS
                          ? 'Looks online'
                          : `Looks offline (last location ${Math.round((Date.now() - gps.lastFixAt) / 60000)} min ago)`}
                    </Text>
                  </View>
                </View>
              )}

              {/* A30: the server never accepted this journey, so no automatic
                  alert exists. Say so, instead of showing nothing. */}
              {serverJourneyNeeded && !journeyToken && (
                <View style={[styles.statusCard, styles.alarmOffCard]} testID="headout-alarm-not-active-expired" accessibilityRole="alert">
                  <Ionicons name="warning-outline" size={20} color={c.emergencyRed} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.statusCardValue, { color: c.emergencyRed }]}>{ALARM_COPY.expired_not_active.title}</Text>
                    <Text style={styles.alarmBannerBody}>{ALARM_COPY.expired_not_active.body}</Text>
                  </View>
                </View>
              )}

              {TRUSTED_CIRCLE_RECIPIENT && GO1B_GPS_ENABLED && journeyToken && selectedRecipients.length > 0 && (
                <View style={styles.statusCard} testID="headout-server-alert-status">
                  <Ionicons name="time-outline" size={20} color={c.navy} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.statusCardLabel}>Server alert status</Text>
                    <Text style={styles.statusCardValue} testID="headout-server-alert-text">
                      {alertStatusText({
                        state: alertReport, autoNotifyOff, pendingSafe,
                        graceCountdown: formatCountdown(graceSecsLeft ?? 0),
                      })}
                    </Text>
                  </View>
                </View>
              )}

              {notifyRecipients.length > 0 && (
                <View style={styles.notifyListBlock} testID="headout-notify-list">
                  <Text style={styles.togglesHeader}>Your Trusted Circle</Text>
                  {notifyRecipients.map(link => {
                    const uri = !failedNotifyPhotos[link.id] ? notifyPhotoUri(link.invitee_user_id) : null;
                    return (
                      <View key={link.id} style={styles.notifyRow}>
                        {uri ? (
                          <Image source={{ uri }} style={styles.avatar} onError={() => setFailedNotifyPhotos(f => ({ ...f, [link.id]: true }))} />
                        ) : (
                          <View style={styles.avatarFallback}><Ionicons name="person" size={16} color={c.muted} /></View>
                        )}
                        <Text style={styles.notifyName}>{link.contact_name}</Text>
                        <View style={{ flex: 1 }} />
                        <Text style={styles.notifyEta}>
                          {recipientAlertLabel({
                            state: alertReport, linkId: link.id, autoNotifyOff, pendingSafe,
                            graceCountdown: formatCountdown(graceSecsLeft ?? 0),
                          })}
                        </Text>
                        <Ionicons name="time-outline" size={14} color={c.muted} />
                      </View>
                    );
                  })}
                </View>
              )}

              <Pressable
                testID="headout-check-in-now"
                disabled={extending}
                style={(s) => [styles.button, { marginTop: 14 }, focusRingStyle(s)]}
                onPress={handleCheckInNow}
                accessibilityRole="button"
                accessibilityLabel="Check in now"
              >
                <Ionicons name="checkmark-done-outline" size={18} color="#fff" />
                <Text style={styles.buttonText}>{extending ? 'Checking in…' : 'Check in now'}</Text>
              </Pressable>
              {!!extendError && <Text style={styles.inlineError}>{extendError}</Text>}

              {TRUSTED_CIRCLE_RECIPIENT && GO1B_GPS_ENABLED && journeyToken && selectedRecipients.length > 0 && alertReport.report === 'idle' && graceSecsLeft !== 0 && !pendingSafe && (
                <Pressable testID="headout-raise-alert-now" onPress={raiseAlertNow} style={(s) => [focusRingStyle(s)]} accessibilityRole="button" accessibilityLabel="Raise alert now">
                  <Text style={[styles.linkTxt, styles.linkTxtUnderline]}>Raise alert now</Text>
                </Pressable>
              )}

              {/* Distinct, older, local-device-only system — NOT the same
                  "Trusted Circle" shown above. Kept visually secondary
                  (outline, not solid) and clearly separated so it doesn't
                  read as a duplicate of the automated flow above it. */}
              <View style={styles.smsDivider}>
                <View style={styles.smsDividerLine} />
                <Text style={styles.smsDividerTxt}>or text someone directly</Text>
                <View style={styles.smsDividerLine} />
              </View>
              <Pressable
                testID="headout-alert-circle"
                style={(s) => [styles.button, styles.outlineAlertBtn, focusRingStyle(s)]}
                onPress={prepareAlertSMS}
                accessibilityRole="button"
                accessibilityLabel="Text my emergency contacts"
              >
                <Ionicons name="chatbubble-outline" size={18} color={c.emergencyRed} />
                <Text style={[styles.buttonText, { color: c.emergencyRed }]}>Text my emergency contacts</Text>
              </Pressable>
            </View>
      ) : journeyPhase === 'arrived' ? (
            <View style={styles.activeCard} testID="headout-arrived-card">
              {hasDestCoord && (
                <ActiveJourneyMap
                  testID="headout-arrived-map"
                  currentLat={gps.latitude} currentLng={gps.longitude}
                  destLat={session.latitude!} destLng={session.longitude!}
                  radiusMeters={arrivalRadius} routePolyline={routeInfo?.polyline ?? null}
                />
              )}
              <Ionicons name="checkmark-circle-outline" size={28} color={c.verifiedGreen} />
              <Text style={styles.activeTitle}>{"You're at your destination"}</Text>
              <Text style={styles.note}>
                {`We've detected you're within the arrival zone (${Math.round(arrivalRadius)} m) of "${session.destination}". This doesn't automatically mean you're safe — confirm below.`}
              </Text>
              {/* Arrived action row — two equal buttons side by side */}
              <View style={styles.arrivedBtnRow}>
                <Pressable
                  testID="headout-i-arrived"
                  style={(s) => [styles.button, styles.safeButton, styles.arrivedHalf, focusRingStyle(s)]}
                  onPress={endSession}
                  accessibilityRole="button"
                  accessibilityLabel="Confirm I arrived"
                >
                  <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                  <Text style={styles.buttonText}>I arrived</Text>
                </Pressable>
                <Pressable
                  testID="headout-not-here-yet"
                  style={(s) => [styles.button, styles.outlineNavyBtn, styles.arrivedHalf, focusRingStyle(s)]}
                  onPress={handleDismissArrived}
                  accessibilityRole="button"
                  accessibilityLabel="Not there yet"
                >
                  <Text style={[styles.buttonText, { color: c.navy }]}>Not there yet</Text>
                </Pressable>
              </View>
              <Pressable
                testID="headout-extend-time"
                disabled={extending}
                onPress={() => handleExtendTime(15)}
                style={(s) => [focusRingStyle(s)]}
                accessibilityRole="button"
                accessibilityLabel="Extend check-in time by 15 minutes"
              >
                <Text style={[styles.linkTxt, styles.linkTxtUnderline]}>{extending ? 'Extending…' : 'Extend time (+15 min)'}</Text>
              </Pressable>
              {!!extendError && <Text style={styles.inlineError}>{extendError}</Text>}
            </View>
      ) : journeyPhase === 'deviated' ? (
            <View style={[styles.activeCard, styles.deviatedCard]} testID="headout-deviated-card">
              {hasDestCoord && (
                <ActiveJourneyMap
                  testID="headout-deviated-map"
                  currentLat={gps.latitude} currentLng={gps.longitude}
                  destLat={session.latitude!} destLng={session.longitude!}
                  radiusMeters={arrivalRadius} routePolyline={routeInfo?.polyline ?? null}
                />
              )}
              <Ionicons name="warning-outline" size={28} color="#B45309" />
              <Text style={styles.activeTitle}>Your journey changed</Text>
              <Text style={styles.note}>You are outside the expected route or moving away from your destination.</Text>
              <Text style={[styles.note, styles.areYouOkayTxt]}>Are you okay?</Text>
              <Pressable
                testID="headout-im-okay"
                style={(s) => [styles.button, styles.safeButton, focusRingStyle(s)]}
                onPress={handleOkayDeviated}
                accessibilityRole="button"
                accessibilityLabel="I'm okay"
              >
                <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                <Text style={styles.buttonText}>{"I'm okay"}</Text>
              </Pressable>
              <Pressable
                testID="headout-change-destination"
                style={(s) => [styles.button, styles.guardianBtn, focusRingStyle(s)]}
                onPress={handleOpenChangeDestination}
                accessibilityRole="button"
                accessibilityLabel="Change destination"
              >
                <Text style={[styles.buttonText, { color: c.navy }]}>Change destination</Text>
              </Pressable>
              {TRUSTED_CIRCLE_RECIPIENT && GO1B_GPS_ENABLED && journeyToken && selectedRecipients.length > 0 && (
                <Pressable
                  testID="headout-deviated-need-help"
                  style={(s) => [styles.button, styles.alertButton, focusRingStyle(s)]}
                  onPress={requestHelp}
                  accessibilityRole="button"
                  accessibilityLabel="Request help from your Trusted Circle"
                >
                  <Ionicons name="warning-outline" size={18} color="#fff" />
                  <Text style={styles.buttonText}>Need help</Text>
                </Pressable>
              )}
              <Text style={styles.disclosureNote}>
                {session.autoNotifyOnNoResponse === false
                  ? 'Your Trusted Circle is not told about this automatically — you chose "Do nothing" for missed responses in Step 3. They\'re only notified if you tap "Need help" above.'
                  : 'A route change alone never alerts your Trusted Circle. They are only told if you miss your check-in or tap "Need help".'}
              </Text>
            </View>
      ) : (
            <View style={styles.activeCard} testID="headout-active-card">
              <View style={styles.activeHeader}>
                <Ionicons name="navigate-circle-outline" size={26} color={c.navy} />
                <Text style={styles.activeTitle}>Journey active</Text>
              </View>
              <Text style={styles.destTxt}>{session.destination}</Text>
              {journeyAlarm === 'active' && (
                <View style={styles.alarmOnRow} testID="headout-alarm-active">
                  <Ionicons name="shield-checkmark-outline" size={14} color={c.verifiedGreen} />
                  <Text style={styles.alarmOnTxt}>{ALARM_COPY.active.body}</Text>
                </View>
              )}
              {GO1C_LIVE_ROUTE_ENABLED && gps.tracking && !(fixIsFresh && fixIsAccurate) && (
                <Text style={styles.note} testID="headout-location-uncertain">
                  {"Location uncertain — DHARA can't confirm your arrival from this reading. Tap \"I'm safe\" or \"Need help\" yourself."}
                </Text>
              )}
              {!!session.radiusMeters && (
                <Text style={styles.radiusTxt}>
                  {GO1B_GPS_ENABLED
                    // GPS row below already states the real tracking status — don't
                    // also assert "not active" here, that would contradict it.
                    ? `Planned area: ${session.radiusMeters} m`
                    : `Planned area: ${session.radiusMeters} m · Monitoring not active`}
                </Text>
              )}
              {GO1C_LIVE_ROUTE_ENABLED && hasDestCoord && (
                <ActiveJourneyMap
                  testID="headout-active-map"
                  currentLat={gps.latitude} currentLng={gps.longitude}
                  destLat={session.latitude!} destLng={session.longitude!}
                  radiusMeters={arrivalRadius} routePolyline={routeInfo?.polyline ?? null}
                />
              )}
              {!!routeInfo && (
                <Text style={styles.etaTxt} testID="headout-eta">
                  {routeInfo.provider === 'approximate' ? '~' : ''}Arriving in {Math.max(1, Math.round(routeInfo.durationSeconds / 60))} min
                  {' · ETA '}{new Date(Date.now() + routeInfo.durationSeconds * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  {routeInfo.provider === 'approximate' ? ' (estimated)' : ''}
                </Text>
              )}
              <Text style={styles.timerLbl}>Next check-in in</Text>
              <Text testID="headout-timer" style={styles.timerDisplay}>{formatCountdown(secsLeft)}</Text>
              <Text style={styles.note}>{'Tap "I\'m safe" when you reach. DHARA will help you alert your circle if this timer runs out.'}</Text>
              {GUARDIAN_SHARE_ENABLED && hasCircleRecipients && (
                <Pressable
                  testID="headout-notify-guardian"
                  style={(s) => [styles.button, styles.guardianBtn, focusRingStyle(s)]}
                  onPress={() => router.push({
                    pathname: '/women/guardian-share',
                    params: {
                      destination: session.destination,
                      startTime: String(session.startTime),
                      durationMins: String(session.durationMins),
                      journeyToken: journeyToken ?? '',
                      // Truthfulness: only claim live tracking when GPS is
                      // actually running (flag on + user consented + session).
                      gpsLive: GO1B_GPS_ENABLED && locationConsentGiven && gps.granted ? '1' : '0',
                    },
                  })}
                  accessibilityRole="button"
                  accessibilityLabel="Notify your guardian about this journey"
                >
                  <Ionicons name="people-outline" size={18} color={c.navy} />
                  <Text style={[styles.buttonText, { color: c.navy }]}>Notify your guardian</Text>
                </Pressable>
              )}
              {/* GO1B: GPS permission-contract UI (handle_permissions_contract) */}
              {GO1B_GPS_ENABLED && !!session && !expired && (
                <>
                  {/* Step 1: pre-OS rationale — shown before any permission is requested */}
                  {!locationConsentGiven && !gps.denied && (
                    <View style={styles.gpsRationaleCard} testID="gps-rationale-card">
                      <Ionicons name="location-outline" size={18} color="#1D4ED8" />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.gpsRationaleTitle}>Share your location with your guardian?</Text>
                        <Text style={styles.gpsRationaleBody}>
                          DHARA will share your approximate area with your Trusted Circle while this journey is active. Location stops when you mark yourself safe.
                        </Text>
                        <Pressable
                          testID="gps-allow-btn"
                          style={(s) => [styles.gpsAllowBtn, focusRingStyle(s)]}
                          onPress={() => setLocationConsentGiven(true)}
                          accessibilityRole="button"
                          accessibilityLabel="Allow location sharing for this journey"
                        >
                          <Text style={styles.gpsAllowBtnText}>Allow for this journey</Text>
                        </Pressable>
                      </View>
                    </View>
                  )}

                  {/* Step 2: tracking indicator — shown once consent given.
                      gps.error is set once and only for the known, permanent
                      "web doesn't support this" case (see useJourneyGPS's web
                      branch) — distinct from "still starting up", which is
                      transient and resolves within a second or two on native. */}
                  {locationConsentGiven && !showPermDeniedSettings && (
                    <View style={styles.gpsRow} accessibilityLabel={gps.tracking ? `GPS tracking active, last area: ${gps.area}` : (gps.error ?? 'GPS starting')}>
                      <Ionicons
                        name={gps.tracking ? 'location' : gps.error ? 'information-circle-outline' : 'location-outline'}
                        size={14}
                        color={gps.tracking ? '#16a34a' : c.muted}
                      />
                      <Text style={[styles.gpsLabel, gps.tracking && { color: '#16a34a' }]}>
                        {gps.denied
                          ? 'Location access denied — guardian page will not show your area'
                          : gps.error
                            ? 'Live location isn’t available in this web preview — use the DHARA app on your phone for live tracking'
                            : gps.tracking
                              ? `Tracking active${gps.area ? ` · ${gps.area}` : ''}`
                              : 'Starting location tracking…'}
                      </Text>
                    </View>
                  )}

                  {/* Step 3: permanent denial — canAskAgain=false — show Settings path */}
                  {(showPermDeniedSettings || (gps.denied && !gps.canAskAgain)) && (
                    <View style={styles.gpsDeniedCard} testID="gps-denied-settings-card">
                      <Ionicons name="location-outline" size={18} color="#B91C1C" />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.gpsDeniedTitle}>Location permission blocked</Text>
                        <Text style={styles.gpsDeniedBody}>
                          Your device has blocked location access for DHARA. Your guardian&apos;s page will not show your area during this journey. To enable it, open Settings and allow location access.
                        </Text>
                        <Pressable
                          testID="gps-open-settings-btn"
                          style={(s) => [styles.gpsSettingsBtn, focusRingStyle(s)]}
                          onPress={() => Linking.openSettings()}
                          accessibilityRole="button"
                          accessibilityLabel="Open device Settings to allow location access"
                        >
                          <Text style={styles.gpsSettingsBtnText}>Open Settings</Text>
                        </Pressable>
                      </View>
                    </View>
                  )}
                </>
              )}
              {/* Fix 7: Extend is available on the normal active card too,
                  not only on the arrived card. */}
              <Pressable
                testID="headout-active-extend-time"
                disabled={extending}
                onPress={() => handleExtendTime(15)}
                style={(s) => [focusRingStyle(s)]}
                accessibilityRole="button"
                accessibilityLabel="Extend check-in time by 15 minutes"
              >
                <Text style={[styles.linkTxt, styles.linkTxtUnderline]}>{extending ? 'Extending…' : 'Extend time (+15 min)'}</Text>
              </Pressable>
              {!!extendError && <Text style={styles.inlineError}>{extendError}</Text>}
              {/* Fix 5: with nobody in the circle, prompt to add a person
                  instead of silently hiding every circle action. */}
              {TRUSTED_CIRCLE_RECIPIENT && GO1B_GPS_ENABLED && journeyToken && !hasCircleRecipients && (
                <View style={styles.gpsRationaleCard} testID="headout-empty-circle-prompt">
                  <Ionicons name="people-outline" size={18} color={c.navy} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.gpsRationaleTitle}>No one is in your Trusted Circle</Text>
                    <Text style={styles.gpsRationaleBody}>
                      Nobody will be told if you need help on this journey. Add a person so someone has your back.
                    </Text>
                    <Pressable
                      testID="headout-add-circle-person"
                      style={(s) => [styles.gpsAllowBtn, focusRingStyle(s)]}
                      onPress={() => router.push('/women/trusted-circle')}
                      accessibilityRole="button"
                      accessibilityLabel="Add a person to your Trusted Circle"
                    >
                      <Text style={styles.gpsAllowBtnText}>Add a person</Text>
                    </Pressable>
                  </View>
                </View>
              )}
              {/* L2 (21 Nov): a clear Need help action is ALWAYS on the active
                  card. With people in the circle it uses the existing
                  help_requested flow; otherwise it opens the existing
                  emergency screen (the same place the global Help pill goes).
                  No new send path. */}
              {TRUSTED_CIRCLE_RECIPIENT && GO1B_GPS_ENABLED && journeyToken && selectedRecipients.length > 0 ? (
                <>
                  <Pressable
                    testID="headout-need-help"
                    style={(s) => [styles.button, styles.alertButton, { marginTop: 10 }, focusRingStyle(s)]}
                    onPress={requestHelp}
                    accessibilityRole="button"
                    accessibilityLabel="Request help from your Trusted Circle"
                  >
                    <Ionicons name="warning-outline" size={18} color="#fff" />
                    <Text style={styles.buttonText}>Need help</Text>
                  </Pressable>
                  <Text style={styles.disclosureNote}>
                    {helpRequested
                      ? 'Your Trusted Circle has been asked for help with your latest shared location.'
                      : 'Sends a help alert to the people you picked for this journey.'}
                  </Text>
                </>
              ) : (
                <>
                  <Pressable
                    testID="headout-need-help-emergency"
                    style={(s) => [styles.button, styles.alertButton, { marginTop: 10 }, focusRingStyle(s)]}
                    onPress={() => router.push('/emergency')}
                    accessibilityRole="button"
                    accessibilityLabel="Need help — open emergency numbers"
                  >
                    <Ionicons name="warning-outline" size={18} color="#fff" />
                    <Text style={styles.buttonText}>Need help</Text>
                  </Pressable>
                  <Text style={styles.disclosureNote}>
                    Opens emergency help with numbers like 112 and 181. No one in your Trusted Circle is alerted — nobody is selected for this journey.
                  </Text>
                </>
              )}
              {journeyToken && hasCircleRecipients && (
                sharingRevoked ? (
                  <Text style={styles.disclosureNote} testID="headout-sharing-revoked-note">
                    {"Sharing stopped. Your trusted circle can no longer see this journey's location or status."}
                  </Text>
                ) : (
                  <Pressable
                    testID="headout-stop-sharing"
                    disabled={revokingShare}
                    style={(s) => [styles.button, styles.stopSharingBtn, { marginTop: 10 }, focusRingStyle(s)]}
                    onPress={stopSharing}
                    accessibilityRole="button"
                    accessibilityLabel="Stop sharing this journey with your trusted circle"
                  >
                    <Ionicons name="stop-circle-outline" size={18} color={c.muted} />
                    <Text style={[styles.buttonText, { color: c.muted }]}>{revokingShare ? 'Stopping…' : 'Stop sharing'}</Text>
                  </Pressable>
                )
              )}
            </View>
      )}

          <Pressable
            testID="headout-end"
            style={(s) => [styles.button, styles.safeButton, focusRingStyle(s)]}
            onPress={endSession}
            accessibilityRole="button"
            accessibilityLabel="I'm safe"
          >
            <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
            <Text style={styles.buttonText}>{"I'm safe"}</Text>
          </Pressable>

      <Text style={styles.disclosureNote}>
        {journeyToken && (session.recipientLinkIds?.length ?? 0) > 0
          ? (session.autoNotifyOnNoResponse === false
              ? 'Your selected trusted circle was told this journey started. They are not alerted automatically if you miss a check-in.'
              : 'Your selected trusted circle was told this journey started. If you miss your check-in, they are alerted 5 minutes after the timer ends.')
          : journeyToken
              ? 'No alerts have been sent. Your journey timer runs on DHARA\u2019s server, but no Trusted Circle was selected, so nobody is told automatically.'
              : 'Nothing has been sent and DHARA\u2019s server could not record this journey \u2014 your session is saved on this device only, and no alerts can be sent.'}
      </Text>

      {/* Pilot simulation preview — replaces the real sms: intent while
          ALERT_SIMULATION_MODE is on. Clearly labelled, nothing is sent. */}
      <Modal
        visible={!!simPreview}
        transparent
        animationType="fade"
        onRequestClose={() => setSimPreview(null)}
      >
        <View style={styles.simOverlay}>
          <View style={styles.simBox} testID="headout-sim-preview-modal">
            <View style={styles.simBadge}>
              <Ionicons name="flask-outline" size={14} color={c.navy} />
              <Text style={styles.simBadgeTxt}>Simulated — nothing sent</Text>
            </View>
            <Text style={styles.simTitle}>Pilot preview of your alert</Text>
            <Text style={styles.simHint}>
              This is a pilot simulation. No SMS, call, or notification has been sent to anyone.
            </Text>
            <Text style={styles.simLabel}>Would be sent to:</Text>
            <Text style={styles.simValue}>
              {simPreview && simPreview.recipients.length > 0 ? simPreview.recipients.join(', ') : 'No trusted circle contacts set up'}
            </Text>
            <Text style={styles.simLabel}>Message:</Text>
            <Text style={styles.simValue}>{simPreview?.body}</Text>
            <Pressable
              style={(s) => [styles.button, { marginTop: 8 }, focusRingStyle(s)]}
              onPress={() => setSimPreview(null)}
              accessibilityRole="button"
              accessibilityLabel="Close simulated alert preview"
              testID="headout-sim-preview-close"
            >
              <Text style={styles.buttonText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* GO1C: Change destination — a lightweight inline picker, not the full
          first-time-setup wizard (see handleOpenChangeDestination). */}
      <Modal
        visible={showChangeDest}
        transparent
        animationType="fade"
        onRequestClose={() => setShowChangeDest(false)}
      >
        <View style={styles.simOverlay}>
          <View style={styles.simBox} testID="headout-change-dest-modal">
            <Text style={styles.simTitle}>Change destination</Text>
            <TextInput
              testID="headout-change-dest-input"
              value={changeDestLabel}
              onChangeText={setChangeDestLabel}
              placeholder="Where are you heading now?"
              placeholderTextColor={c.muted}
              style={styles.changeDestInput}
            />
            <DestinationMapPicker
              testID="headout-change-dest-map"
              latitude={changeDestCoord?.lat ?? null}
              longitude={changeDestCoord?.lng ?? null}
              radiusMeters={arrivalRadius}
              onPositionChange={(lat, lng) => setChangeDestCoord({ lat, lng })}
              mapHeight={180}
            />
            {!!changeDestError && <Text style={styles.inlineError}>{changeDestError}</Text>}
            <Pressable
              testID="headout-change-dest-save"
              disabled={changingDest || !changeDestLabel.trim()}
              style={(s) => [styles.button, (changingDest || !changeDestLabel.trim()) && styles.buttonDisabled, { marginTop: 8 }, focusRingStyle(s)]}
              onPress={handleSaveChangeDestination}
              accessibilityRole="button"
              accessibilityLabel="Save new destination"
            >
              <Text style={styles.buttonText}>{changingDest ? 'Saving…' : 'Save new destination'}</Text>
            </Pressable>
            <Pressable
              testID="headout-change-dest-cancel"
              style={(s) => [{ marginTop: 10, alignItems: 'center' }, focusRingStyle(s)]}
              onPress={() => setShowChangeDest(false)}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={styles.linkTxt}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  content: { padding: 20, gap: 16 },
  note: { fontFamily: theme.fonts.body, fontSize: 14, color: c.muted, lineHeight: 21 },
  button: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: c.navy, borderRadius: 14, paddingVertical: 16,
  },
  buttonText: { fontFamily: theme.fonts.bodyBold, fontSize: 16, color: '#fff' },
  safeButton: { backgroundColor: c.verifiedGreen },
  alertButton: { backgroundColor: c.emergencyRed },
  guardianBtn: { backgroundColor: c.navySoft, borderWidth: 1.5, borderColor: c.navy },
  activeCard: {
    backgroundColor: c.surface, borderRadius: 18, borderWidth: 1,
    borderColor: c.lines, padding: 20, gap: 8, alignItems: 'center', marginBottom: 4,
  },
  expiredCard: { borderColor: c.emergencyRed, backgroundColor: '#FFF5F5' },
  activeHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  activeTitle: { fontFamily: theme.fonts.displayBold, fontSize: 20, color: c.navy },
  destTxt: {
    fontFamily: theme.fonts.bodyBold, fontSize: 17, color: c.ink,
    textAlign: 'center', paddingHorizontal: 8,
  },
  radiusTxt: {
    fontFamily: theme.fonts.body, fontSize: 12, color: c.muted,
    textAlign: 'center', fontStyle: 'italic',
  },
  timerLbl: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, marginTop: 8 },
  timerDisplay: {
    fontFamily: theme.fonts.displayBold, fontSize: 56, color: c.navy,
    letterSpacing: -2, lineHeight: 64,
  },
  expiredTitle: { fontFamily: theme.fonts.displayBold, fontSize: 22, color: c.emergencyRed },
  disclosureNote: {
    fontFamily: theme.fonts.body, fontSize: 12, color: c.muted,
    textAlign: 'center', marginTop: 8,
  },
  gpsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  gpsLabel: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, flex: 1, textAlign: 'center' },
  // handle_permissions_contract — pre-OS rationale card
  gpsRationaleCard: { flexDirection: 'row', gap: 10, backgroundColor: '#EFF6FF', borderRadius: 10, padding: 12, marginTop: 10, alignItems: 'flex-start' },
  gpsRationaleTitle: { fontFamily: theme.fonts.body, fontSize: 13, fontWeight: '600', color: '#1E3A8A', marginBottom: 3 },
  gpsRationaleBody: { fontFamily: theme.fonts.body, fontSize: 12, color: '#1D4ED8', lineHeight: 17 },
  gpsAllowBtn: { marginTop: 8, backgroundColor: '#1D4ED8', borderRadius: 8, minHeight: 44, justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 16, alignSelf: 'flex-start' },
  gpsAllowBtnText: { fontFamily: theme.fonts.body, fontSize: 12, color: '#fff', fontWeight: '600' },
  // handle_permissions_contract — permanent denial + Settings redirect
  gpsDeniedCard: { flexDirection: 'row', gap: 10, backgroundColor: '#FEF2F2', borderRadius: 10, padding: 12, marginTop: 10, alignItems: 'flex-start' },
  gpsDeniedTitle: { fontFamily: theme.fonts.body, fontSize: 13, fontWeight: '600', color: '#B91C1C', marginBottom: 3 },
  gpsDeniedBody: { fontFamily: theme.fonts.body, fontSize: 12, color: '#7F1D1D', lineHeight: 17 },
  gpsSettingsBtn: { marginTop: 8, backgroundColor: '#B91C1C', borderRadius: 8, paddingVertical: 7, paddingHorizontal: 14, alignSelf: 'flex-start' },
  gpsSettingsBtnText: { fontFamily: theme.fonts.body, fontSize: 12, color: '#fff', fontWeight: '600' },
  simOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  simBox: { backgroundColor: '#fff', borderRadius: 18, padding: 22, width: '100%', maxWidth: 400, gap: 6 },
  simBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    backgroundColor: c.navySoft, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 6,
  },
  simBadgeTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 12, color: c.navy },
  simTitle: { fontFamily: theme.fonts.displayBold, fontSize: 18, color: c.ink },
  simHint: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, lineHeight: 19, marginBottom: 6 },
  simLabel: { fontFamily: theme.fonts.bodyBold, fontSize: 12, color: c.muted, marginTop: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  simValue: { fontFamily: theme.fonts.body, fontSize: 14, color: c.ink, lineHeight: 20 },
  // GO1C: live route / arrival / deviation
  buttonDisabled: { opacity: 0.6 },
  stopSharingBtn: { backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.lines },
  // "Check-in not received" screen
  statusCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'stretch',
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines,
    borderRadius: 12, padding: 12, marginTop: 10,
  },
  statusCardLabel: { fontFamily: theme.fonts.bodySemiBold, fontSize: 12, color: c.muted },
  statusCardValue: { fontFamily: theme.fonts.bodyBold, fontSize: 13.5, color: c.ink, marginTop: 1 },
  togglesHeader: {
    fontFamily: theme.fonts.bodySemiBold, fontSize: 11, color: c.navy,
    textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2,
  },
  notifyListBlock: { alignSelf: 'stretch', marginTop: 14, gap: 6 },
  notifyRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines,
    borderRadius: 10, padding: 10,
  },
  notifyName: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.ink },
  notifyEta: { fontFamily: theme.fonts.body, fontSize: 11.5, color: c.muted },
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: c.navySoft },
  avatarFallback: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: c.navySoft,
    alignItems: 'center', justifyContent: 'center',
  },
  smsDivider: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'stretch', marginTop: 16, marginBottom: 2 },
  smsDividerLine: { flex: 1, height: 1, backgroundColor: c.lines },
  smsDividerTxt: { fontFamily: theme.fonts.body, fontSize: 11.5, color: c.muted },
  outlineAlertBtn: { backgroundColor: c.surface, borderWidth: 1.5, borderColor: c.emergencyRed },
  deviatedCard: { borderColor: '#B45309', backgroundColor: '#FFFBEB' },
  areYouOkayTxt: { fontFamily: theme.fonts.bodyBold, color: c.ink, fontSize: 16 },
  etaTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.navy, marginTop: 2 },
  linkTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 14, color: c.navy, paddingVertical: 6 },
  linkTxtUnderline: { textDecorationLine: 'underline' },
  inlineError: { fontFamily: theme.fonts.body, fontSize: 12, color: c.emergencyRed, textAlign: 'center' },
  changeDestInput: {
    backgroundColor: c.background, borderWidth: 1, borderColor: c.lines, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontFamily: theme.fonts.body, fontSize: 15,
    color: c.ink, marginTop: 10, marginBottom: 10,
  },
  // ── Arrived card — side-by-side action buttons ──────────────────────────────
  arrivedBtnRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  arrivedHalf: { flex: 1 },
  outlineNavyBtn: { backgroundColor: c.surface, borderWidth: 1.5, borderColor: c.navy },
  // ── Demo simulator banner ────────────────────────────────────────────────────
  // A30: server-alarm state
  alarmPendingBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#fef3c7', borderWidth: 1, borderColor: '#fbbf24',
    borderRadius: 12, padding: 12, marginBottom: 10,
  },
  alarmOffBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#fef2f2', borderWidth: 1.5, borderColor: c.emergencyRed,
    borderRadius: 12, padding: 12, marginBottom: 10,
  },
  alarmOffCard: { alignItems: 'flex-start', backgroundColor: '#fef2f2', borderColor: c.emergencyRed },
  alarmBannerTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: '#92400e' },
  alarmBannerBody: { fontFamily: theme.fonts.body, fontSize: 13, color: c.ink, lineHeight: 19, marginTop: 2 },
  alarmRetryBtn: {
    alignSelf: 'flex-start', marginTop: 8, paddingVertical: 8, paddingHorizontal: 14,
    borderRadius: 10, borderWidth: 1.5, borderColor: c.navy, backgroundColor: c.surface, minHeight: 44, justifyContent: 'center',
  },
  alarmRetryTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13.5, color: c.navy },
  alarmOnRow: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'stretch' },
  alarmOnTxt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 12.5, color: c.muted },
  demoBanner: {
    backgroundColor: '#fef3c7', borderWidth: 1, borderColor: '#fbbf24',
    borderRadius: 12, padding: 12, marginBottom: 10,
  },
  demoBannerHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  demoBannerTitle: { fontFamily: theme.fonts.bodySemiBold, fontSize: 12, color: '#92400e', flex: 1 },
  demoBtnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  demoBtn: {
    backgroundColor: '#fbbf24', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 7,
  },
  demoBtnTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 12, color: '#78350f' },
});