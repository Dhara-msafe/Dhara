/**
 * Head Out wizard — Step 1: Choose Destination.
 *
 * Browse Saved places or Recent destinations, drop a pin on the map, search a
 * real-world address, or type a custom label. Selecting a destination here
 * only stores a DRAFT (headOutWizardStore) — nothing is sent to the backend
 * and no journey is created until the wizard's final step ("Start journey").
 *
 * ADDRESS SEARCH — layered, same pattern DestinationPicker.tsx already uses:
 *   1. Try /api/geo/autocomplete (Google Places API, New) — only live when
 *      the backend has FEATURE_GOOGLE_PLACES_V1=true AND a real
 *      GOOGLE_PLACES_SERVER_KEY configured. Neither exists in this repo
 *      checkout (no .env file at all here) — whether they're set in whatever
 *      environment actually deploys this app is outside this repo's
 *      visibility. Places Autocomplete is a BILLED Google API.
 *   2. On any failure (flag off → 503, network error, Google outage), fall
 *      back to /api/geocode/search (free OpenStreetMap Nominatim) — the same
 *      endpoint this screen used before this layering was added. This keeps
 *      suggestions working today, with zero configuration, regardless of
 *      whether the Places pilot is ever turned on in production.
 * This is a SEPARATE session/instance from DestinationPicker.tsx's own Places
 * pilot — same backend contract, independent client-side state.
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { theme } from '@/src/theme';
import { UI_V22_P9, headOutBottomGutter } from '@/src/uiV22Flags';
// NF-UI-REV-13 (Group G follow-up, DHARA UI Revision v2.2.1): visible
// keyboard-focus ring only. No destination/search/map logic changes.
import { focusRingStyle } from '@/src/a11yFocus';
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { StepStrip } from '@/src/ui/kit';
import { DestinationMapPicker } from '@/src/women/DestinationMapPicker';
import { useAuth } from '@/src/auth';
import { useHeadOutWizard } from '@/src/women/headOutWizardStore';
import { getRecentDestinations, recordRecentDestination, type RecentDestination } from '@/src/women/headOutRecents';
import type { DestinationValue } from '@/src/women/DestinationPicker';
import { useLivePosition } from '@/src/women/useLivePosition';

const c = theme.colors;
type IconName = React.ComponentProps<typeof Ionicons>['name'];
type Tab = 'saved' | 'recent' | 'map';

const ADDRESS_SEARCH_MIN_CHARS = 3;
const ADDRESS_SEARCH_DEBOUNCE_MS = 300;

interface SavedPlace {
  place_id: string;
  label: string;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number;
  radius_label: string;
  google_place_id?: string | null;
  needs_refresh?: boolean;
}

/** A plain OSM result — coordinates are already known, no further lookup needed. */
interface CoordSuggestion {
  kind: 'coords';
  label: string;
  latitude: number;
  longitude: number;
}

/** A Google Places result — coordinates are deliberately NOT fetched yet.
 * Places bills autocomplete and place-details as separate line items; a
 * details() call only happens if the user actually selects this row, same
 * discipline DestinationPicker.tsx's Places pilot already follows. */
interface PlacesSuggestionRow {
  /** The place's display NAME alone (e.g. 'Inorbit Mall') — used as the
   * destination label when tapped; the resolved street address stays for
   * coordinates only (fix 4, 21 Nov). */
  mainText: string;
  kind: 'places';
  place_id: string;
  label: string;
  provider: string; // "google" when Places is configured, "osm" when it falls back to the free NominatimFallbackProvider (geo_router.py) — passed straight back to /api/geo/details so the backend knows which provider to resolve the place_id against.
}

type UnifiedSuggestion = CoordSuggestion | PlacesSuggestionRow;

