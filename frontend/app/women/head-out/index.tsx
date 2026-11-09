import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Linking, Modal, AppState, TextInput, Image } from 'react-native';
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
import { getLastLocation } from '@/src/safety/locationCache';
import { formatLocationFix } from '@/src/safety/locationPresentation';
import { useLocationUpload } from '@/src/hooks/useLocationUpload';
import { ActiveJourneyMap } from '@/src/women/ActiveJourneyMap';
import { DestinationMapPicker } from '@/src/women/DestinationMapPicker';
import { isValidCoord, isValidRadius, haversineMeters, distanceToPolylineMeters } from '@/src/utils/mapValidation';
import { listAcceptedRecipients, getPhotoViewToken, type InviteLink } from '@/src/trustedCircle/api';

import { openExternal } from '@/src/outbound';
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
// If a deviation persists this long with no sign of heading back AND the
// traveller hasn't dismissed it, auto-notify the trusted circle — product
// decision: 15 minutes (the low end of "15 to 20" — short enough to still be
// useful as an early warning, long enough to absorb a GPS blip or someone
// just not glancing at their phone right away).
const DEVIATION_ESCALATION_MS = 15 * 60 * 1000;
// "Heading back toward the destination" means the current distance is at
// least this much closer than it was when the deviation episode started —
// a small buffer so ordinary GPS jitter doesn't get read as course-correcting.
const HEADING_BACK_MARGIN_METERS = 30;

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
}