async function fetchSavedPlaces(base: string, token: string): Promise<SavedPlace[]> {
  try {
    const r = await fetch(`${base}/api/safety/places`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return [];
    const j = await r.json();
    return j.places ?? [];
  } catch {
    return [];
  }
}

/** Shorter, cleaner label for a selected address (first 2 comma segments) —
 * same trimming DestinationPicker.tsx applies, kept local since that file
 * doesn't export it. */
function shortAddressLabel(full: string): string {
  const parts = full.split(',').map(s => s.trim()).filter(Boolean);
  return parts.slice(0, 2).join(', ') || full;
}

/** Free OSM fallback (/api/geocode/search) — always available, no flag, no key. */
async function fetchOsmSuggestions(base: string, query: string): Promise<CoordSuggestion[]> {
  try {
    const r = await fetch(`${base}/api/geocode/search?q=${encodeURIComponent(query)}&limit=5`);
    if (!r.ok) return [];
    const j = await r.json();
    return (j.suggestions ?? []).map((s: { label: string; latitude: number; longitude: number }) => ({
      kind: 'coords' as const,
      label: shortAddressLabel(s.label),
      latitude: s.latitude,
      longitude: s.longitude,
    }));
  } catch {
    return [];
  }
}

/** Google Places (New) autocomplete, proxied server-side. THROWS on any
 * non-2xx (including the expected 503 when the pilot flag/key aren't set) or
 * network error, so the caller can fall back to OSM — mirrors
 * DestinationPicker.tsx's own fetchPlacesAutocomplete exactly. */
async function fetchPlacesAutocomplete(base: string, input: string, sessionToken: string, authToken: string): Promise<PlacesSuggestionRow[]> {
  const r = await fetch(
    `${base}/api/geo/autocomplete?input=${encodeURIComponent(input)}&session_token=${encodeURIComponent(sessionToken)}&limit=5`,
    { headers: { Authorization: `Bearer ${authToken}` } },
  );
  if (!r.ok) throw new Error(`places_autocomplete_${r.status}`);
  const j = await r.json();
  const rows: { place_id: string; main_text: string; secondary_text: string; provider: string }[] = j.suggestions ?? [];
  return rows.map(row => ({
    kind: 'places' as const,
    place_id: row.place_id,
    label: row.secondary_text ? `${row.main_text}, ${row.secondary_text}` : row.main_text,
    // Fix 4 (21 Nov): keep the PLACE NAME. details() returns a street
    // address ('S No. 64, Inorbit Mall Rd'); the name the user actually
    // tapped ('Inorbit Mall') is what the journey should be called.
    mainText: row.main_text,
    provider: row.provider,
  }));
}

/** Resolves a Places row's actual coordinates. Only ever called once, right
 * when the user taps the suggestion — see PlacesSuggestionRow's doc comment
 * for why. Returns null on any failure so the caller can show a plain
 * "couldn't load that address" message instead of silently doing nothing. */
async function fetchPlaceDetails(
  base: string, placeId: string, sessionToken: string, provider: string, authToken: string,
): Promise<{ label: string; latitude: number; longitude: number } | null> {
  try {
    const r = await fetch(
      `${base}/api/geo/details?place_id=${encodeURIComponent(placeId)}&session_token=${encodeURIComponent(sessionToken)}&provider=${encodeURIComponent(provider)}`,
      { headers: { Authorization: `Bearer ${authToken}` } },
    );
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/** The layered search itself: Places first, OSM if that's unavailable or
 * comes back empty. A session token is minted on first use and handed back
 * via sessionTokenRef so the caller can reuse it for the matching details()
 * call and then clear it once the search concludes (Places billing
 * semantics — one token per search session, reused across every keystroke's
 * autocomplete call, spent once on details, then discarded). */
async function searchAddressesLayered(
  base: string,
  query: string,
  // Structural ref type (not React.MutableRefObject) — avoids depending on a
  // React type export that's shifted across versions; all this needs is a
  // mutable .current box, which useRef() always satisfies.
  sessionTokenRef: { current: string | null },
  authToken: string | null,
): Promise<{ rows: UnifiedSuggestion[]; source: 'google' | 'osm' }> {
  if (!sessionTokenRef.current) sessionTokenRef.current = Crypto.randomUUID();
  // N-02: /api/geo/autocomplete now requires an authenticated session. No
  // token at all (not even a guest one) means skip straight to OSM rather
  // than sending a bogus "Bearer null" header.
  if (authToken) {
    try {
      const placesResults = await fetchPlacesAutocomplete(base, query, sessionTokenRef.current, authToken);
      if (placesResults.length > 0) {
        // The backend's own fallback provider also serves OSM rows through
        // this endpoint (row.provider === 'osm') — label those as OSM too,
        // so the on-screen source note is honest either way.
        const allOsm = placesResults.every(r => r.provider === 'osm');
        return { rows: placesResults, source: allOsm ? 'osm' : 'google' };
      }
    } catch {
      // Pilot off (503), misconfigured, or Google/network error — fall through to OSM.
    }
  }
  return { rows: await fetchOsmSuggestions(base, query), source: 'osm' };
}

/** Best-effort icon from the label text. No "place type" field exists on the
 * backend yet, so this is a heuristic, not stored data — safe to replace with
 * a real type field later without touching callers of this function. */
function iconForLabel(label: string): IconName {
  const l = label.toLowerCase();
  if (/\b(hostel|home|house|flat|pg)\b/.test(l)) return 'home-outline';
  if (/\b(gate|college|university|school|campus)\b/.test(l)) return 'business-outline';
  if (/\b(library)\b/.test(l)) return 'book-outline';
  if (/\b(cafeteria|canteen|food|cafe|café)\b/.test(l)) return 'cafe-outline';
  if (/\b(office|work)\b/.test(l)) return 'briefcase-outline';
  if (/\b(hospital|clinic)\b/.test(l)) return 'medkit-outline';
  if (/\b(station|bus|metro|stop)\b/.test(l)) return 'bus-outline';
  return 'location-outline';
}

function matches(label: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || label.toLowerCase().includes(q);
}

export default function ChooseDestination() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token: authToken } = useAuth();
  const base = process.env.EXPO_PUBLIC_BACKEND_URL ?? '';

  const draft = useHeadOutWizard(s => s.destination);
  const setDraft = useHeadOutWizard(s => s.setDestination);

  const [value, setValue] = useState<DestinationValue>(draft);
  // A36: the map sits inside this scrolling page. While her finger is on
  // the map the page must not scroll, or the drag moves the page instead
  // of the pin (tester bug T1).
  const [mapActive, setMapActive] = useState(false);
  const [tab, setTab] = useState<Tab>('saved');
  // Bumped only on an explicit "jump" (saved place / recent / address pick)
  // so the map recentres — not on every drag, which should stay in view.
  const [mapRecenterKey, setMapRecenterKey] = useState(0);

  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [recents, setRecents] = useState<RecentDestination[]>([]);

  const [addressSuggestions, setAddressSuggestions] = useState<UnifiedSuggestion[]>([]);
  // Where the current suggestions came from — drives the visible OSM note so
  // the user knows when Google address search is unavailable (old PR #7 ask).
  const [suggestionSource, setSuggestionSource] = useState<'google' | 'osm' | null>(null);
  const [showAddressDropdown, setShowAddressDropdown] = useState(false);
  const [addressSearching, setAddressSearching] = useState(false);
  const [resolvingPlace, setResolvingPlace] = useState(false);
  const addressDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addressReqRef = useRef(0);
  const placesSessionTokenRef = useRef<string | null>(null);
  // True when the CURRENT latitude/longitude were set together with a label
  // as a matched pair (saved place / recent / address search result) — if the
  // user then edits that label, the coordinates no longer describe what the
  // label says and must be cleared, not silently carried over to the new
  // text. False when coordinates came from a manual map pin drop instead,
  // where the existing "type a nicer label for the pin you already dropped"
  // behavior is correct and intentional. See onChangeText below.
  const coordsFromSelectionRef = useRef(false);

  // ── Live position (foreground display-only, never uploaded) ─────────────────
  const live = useLivePosition();
  // Prevents auto-recentering more than once — after the first GPS fix we
  // only bump mapRecenterKey if the user has NOT yet typed a label or placed
  // a pin; once fired we never fire again so user edits are respected.
  const liveAutoRecenteredRef = useRef(false);
  // True while the pin's coordinates are ONLY the current-location default
  // placed by the effect below — nobody chose them. A deliberate act (pin
  // drag/drop, picking a place, 'Add a custom destination') clears it. A
  // typed label riding on these default coordinates must NOT be trusted as
  // "label matches point": 'Charminar' typed over a pin at the user's house
  // would silently track the wrong place (owner finding, 21 Nov).
  const autoDefaultCoordsRef = useRef(false);
  // L1 (21 Nov): render-visible mirror of autoDefaultCoordsRef — the pill
  // below must stop claiming 'Using your location' once the point is a
  // chosen destination rather than the current-location default.
  const [coordsAreDefaultUi, setCoordsAreDefaultUi] = useState(false);
  // 10-second deadline: if no GPS fix arrives in time, stop the spinner and
  // show a plain "tap to retry" hint. The underlying watch continues so a
  // late fix is still applied — this is purely a UI state.
  const [locationTimedOut, setLocationTimedOut] = useState(false);
  const locationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!authToken) return;
    setLoadingSaved(true);
    fetchSavedPlaces(base, authToken).then(setSavedPlaces).finally(() => setLoadingSaved(false));
  }, [authToken, base]);

  useEffect(() => { getRecentDestinations().then(setRecents); }, []);

  useEffect(() => () => { if (addressDebounceRef.current) clearTimeout(addressDebounceRef.current); }, []);

  // Auto-request on mount: shows the permission prompt the first time; resumes
  // silently if already granted. A 10-second deadline hides the spinner and
  // shows a "tap to retry" hint if no GPS fix arrives in that window.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setLocationTimedOut(false);
    locationTimeoutRef.current = setTimeout(() => setLocationTimedOut(true), 10_000);
    void live.request();
    return () => {
      if (locationTimeoutRef.current) clearTimeout(locationTimeoutRef.current);
    };
  }, []);

  // As soon as the hook reaches any terminal state (granted / denied / blocked /
  // unavailable), the spinner race is over — cancel the timeout and clear the
  // timed-out flag so the correct status message shows immediately.
  useEffect(() => {
    // Fix 8 (21 Nov): this effect also runs once at mount while status is
    // still 'idle' — clearing the deadline then left the spinner with no
    // timeout at all, so 'Getting your location…' could spin forever when no
    // fix ever arrived. Only a TERMINAL state ends the race.
    if (live.status === 'asking' || live.status === 'idle') return;
    if (locationTimeoutRef.current) {
      clearTimeout(locationTimeoutRef.current);
      locationTimeoutRef.current = null;
    }
    setLocationTimedOut(false);
  }, [live.status]);

  // On the first GPS fix, if the user has not yet typed anything or placed a
  // pin, place the pin at the user's current location AND recenter the map.
  // coordsFromSelectionRef stays false (pin-drop semantics), so typing a label
  // afterward keeps the GPS coordinates intact. After this single fire,
  // liveAutoRecenteredRef prevents any further overrides.
  useEffect(() => {
    if (!live.point || liveAutoRecenteredRef.current) return;
    if (value.label.trim() !== '' || value.latitude != null) return;
    liveAutoRecenteredRef.current = true;
    // Place pin at user's location (coordsFromSelectionRef stays false).
    autoDefaultCoordsRef.current = true;
    setCoordsAreDefaultUi(true);
    setValue(v => ({ ...v, latitude: live.point!.latitude, longitude: live.point!.longitude }));
    setMapRecenterKey(k => k + 1);
  }, [live.point, value.label, value.latitude]);

  const filteredSaved = useMemo(
    () => savedPlaces.filter(p => matches(p.label, value.label)),
    [savedPlaces, value.label],
  );
  const filteredRecents = useMemo(
    () => recents.filter(r => matches(r.label, value.label)),
    [recents, value.label],
  );

  const onChangeText = useCallback((text: string) => {
    // Typing starts a fresh custom entry — clears a prior saved-place link,
    // same contract as DestinationPicker.tsx's handleLabelChange. Coordinates
    // from a map pin are left as-is (you can type a nicer label for a pin you
    // already dropped without losing its position) — but coordinates that
    // arrived PAIRED with a label (a saved place / recent / address result)
    // must be cleared here: editing that label means the user is describing a
    // different place, and silently keeping the old pair's coordinates would
    // point live tracking at the wrong location. See coordsFromSelectionRef.
    if (coordsFromSelectionRef.current) {
      coordsFromSelectionRef.current = false;
    autoDefaultCoordsRef.current = false;
    setCoordsAreDefaultUi(false);
      setValue(v => ({ ...v, label: text, savedPlaceId: undefined, latitude: null, longitude: null }));
    } else {
      setValue(v => ({ ...v, label: text, savedPlaceId: undefined }));
    }

    if (addressDebounceRef.current) clearTimeout(addressDebounceRef.current);
    const trimmed = text.trim();
    if (trimmed.length < ADDRESS_SEARCH_MIN_CHARS) {
      setAddressSuggestions([]);
      setShowAddressDropdown(false);
      return;
    }
    addressDebounceRef.current = setTimeout(async () => {
      const reqId = ++addressReqRef.current;
      setAddressSearching(true);
      const results = await searchAddressesLayered(base, trimmed, placesSessionTokenRef, authToken);
      if (addressReqRef.current !== reqId) return; // superseded by a newer keystroke
      setAddressSuggestions(results.rows);
      setSuggestionSource(results.source);
      setShowAddressDropdown(results.rows.length > 0);
      setAddressSearching(false);
    }, ADDRESS_SEARCH_DEBOUNCE_MS);
  }, [base, authToken]);

  const selectSavedPlace = useCallback((p: SavedPlace) => {
    coordsFromSelectionRef.current = true;
    autoDefaultCoordsRef.current = false;
    setCoordsAreDefaultUi(false);
    setValue({ label: p.label, radiusMeters: p.radius_meters, savedPlaceId: p.place_id, latitude: p.latitude, longitude: p.longitude });
    setShowAddressDropdown(false);
    setMapRecenterKey(k => k + 1);
  }, []);

  const selectRecent = useCallback((r: RecentDestination) => {
    coordsFromSelectionRef.current = true;
    autoDefaultCoordsRef.current = false;
    setCoordsAreDefaultUi(false);
    setValue({ label: r.label, radiusMeters: r.radiusMeters, latitude: r.latitude ?? null, longitude: r.longitude ?? null, savedPlaceId: undefined });
    setShowAddressDropdown(false);
    setMapRecenterKey(k => k + 1);
  }, []);

  const selectAddressSuggestion = useCallback(async (s: UnifiedSuggestion) => {
    if (s.kind === 'coords') {
      coordsFromSelectionRef.current = true;
    autoDefaultCoordsRef.current = false;
    setCoordsAreDefaultUi(false);
      setValue(v => ({ label: s.label, radiusMeters: v.radiusMeters, savedPlaceId: undefined, latitude: s.latitude, longitude: s.longitude }));
      setAddressSuggestions([]);
      setShowAddressDropdown(false);
      setMapRecenterKey(k => k + 1);
      return;
    }
    // Places row — resolve coordinates now, the one point this flow is
    // allowed to spend the "details" half of the Places session token.
    const token = placesSessionTokenRef.current;
    setShowAddressDropdown(false);
    if (!token || !authToken) return;
    setResolvingPlace(true);
    const details = await fetchPlaceDetails(base, s.place_id, token, s.provider, authToken);
    setResolvingPlace(false);
    placesSessionTokenRef.current = null; // session concluded — fresh token next search
    if (!details) return; // fails closed — typed text stays exactly as the user left it
    coordsFromSelectionRef.current = true;
    autoDefaultCoordsRef.current = false;
    setCoordsAreDefaultUi(false);   // #79: a tapped place is a deliberate choice
    setValue(v => ({ label: s.mainText || shortAddressLabel(details.label), radiusMeters: v.radiusMeters, savedPlaceId: undefined, latitude: details.latitude, longitude: details.longitude }));   // #83 fix 4: keep the place NAME
    setAddressSuggestions([]);
    setMapRecenterKey(k => k + 1);
  }, [base, authToken]);

  const movePin = useCallback((lat: number, lng: number) => {
    // A manual pin drop/drag is deliberately NOT a "selection pair" — see
    // coordsFromSelectionRef and onChangeText's comment for why typing a
    // label afterward is allowed to keep these coordinates.
    coordsFromSelectionRef.current = false;
    autoDefaultCoordsRef.current = false;
    setCoordsAreDefaultUi(false);
    setValue(v => ({ ...v, latitude: lat, longitude: lng }));
  }, []);

  const useAsCustom = useCallback(() => {
    // Explicitly commit to "my own typed text", clearing any saved-place link
    // and any coordinates picked earlier (e.g. from a different saved place)
    // so this reads unambiguously as a fresh, unlinked custom destination.
    coordsFromSelectionRef.current = false;
    autoDefaultCoordsRef.current = false;
    setCoordsAreDefaultUi(false);
    setValue(v => ({ label: v.label, radiusMeters: v.radiusMeters, savedPlaceId: undefined, latitude: null, longitude: null }));
  }, []);

  const canContinue = value.label.trim().length > 0;

  // ── Confirm-this-point for typed destinations ──────────────────────────────
  // B-126 attached the top OSM geocode hit to a typed destination silently.
  // A wrong top hit (common with short or ambiguous labels) would point live
  // tracking at the wrong place without the traveller ever seeing it. So the
  // geocoded point is now shown on the map first and must be confirmed:
  //   Next (typed, no coords) → geocode → pin + map recentre + confirm bar →
  //   "Yes, that's the spot" proceeds with coords; "No — continue without a
  //   map point" proceeds text-only (exactly the pre-B-126 journey).
  // No match / network failure still proceeds text-only, as before.
  const [geocoding, setGeocoding] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<{ matchedLabel: string } | null>(null);

  // Any change to the typed label (editing it, or picking a saved place /
  // recent / suggestion, which all replace it) makes a shown match stale —
  // drop the question. Dragging the pin keeps it: the bar itself invites that.
  useEffect(() => { setPendingConfirm(null); }, [value.label]);

  const proceed = useCallback(async (final: DestinationValue) => {
    setPendingConfirm(null);
    setDraft(final);
    await recordRecentDestination(final);
    router.push('/women/head-out/radius');
  }, [setDraft, router]);

  const handleNext = useCallback(async () => {
    const final: DestinationValue = { ...value, label: value.label.trim() };
    if (!final.label) return;
    // Coordinates still carrying the current-location DEFAULT are not a
    // choice: a typed label over them must be geocoded and confirmed like a
    // coordinate-less one, or 'Charminar' would silently track the user's
    // own location. Deliberate coords (saved place, suggestion, pin drag,
    // confirmed geocode) skip straight through.
    const coordsAreDefaultOnly = autoDefaultCoordsRef.current;
    if (final.latitude != null && final.longitude != null && !coordsAreDefaultOnly) {
      await proceed(final);
      return;
    }
    setGeocoding(true);
    const hits = await fetchOsmSuggestions(base, final.label).catch(() => [] as CoordSuggestion[]);
    setGeocoding(false);
    if (hits.length === 0) {
      // Text-only journey. Default-only coordinates are dropped too — better
      // no map point than the wrong one.
      await proceed({ ...final, latitude: null, longitude: null });
      return;
    }
    // Show the match instead of silently trusting it: drop the pin there,
    // recentre the map, and ask. Coordinates are label-paired, so editing
    // the text afterwards clears them (coordsFromSelectionRef contract).
    coordsFromSelectionRef.current = true;
    autoDefaultCoordsRef.current = false;
    setCoordsAreDefaultUi(false);
    setValue(v => ({ ...v, latitude: hits[0].latitude, longitude: hits[0].longitude }));
    setTab('map');
    setMapRecenterKey(k => k + 1);
    setPendingConfirm({ matchedLabel: hits[0].label });
  }, [value, base, proceed]);

  const confirmGeocodedPoint = useCallback(() => {
    void proceed({ ...value, label: value.label.trim() });
  }, [value, proceed]);

  const rejectGeocodedPoint = useCallback(() => {
    // Not that place — continue with the typed words only. The wrong pin is
    // removed so nothing downstream can ever use it.
    coordsFromSelectionRef.current = false;
    autoDefaultCoordsRef.current = false;
    setCoordsAreDefaultUi(false);
    const final: DestinationValue = { ...value, label: value.label.trim(), latitude: null, longitude: null };
    setValue(v => ({ ...v, latitude: null, longitude: null }));
    void proceed(final);
  }, [value, proceed]);

  return (
    <View style={styles.root}>
      <ScreenHeader title={UI_V22_P9 ? 'Head out safely' : 'Head Out'} subtitle="Step 1 of 3 — Where are you going?" />
      {/* Redesign v3, stage 6: gold step bar, as in the prototype. */}
      <StepStrip step={1} total={3} />
      <ScrollView scrollEnabled={!mapActive} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + headOutBottomGutter(110) }]} keyboardShouldPersistTaps="handled">

        <Text style={styles.fieldLabel}>Where are you going?</Text>
        <View style={styles.searchRow}>
          <Ionicons name="search" size={18} color={c.muted} />
          <TextInput
            testID="headout-destination-search"
            value={value.label}
            onChangeText={onChangeText}
            onFocus={() => setShowAddressDropdown(addressSuggestions.length > 0)}
            onBlur={() => { setTimeout(() => setShowAddressDropdown(false), 150); }}
            placeholder="Search a saved place, or type a destination…"
            placeholderTextColor={c.muted}
            style={styles.searchInput}
            returnKeyType="done"
            accessibilityLabel="Search or type a destination"
          />
          {(addressSearching || resolvingPlace) && <ActivityIndicator size="small" color={c.muted} />}
        </View>

        {/* Real-world address suggestions — debounced, independent of the
            Saved/Recent lists below, which keep filtering live underneath.
            A Places row (kind: 'places') resolves its coordinates only once
            tapped, so it has no lat/lng yet to key on here. */}
        {showAddressDropdown && addressSuggestions.length > 0 && (
          <View style={styles.suggestionsBox} testID="headout-address-suggestions">
            {suggestionSource === 'osm' && (
              <Text style={styles.sourceNote} testID="headout-osm-source-note">
                Showing OpenStreetMap results — Google address search is currently unavailable
              </Text>
            )}
            {addressSuggestions.map((s, i) => (
              <Pressable
                key={s.kind === 'coords' ? `coords-${s.latitude}-${s.longitude}-${i}` : `places-${s.place_id}`}
                testID={`headout-address-suggestion-${i}`}
                style={(st) => [styles.suggestionRow, focusRingStyle(st)]}
                onPress={() => selectAddressSuggestion(s)}
                accessibilityRole="button"
                accessibilityLabel={`Select address ${s.label}`}
              >
                <Ionicons name="location-outline" size={15} color={c.muted} />
                <Text style={styles.suggestionTxt} numberOfLines={2}>{s.label}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.tabRow}>
          {([
            { key: 'saved', label: 'Saved places' },
            { key: 'recent', label: 'Recent' },
            { key: 'map', label: 'On map' },
          ] as { key: Tab; label: string }[]).map(t => (
            <Pressable
              key={t.key}
              testID={`headout-dest-tab-${t.key}`}
              style={(s) => [styles.tab, tab === t.key && styles.tabActive, focusRingStyle(s)]}
              onPress={() => setTab(t.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === t.key }}
            >
              <Text style={[styles.tabTxt, tab === t.key && styles.tabTxtActive]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>

        {tab === 'saved' && (
          <View style={styles.listSection}>
            {loadingSaved && <ActivityIndicator size="small" color={c.muted} style={{ marginVertical: 10 }} />}
            {!loadingSaved && !authToken && (
              <Text style={styles.emptyTxt}>Sign in to see and save your places.</Text>
            )}
            {!loadingSaved && authToken && filteredSaved.length === 0 && (
              <Text style={styles.emptyTxt}>
                {savedPlaces.length === 0 ? 'No saved places yet — manage these from Trusted Circle settings.' : 'No saved places match your search.'}
              </Text>
            )}
            {filteredSaved.map(p => (
              <Pressable
                key={p.place_id}
                testID={`headout-saved-${p.place_id}`}
                style={(s) => [styles.placeRow, value.savedPlaceId === p.place_id && styles.placeRowActive, focusRingStyle(s)]}
                onPress={() => selectSavedPlace(p)}
                accessibilityRole="button"
                accessibilityLabel={`${p.label}, ${p.radius_label} arrival area`}
              >
                <View style={styles.placeIcon}><Ionicons name={iconForLabel(p.label)} size={18} color={c.navy} /></View>
                <Text style={styles.placeLabel}>{p.label}</Text>
              </Pressable>
            ))}
            <Pressable
              testID="headout-add-custom"
              style={(s) => [styles.customRow, focusRingStyle(s)]}
              onPress={useAsCustom}
              accessibilityRole="button"
              accessibilityLabel="Use typed text as a custom destination"
            >
              <Ionicons name="add-circle-outline" size={20} color={c.darkGold} />
              <Text style={styles.customTxt}>Add a custom destination</Text>
            </Pressable>
          </View>
        )}

        {tab === 'recent' && (
          <View style={styles.listSection}>
            {filteredRecents.length === 0 && (
              <Text style={styles.emptyTxt}>
                {recents.length === 0 ? 'Destinations you use show up here.' : 'No recent destinations match your search.'}
              </Text>
            )}
            {filteredRecents.map((r, i) => (
              <Pressable
                key={`${r.label}-${i}`}
                testID={`headout-recent-${i}`}
                style={(s) => [styles.placeRow, focusRingStyle(s)]}
                onPress={() => selectRecent(r)}
                accessibilityRole="button"
                accessibilityLabel={r.label}
              >
                <View style={styles.placeIcon}><Ionicons name="time-outline" size={18} color={c.navy} /></View>
                <Text style={styles.placeLabel}>{r.label}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {tab === 'map' && (
          <Text style={styles.mapHint}>Tap or drag the pin on the map below to set your destination.</Text>
        )}

        <Text style={styles.fieldLabel}>Pin location (optional)</Text>

        {/* ── Use my current location ─────────────────────────────────── */}
        <Pressable
          testID="headout-dest-use-my-location"
          style={(s) => [styles.locationBtn, focusRingStyle(s)]}
          onPress={() => {
            setLocationTimedOut(false);
            if (locationTimeoutRef.current) clearTimeout(locationTimeoutRef.current);
            locationTimeoutRef.current = setTimeout(() => setLocationTimedOut(true), 10_000);
            void live.request();
          }}
          accessibilityRole="button"
          accessibilityLabel="Use my current location"
        >
          <Ionicons
            name={live.status === 'granted' ? 'location' : 'locate-outline'}
            size={18}
            color={live.status === 'granted' ? c.navy : c.darkGold}
          />
          <Text style={[styles.locationBtnTxt, live.status === 'granted' && coordsAreDefaultUi && styles.locationBtnTxtActive]}>
            {live.status === 'granted' && coordsAreDefaultUi && value.latitude != null
              ? 'Using your location'
              : live.status === 'granted' && value.label.trim()
                ? `Destination: ${value.label.trim()}`
                : 'Use my current location'}
          </Text>
          {live.status === 'asking' && !locationTimedOut && (
            <ActivityIndicator size="small" color={c.muted} style={{ marginLeft: 4 }} />
          )}
        </Pressable>

        {/* Status line — only shown when there is something worth telling the user */}
        {live.status === 'asking' && !locationTimedOut && (
          <Text style={styles.locationStatus}>Getting your location…</Text>
        )}
        {locationTimedOut && (
          <Text style={styles.locationStatusWarn}>Could not get your location. Tap to retry.</Text>
        )}
        {live.status === 'denied' && (
          <Text style={styles.locationStatusWarn}>
            Location access denied. Tap the button above to try again.
          </Text>
        )}
        {live.status === 'blocked' && (
          <View style={styles.locationBlockedRow}>
            <Text style={styles.locationStatusWarn}>Location access is blocked.</Text>
            {live.canOpenSettings && (
              <Pressable
                testID="headout-dest-open-settings"
                onPress={() => live.openSettings()}
                style={styles.openSettingsBtn}
                accessibilityRole="button"
                accessibilityLabel="Open settings to allow location access"
              >
                <Text style={styles.openSettingsTxt}>Open settings</Text>
              </Pressable>
            )}
          </View>
        )}
        {live.status === 'unavailable' && (
          <Text style={styles.locationStatusWarn}>Location is not available on this device.</Text>
        )}

        <DestinationMapPicker
          onInteractionChange={setMapActive}
          testID="headout-dest-map"
          latitude={value.latitude ?? null}
          longitude={value.longitude ?? null}
          radiusMeters={value.radiusMeters}
          onPositionChange={movePin}
          recenterKey={mapRecenterKey}
          userLocation={live.point}
        />
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
        {pendingConfirm ? (
          <View testID="headout-confirm-point" style={styles.confirmBox}>
            <Text style={styles.confirmTitle}>Is this the right spot?</Text>
            <Text style={styles.confirmMatch} numberOfLines={2}>
              Best match for “{value.label.trim()}”: {pendingConfirm.matchedLabel}. The pin on the map shows it — you can drag it to adjust.
            </Text>
            <View style={styles.confirmBtnRow}>
              <Pressable
                testID="headout-confirm-point-yes"
                style={(s) => [styles.nextBtn, styles.confirmBtn, focusRingStyle(s)]}
                onPress={confirmGeocodedPoint}
                accessibilityRole="button"
                accessibilityLabel="Yes, that is the spot — continue"
              >
                <Text style={styles.nextBtnTxt}>Yes, that’s the spot</Text>
              </Pressable>
              <Pressable
                testID="headout-confirm-point-no"
                style={(s) => [styles.confirmNoBtn, focusRingStyle(s)]}
                onPress={rejectGeocodedPoint}
                accessibilityRole="button"
                accessibilityLabel="No — continue without a map point"
              >
                <Text style={styles.confirmNoTxt}>No — continue without a map point</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            testID="headout-dest-next"
            style={(s) => [styles.nextBtn, (!canContinue || geocoding) && styles.nextBtnDisabled, focusRingStyle(s)]}
            disabled={!canContinue || geocoding}
            onPress={handleNext}
            accessibilityRole="button"
            accessibilityLabel="Next — set arrival radius"
          >
            {geocoding
              ? <ActivityIndicator size="small" color="#FFFFFF" />
              : <Text style={styles.nextBtnTxt}>Next</Text>}
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  content: { padding: 16, gap: 4 },
  fieldLabel: { fontFamily: theme.fonts.bodyBold, fontSize: 13, color: c.ink, marginBottom: 8, marginTop: 14 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
  },
  searchInput: { flex: 1, fontFamily: theme.fonts.body, fontSize: 13, color: c.ink },
  suggestionsBox: {
    borderWidth: 1, borderColor: c.lines, borderRadius: 12, backgroundColor: c.surface,
    marginTop: 6, overflow: 'hidden',
  },
  sourceNote: {
    fontFamily: theme.fonts.body, fontSize: 12.5, color: c.muted,
    paddingHorizontal: 12, paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.lines,
  },
  suggestionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.lines,
  },
  suggestionTxt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 12, color: c.ink, lineHeight: 16 },
  tabRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines },
  tabActive: { backgroundColor: c.navySoft, borderColor: c.navy },
  tabTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 12, color: c.muted },
  tabTxtActive: { color: c.navy },
  listSection: { marginTop: 14, gap: 8 },
  emptyTxt: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, fontStyle: 'italic', paddingVertical: 6 },
  placeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines,
    borderRadius: 12, padding: 12,
  },
  placeRowActive: { borderColor: c.navy, backgroundColor: c.navySoft },
  placeIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: c.navySoft, alignItems: 'center', justifyContent: 'center' },
  placeLabel: { fontFamily: theme.fonts.bodyBold, fontSize: 13, color: c.ink, flex: 1 },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  customTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.darkGold },
  mapHint: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 14, fontStyle: 'italic' },
  // ── Live location button ────────────────────────────────────────────────────
  locationBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    marginTop: 4,
  },
  locationBtnTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.darkGold, flex: 1 },
  locationBtnTxtActive: { color: c.navy },
  locationStatus: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 6, marginLeft: 4 },
  locationStatusWarn: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 6, marginLeft: 4 },
  locationBlockedRow: { marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  openSettingsBtn: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: c.navySoft },
  openSettingsTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 12, color: c.navy },
  footer: {
    paddingHorizontal: 16, paddingTop: 12, backgroundColor: c.background,
    borderTopWidth: 1, borderTopColor: c.lines,
  },
  nextBtn: { backgroundColor: c.navy, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  nextBtnDisabled: { opacity: 0.4 },
  nextBtnTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: '#fff' },
  // Confirm-this-point bar (typed destination → geocoded pin confirmation)
  confirmBox: { gap: 8 },
  confirmTitle: { fontFamily: theme.fonts.bodyBold, fontSize: 13, color: c.ink },
  confirmMatch: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, lineHeight: 16 },
  confirmBtnRow: { gap: 8 },
  confirmBtn: { marginTop: 2 },
  confirmNoBtn: { alignItems: 'center', paddingVertical: 10 },
  confirmNoTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 13, color: c.darkGold },
});