function formatCountdown(secs: number): string {
  if (secs <= 0) return '0:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

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
  // Guards the journey-recovery effect below so it only ever attempts a
  // create once per session — see that effect for the full race-prevention story.
  const journeyCreateAttemptedRef = useRef(false);
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
          setSession(raw ? JSON.parse(raw) : null);
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
  useEffect(() => {
    if (
      !session || expired || !GO1B_GPS_ENABLED || !authToken ||
      journeyToken || journeyCreateAttemptedRef.current
    ) return;
    journeyCreateAttemptedRef.current = true;
    fetch(`${API_BASE}/api/journey/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        destination: session.destination,
        duration_mins: session.durationMins,
        recipient_link_ids: session.recipientLinkIds ?? [],
        remind_before_mins: session.remindBeforeMins ?? null,
        auto_notify_on_no_response: session.autoNotifyOnNoResponse ?? true,
      }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.token) setJourneyToken(data.token); })
      .catch(() => {});   // non-fatal — GPS tracking stays best-effort
  }, [session, expired, authToken, journeyToken]);

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
    if (!loading && !session) router.replace('/women/head-out/destination');
  }, [loading, session, router]);

  const endSession = useCallback(async () => {
    // Part B/P4: tell linked recipients this journey completed safely — best-effort
    if (GO1B_GPS_ENABLED && authToken && journeyToken) {
      fetch(`${API_BASE}/api/journey/status/${journeyToken}/safe`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${authToken}` },
      }).catch(() => {});
    }
    await AsyncStorage.removeItem(SESSION_KEY).catch(() => {});
    setSession(null);
    setExpired(false);
    setJourneyToken(null);
    setSharingRevoked(false);
    setRouteInfo(null);
    referenceRouteRef.current = null;
    referenceRouteProviderRef.current = null;
    distanceHistoryRef.current = [];
    deviationStartedAtRef.current = null;
    deviationBaselineDistanceRef.current = null;
    deviationEscalatedRef.current = false;
    journeyCreateAttemptedRef.current = false; // a future session may need its own journey created
  }, [authToken, journeyToken]);

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
  const [alertRaised, setAlertRaised] = useState(false);
  useEffect(() => {
    if (graceSecsLeft === 0 && GO1B_GPS_ENABLED && authToken && journeyToken && !missedReportedRef.current) {
      missedReportedRef.current = true;
      setAlertRaised(true);
      fetch(`${API_BASE}/api/journey/status/${journeyToken}/missed-checkin`, {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}` },
      }).catch(() => {});
    }
    if (!expired) { missedReportedRef.current = false; setAlertRaised(false); }
  }, [expired, graceSecsLeft, authToken, journeyToken]);

  const raiseAlertNow = useCallback(() => {
    if (!GO1B_GPS_ENABLED || !authToken || !journeyToken || missedReportedRef.current) return;
    missedReportedRef.current = true;
    setAlertRaised(true);
    fetch(`${API_BASE}/api/journey/status/${journeyToken}/missed-checkin`, {
      method: 'POST', headers: { Authorization: `Bearer ${authToken}` },
    }).catch(() => {});
  }, [authToken, journeyToken]);

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
    try {
      const r = await fetch(`${API_BASE}/api/journey/status/${journeyToken}/revoke`, {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}` },
      });
      if (r.ok) setSharingRevoked(true);
    } catch {} finally {
      setRevokingShare(false);
    }
  }, [journeyToken, authToken, revokingShare]);

  const requestHelp = useCallback(() => {
    if (GO1B_GPS_ENABLED && authToken && journeyToken) {
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
    // An explicit "I'm okay" always cancels any pending auto-escalation for
    // this episode — a human just affirmatively responded, so there is
    // nothing left to escalate about. A future deviation starts a fresh
    // episode with its own full 15-minute window, never an immediate re-fire.
    deviationStartedAtRef.current = null;
    deviationBaselineDistanceRef.current = null;
    deviationEscalatedRef.current = false;
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
      deviationStartedAtRef.current = null;   // same reasoning as handleOkayDeviated — a new destination is a fresh start
      deviationBaselineDistanceRef.current = null;
      deviationEscalatedRef.current = false;
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
  const gps = useJourneyGPS(
    journeyToken,
    GO1B_GPS_ENABLED && !!session && !expired && locationConsentGiven,
    () => setShowPermDeniedSettings(true),
  );

  const hasDestCoord = isValidCoord(session?.latitude ?? null, session?.longitude ?? null);

  // GO1C: fetch/refresh the route line + ETA. Runs once a live fix is
  // available, then again whenever DIRECTIONS_REFRESH_MS has elapsed or the
  // destination itself changed (routeInfo reset to null by handleSaveChangeDestination).
  useEffect(() => {
    if (!GO1C_LIVE_ROUTE_ENABLED || expired || !hasDestCoord || !isValidCoord(gps.latitude, gps.longitude)) return;
    if (routeInfo && Date.now() - routeInfo.fetchedAt < DIRECTIONS_REFRESH_MS) return;
    let cancelled = false;
    fetch(
      `${API_BASE}/api/geo/directions?origin_lat=${gps.latitude}&origin_lng=${gps.longitude}` +
      `&dest_lat=${session!.latitude}&dest_lng=${session!.longitude}`,
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
  }, [gps.latitude, gps.longitude, hasDestCoord, expired, routeInfo, session]);

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

  const hasArrived = GO1C_LIVE_ROUTE_ENABLED && distanceToDestination != null && distanceToDestination <= arrivalRadius;

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

  // GO1C: deviation → trusted-circle auto-escalation after sustained silence.
  // Tracks one "episode" per continuous hasDeviated streak: when it starts,
  // the distance-to-destination baseline at that moment, and whether this
  // episode has already escalated (so retries/re-renders don't re-fire).
  // handleOkayDeviated / handleSaveChangeDestination explicitly clear
  // deviationStartedAtRef — an acknowledged deviation never escalates later,
  // even if hasDeviated happens to still read true right after.
  const deviationStartedAtRef = useRef<number | null>(null);
  const deviationBaselineDistanceRef = useRef<number | null>(null);
  const deviationEscalatedRef = useRef(false);

  useEffect(() => {
    if (hasDeviated && deviationStartedAtRef.current == null) {
      deviationStartedAtRef.current = Date.now();
      deviationBaselineDistanceRef.current = distanceToDestination;
      deviationEscalatedRef.current = false;
    } else if (!hasDeviated) {
      deviationStartedAtRef.current = null;
      deviationBaselineDistanceRef.current = null;
      deviationEscalatedRef.current = false;
    }
  }, [hasDeviated, distanceToDestination]);

  useEffect(() => {
    const startedAt = deviationStartedAtRef.current;
    if (
      !GO1C_LIVE_ROUTE_ENABLED || !startedAt || deviationEscalatedRef.current ||
      !authToken || !journeyToken || session?.autoNotifyOnNoResponse === false ||
      Date.now() - startedAt < DEVIATION_ESCALATION_MS
    ) return;

    const baseline = deviationBaselineDistanceRef.current;
    const headingBack = baseline != null && distanceToDestination != null
      && baseline - distanceToDestination > HEADING_BACK_MARGIN_METERS;
    if (headingBack) {
      // Clearly correcting course — don't escalate, and let this episode end
      // naturally (hasDeviated should clear on its own shortly as offRoute/
      // movingAway stop being true against the improving distance).
      return;
    }

    deviationEscalatedRef.current = true;   // claim BEFORE the async call — a slow response must not double-fire
    fetch(`${API_BASE}/api/journey/status/${journeyToken}/route-deviation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ started_at: new Date(startedAt).toISOString() }),
    }).catch(() => {});   // best-effort — a failed escalation call must not crash the journey screen
  }, [distanceToDestination, authToken, journeyToken, session]);

  // F2b / F2c: battery-aware upload hook + stable refs for the AppState handler
  const { lastGaspUpload } = useLocationUpload(authToken, journeyToken);
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
        expiredRef.current
      ) return;
      lastGaspFiredRef.current = true;
      try {
        const uid: string = ((userRef.current as any)?.id) ?? 'anon';
        const cached = await getLastLocation(uid);
        await lastGaspUploadRef.current(
          cached.lat,
          cached.lng,
          cached.accuracyM,
          cached.plusCode || 'Unknown area',
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

  // Loading, or no session yet (the redirect effect above is about to send
  // the user into the wizard) — nothing for this screen to render either way.
  if (loading || !session) return null;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      keyboardShouldPersistTaps="handled"
      testID="head-out-screen"
    >
      <ScreenHeader title="Head out safely" subtitle="Set a check-in timer — nothing is sent automatically" />

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

              {TRUSTED_CIRCLE_RECIPIENT && GO1B_GPS_ENABLED && journeyToken && selectedRecipients.length > 0 && (
                <View style={styles.statusCard} testID="headout-server-alert-status">
                  <Ionicons name="time-outline" size={20} color={c.navy} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.statusCardLabel}>Server alert status</Text>
                    <Text style={styles.statusCardValue}>
                      {session.autoNotifyOnNoResponse === false
                        ? "Won't auto-notify — you chose \"Do nothing\" in Step 3"
                        : alertRaised || graceSecsLeft === 0
                          ? 'Your trusted circle has been notified'
                          : `Will notify your circle in ${formatCountdown(graceSecsLeft ?? 0)}`}
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
                          {session.autoNotifyOnNoResponse === false
                            ? 'Not auto-notified'
                            : alertRaised || graceSecsLeft === 0
                              ? 'Notified'
                              : `In ${formatCountdown(graceSecsLeft ?? 0)}`}
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
                style={[styles.button, { marginTop: 14 }]}
                onPress={handleCheckInNow}
                accessibilityRole="button"
                accessibilityLabel="Check in now"
              >
                <Ionicons name="checkmark-done-outline" size={18} color="#fff" />
                <Text style={styles.buttonText}>{extending ? 'Checking in…' : 'Check in now'}</Text>
              </Pressable>
              {!!extendError && <Text style={styles.inlineError}>{extendError}</Text>}

              {TRUSTED_CIRCLE_RECIPIENT && GO1B_GPS_ENABLED && journeyToken && selectedRecipients.length > 0 && !alertRaised && graceSecsLeft !== 0 && (
                <Pressable testID="headout-raise-alert-now" onPress={raiseAlertNow} accessibilityRole="button" accessibilityLabel="Raise alert now">
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
                style={[styles.button, styles.outlineAlertBtn]}
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
              <Pressable
                testID="headout-i-arrived"
                style={[styles.button, styles.safeButton]}
                onPress={endSession}
                accessibilityRole="button"
                accessibilityLabel="Confirm I arrived"
              >
                <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                <Text style={styles.buttonText}>I arrived</Text>
              </Pressable>
              <Pressable testID="headout-not-here-yet" onPress={handleDismissArrived} accessibilityRole="button" accessibilityLabel="Not here yet">
                <Text style={styles.linkTxt}>Not here yet</Text>
              </Pressable>
              <Pressable
                testID="headout-extend-time"
                disabled={extending}
                onPress={() => handleExtendTime(15)}
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
                style={[styles.button, styles.safeButton]}
                onPress={handleOkayDeviated}
                accessibilityRole="button"
                accessibilityLabel="I'm okay"
              >
                <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                <Text style={styles.buttonText}>{"I'm okay"}</Text>
              </Pressable>
              <Pressable
                testID="headout-change-destination"
                style={[styles.button, styles.guardianBtn]}
                onPress={handleOpenChangeDestination}
                accessibilityRole="button"
                accessibilityLabel="Change destination"
              >
                <Text style={[styles.buttonText, { color: c.navy }]}>Change destination</Text>
              </Pressable>
              {TRUSTED_CIRCLE_RECIPIENT && GO1B_GPS_ENABLED && journeyToken && selectedRecipients.length > 0 && (
                <Pressable
                  testID="headout-deviated-need-help"
                  style={[styles.button, styles.alertButton]}
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
                  : 'If this continues for 15 minutes with no sign of you heading back, DHARA will let your Trusted Circle know — tap "I\'m okay" or "Change destination" any time before then to cancel that.'}
              </Text>
            </View>
      ) : (
            <View style={styles.activeCard} testID="headout-active-card">
              <View style={styles.activeHeader}>
                <Ionicons name="navigate-circle-outline" size={26} color={c.navy} />
                <Text style={styles.activeTitle}>Session active</Text>
              </View>
              <Text style={styles.destTxt}>{session.destination}</Text>
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
              <Text style={styles.note}>{'Tap "I\'m home safely" when you\'re back. DHARA will help you alert your circle if this timer runs out.'}</Text>
              {GUARDIAN_SHARE_ENABLED && (
                <Pressable
                  testID="headout-notify-guardian"
                  style={[styles.button, styles.guardianBtn]}
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
                          style={styles.gpsAllowBtn}
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
                          style={styles.gpsSettingsBtn}
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
              {TRUSTED_CIRCLE_RECIPIENT && GO1B_GPS_ENABLED && journeyToken && selectedRecipients.length > 0 && (
                <Pressable
                  testID="headout-need-help"
                  style={[styles.button, styles.alertButton, { marginTop: 10 }]}
                  onPress={requestHelp}
                  accessibilityRole="button"
                  accessibilityLabel="Request help from your Trusted Circle"
                >
                  <Ionicons name="warning-outline" size={18} color="#fff" />
                  <Text style={styles.buttonText}>Need help</Text>
                </Pressable>
              )}
              {GO1B_GPS_ENABLED && journeyToken && (
                sharingRevoked ? (
                  <Text style={styles.disclosureNote} testID="headout-sharing-revoked-note">
                    {"Sharing stopped. Your trusted circle can no longer see this journey's location or status."}
                  </Text>
                ) : (
                  <Pressable
                    testID="headout-stop-sharing"
                    disabled={revokingShare}
                    style={[styles.button, styles.stopSharingBtn, { marginTop: 10 }]}
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
            style={[styles.button, styles.safeButton]}
            onPress={endSession}
            accessibilityRole="button"
            accessibilityLabel="I'm home safely"
          >
            <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
            <Text style={styles.buttonText}>{"I'm home safely"}</Text>
          </Pressable>

      <Text style={styles.disclosureNote}>
        Nothing has been sent. Your session is saved on this device only.
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
              style={[styles.button, { marginTop: 8 }]}
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
              style={[styles.button, (changingDest || !changeDestLabel.trim()) && styles.buttonDisabled, { marginTop: 8 }]}
              onPress={handleSaveChangeDestination}
              accessibilityRole="button"
              accessibilityLabel="Save new destination"
            >
              <Text style={styles.buttonText}>{changingDest ? 'Saving…' : 'Save new destination'}</Text>
            </Pressable>
            <Pressable
              testID="headout-change-dest-cancel"
              style={{ marginTop: 10, alignItems: 'center' }}
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
});