/**
 * DestinationPicker — GO1A reusable component
 *
 * Lets the user search for a real address (OpenStreetMap Nominatim —
 * free, no API key; architected so Google Places can be swapped in later
 * behind the same /api/geocode/search backend contract), drop/drag a pin
 * on the map, or type a manual label, and choose a planned arrival-area
 * radius (100 m / 200 m / 300 m / custom). Saved places are loaded from
 * the backend (if the user is authenticated) and shown as quick-select chips.
 *
 * IMPORTANT LIMITATIONS (displayed to user):
 * - Radius selection is for planning only.
 * - No live GPS observations are made by this component.
 * - No geofence monitoring is active.
 * - Address suggestions appear as you type (debounced) and also on an
 *   explicit tap of the Search button / the keyboard's search key.
 * - The live-position dot is DISPLAY ONLY: with the user's permission the
 *   current position is drawn on this map on this device and used to bias
 *   suggestions. It is never uploaded, stored or tracked in the background,
 *   and it is independent of the journey GPS / guardian-share flags.
 *
 * Props:
 *   value         Current destination state
 *   onChange      Called with updated destination state on any field change
 *   authToken     Bearer token for saved-places API calls; omit for guest
 *   testID        Root testID for Playwright / native automation
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  ActivityIndicator, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { theme } from '@/src/theme';
import { DestinationMapPicker } from './DestinationMapPicker';
import { useLivePosition } from './useLivePosition';

// Google Places (New) debounced autocomplete pilot — default OFF. When off,
// this component behaves exactly as before (manual Search button + OSM
// only). See /api/geo/autocomplete, /api/geo/details (geo_router.py).
const PLACES_AUTOCOMPLETE_ENABLED = process.env.EXPO_PUBLIC_PLACES_AUTOCOMPLETE_V1 === 'true';
const PLACES_DEBOUNCE_MS = 300;

/** True only when both coordinates are real numbers. */
function isFinitePair(lat?: number | null, lng?: number | null): boolean {
  return typeof lat === 'number' && Number.isFinite(lat) && typeof lng === 'number' && Number.isFinite(lng);
}

// Mandatory limitation disclosure wording — kept accurate to whichever
// search path is actually active, never claiming device-location reads.
const ADDRESS_SOURCE_DISCLOSURE = PLACES_AUTOCOMPLETE_ENABLED
  ? 'Address suggestions appear as you type (Google Places, with a free OpenStreetMap backup) or when you tap Search. Your live position is only shown on this map, on this device — it is never uploaded or tracked in the background.'
  : 'Address suggestions come from OpenStreetMap search and only run when you tap Search. Your live position is only shown on this map, on this device — it is never uploaded or tracked in the background.';

const c = theme.colors;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DestinationValue {
  label: string;
  radiusMeters: number;
  savedPlaceId?: string;
  /**
   * Set by: an address-search selection, dragging/tapping the map pin, or
   * selecting a saved place that already has coordinates. Device position is
   * only ever copied in here when the user taps "Use my location".
   */
  latitude?: number | null;
  longitude?: number | null;
  /**
   * Where latitude/longitude came from — only set when coordinates were just
   * (re)resolved by this component, so the backend can track Google Places
   * storage-compliance (30-day cache cap; see safety_router.py). Omitted
   * (not just undefined-on-purpose) when unchanged from a loaded saved place.
   */
  coordsSource?: 'google' | 'osm' | 'manual';
  /** Google Place ID for the current coordinates, when coordsSource is 'google'. */
  googlePlaceId?: string;
}

export interface SavedPlace {
  place_id: string;
  label: string;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number;
  radius_label: string;
  google_place_id?: string | null;
  /** True when Google-sourced coordinates are past the 30-day cache cap and
   * should be refreshed (re-searched) rather than reused as-is. */
  needs_refresh?: boolean;
}

export interface AddressSuggestion {
  label: string;
  latitude: number;
  longitude: number;
}

/** A Google Places (New) autocomplete row (pilot). No OSM fallback behind
 * this dropdown — on any error it fails closed and the separate manual
 * Search button (OSM-backed /api/geocode/search) is the real fallback. */
export interface PlacesSuggestion {
  place_id: string;
  main_text: string;
  secondary_text: string;
  provider: string; // "google"
}

interface Props {
  value: DestinationValue;
  onChange: (v: DestinationValue) => void;
  authToken?: string;
  testID?: string;
  apiBase?: string;
  /**
   * Wording hotfix: when the caller's foreground-GPS feature flag
   * (e.g. EXPO_PUBLIC_GO1B_GPS) is on, the disclosure below must say so —
   * never silently claim "no location tracking" while a foreground GPS
   * hook is about to run for this journey. Omit/false = today's behaviour
   * (no GPS feature active anywhere for this journey).
   */
  gpsForegroundEnabled?: boolean;
}

// ── Radius presets ────────────────────────────────────────────────────────────

const RADIUS_PRESETS = [
  { label: '100 m', meters: 100 },
  { label: '200 m', meters: 200 },
  { label: '300 m', meters: 300 },
];
const RADIUS_MIN = 50;
const RADIUS_MAX = 2000;

function isPreset(m: number) {
  return RADIUS_PRESETS.some(p => p.meters === m);
}

const SEARCH_MIN_CHARS = 3;

// ── Address search (OpenStreetMap Nominatim, proxied via our backend) ───────

async function fetchAddressSuggestions(base: string, query: string): Promise<AddressSuggestion[]> {
  const r = await fetch(`${base}/api/geocode/search?q=${encodeURIComponent(query)}&limit=6`);
  if (!r.ok) return [];
  const j = await r.json();
  return j.suggestions ?? [];
}

// ── Places (New) debounced autocomplete pilot — behind EXPO_PUBLIC_PLACES_AUTOCOMPLETE_V1.
// Both calls THROW on any non-2xx/network error so callers can fail closed
// (hide the dropdown, leave the manual Search button fully functional).
async function fetchPlacesAutocomplete(
  base: string, input: string, sessionToken: string, authToken: string,
  bias?: { latitude: number; longitude: number } | null,
): Promise<PlacesSuggestion[]> {
  const r = await fetch(
    `${base}/api/geo/autocomplete?input=${encodeURIComponent(input)}&session_token=${encodeURIComponent(sessionToken)}&limit=6`
    + (bias ? `&lat=${bias.latitude.toFixed(5)}&lng=${bias.longitude.toFixed(5)}` : ''),
    { headers: { Authorization: `Bearer ${authToken}` } },
  );
  if (!r.ok) throw new Error(`places_autocomplete_${r.status}`);
  const j = await r.json();
  return j.suggestions ?? [];
}

async function fetchPlaceDetails(
  base: string, placeId: string, sessionToken: string, provider: string, authToken: string,
): Promise<{ label: string; latitude: number; longitude: number } | null> {
  const r = await fetch(
    `${base}/api/geo/details?place_id=${encodeURIComponent(placeId)}&session_token=${encodeURIComponent(sessionToken)}&provider=${encodeURIComponent(provider)}`,
    { headers: { Authorization: `Bearer ${authToken}` } },
  );
  if (!r.ok) throw new Error(`places_details_${r.status}`);
  return r.json();
}

/** Shorter, cleaner label for a selected address (first 2 comma segments). */
function shortAddressLabel(full: string): string {
  const parts = full.split(',').map(s => s.trim()).filter(Boolean);
  return parts.slice(0, 2).join(', ') || full;
}

/** Combine a Places suggestion's main/secondary text into one display label. */
function placesSuggestionLabel(s: PlacesSuggestion): string {
  const combined = s.secondary_text ? `${s.main_text}, ${s.secondary_text}` : s.main_text;
  return combined.length > 100 ? s.main_text : combined;
}

// ── Saved-place API helpers (no external SDK needed) ─────────────────────────

async function fetchSavedPlaces(base: string, token: string): Promise<SavedPlace[]> {
  const r = await fetch(`${base}/api/safety/places`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return [];
  const j = await r.json();
  return j.places ?? [];
}

async function deleteSavedPlace(base: string, token: string, placeId: string): Promise<boolean> {
  const r = await fetch(`${base}/api/safety/places/${placeId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  return r.ok;
}

async function createSavedPlace(
  base: string,
  token: string,
  payload: { label: string; radius_meters: number; latitude?: number; longitude?: number },
): Promise<SavedPlace | null> {
  const r = await fetch(`${base}/api/safety/places`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) return null;
  return r.json();
}

async function updateSavedPlace(
  base: string,
  token: string,
  placeId: string,
  patch: { label?: string; radius_meters?: number },
): Promise<SavedPlace | null> {
  const r = await fetch(`${base}/api/safety/places/${placeId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) return null;
  return r.json();
}

// ── Custom radius modal ───────────────────────────────────────────────────────

function CustomRadiusModal({
  visible, initial, onSave, onCancel,
}: { visible: boolean; initial: number; onSave: (m: number) => void; onCancel: () => void }) {
  const [raw, setRaw] = useState(String(initial));
  const [err, setErr] = useState('');

  useEffect(() => { if (visible) { setRaw(String(initial)); setErr(''); } }, [visible, initial]);

  const save = useCallback(() => {
    const n = parseInt(raw.trim(), 10);
    if (isNaN(n) || n < RADIUS_MIN || n > RADIUS_MAX) {
      setErr(`Enter a number between ${RADIUS_MIN} and ${RADIUS_MAX}`);
      return;
    }
    setErr('');
    onSave(n);
  }, [raw, onSave]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={mStyles.overlay}
      >
        <View style={mStyles.box}>
          <Text style={mStyles.title}>Custom radius</Text>
          <Text style={mStyles.hint}>Enter a value between {RADIUS_MIN} m and {RADIUS_MAX} m</Text>
          <TextInput
            value={raw}
            onChangeText={v => { setRaw(v); setErr(''); }}
            keyboardType="number-pad"
            style={mStyles.input}
            accessibilityLabel="Custom radius in metres"
            testID="custom-radius-input"
            returnKeyType="done"
            onSubmitEditing={save}
          />
          {!!err && <Text style={mStyles.err}>{err}</Text>}
          <View style={mStyles.row}>
            <Pressable
              style={[mStyles.btn, mStyles.btnCancel]}
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Cancel custom radius"
              testID="custom-radius-cancel"
            >
              <Text style={mStyles.btnCancelTxt}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[mStyles.btn, mStyles.btnSave]}
              onPress={save}
              accessibilityRole="button"
              accessibilityLabel="Apply custom radius"
              testID="custom-radius-save"
            >
              <Text style={mStyles.btnSaveTxt}>Apply</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Edit saved place modal ────────────────────────────────────────────────────

function EditPlaceModal({
  visible, place, onSave, onCancel,
}: { visible: boolean; place: SavedPlace | null; onSave: (label: string, radius: number) => void; onCancel: () => void }) {
  const [label, setLabel] = useState('');
  const [radius, setRadius] = useState(200);
  const [customVisible, setCustomVisible] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (visible && place) { setLabel(place.label); setRadius(place.radius_meters); setErr(''); }
  }, [visible, place]);

  const save = useCallback(() => {
    const l = label.trim();
    if (!l) { setErr('Name cannot be blank'); return; }
    if (l.length > 80) { setErr('Name is too long (max 80 characters)'); return; }
    setErr('');
    onSave(l, radius);
  }, [label, radius, onSave]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={mStyles.overlay}
      >
        <View style={mStyles.box}>
          <Text style={mStyles.title}>Edit saved place</Text>
          <TextInput
            value={label}
            onChangeText={v => { setLabel(v); setErr(''); }}
            placeholder="Place name"
            placeholderTextColor={c.muted}
            style={mStyles.input}
            maxLength={80}
            accessibilityLabel="Place name"
            testID="edit-place-label"
          />
          {!!err && <Text style={mStyles.err}>{err}</Text>}
          <Text style={mStyles.hint}>Arrival area radius</Text>
          <View style={mStyles.chipRow}>
            {RADIUS_PRESETS.map(p => (
              <Pressable
                key={p.meters}
                style={[mStyles.chip, radius === p.meters && mStyles.chipActive]}
                onPress={() => setRadius(p.meters)}
                accessibilityRole="radio"
                accessibilityState={{ checked: radius === p.meters }}
                aria-checked={radius === p.meters}
                accessibilityLabel={p.label}
                testID={`edit-radius-${p.meters}`}
              >
                <Text style={[mStyles.chipTxt, radius === p.meters && mStyles.chipActiveTxt]}>{p.label}</Text>
              </Pressable>
            ))}
            <Pressable
              style={[mStyles.chip, !isPreset(radius) && mStyles.chipActive]}
              onPress={() => setCustomVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="Set custom radius"
              testID="edit-radius-custom"
            >
              <Text style={[mStyles.chipTxt, !isPreset(radius) && mStyles.chipActiveTxt]}>
                {isPreset(radius) ? 'Custom' : `${radius} m`}
              </Text>
            </Pressable>
          </View>
          <View style={mStyles.row}>
            <Pressable style={[mStyles.btn, mStyles.btnCancel]} onPress={onCancel} accessibilityRole="button" accessibilityLabel="Cancel edit">
              <Text style={mStyles.btnCancelTxt}>Cancel</Text>
            </Pressable>
            <Pressable style={[mStyles.btn, mStyles.btnSave]} onPress={save} accessibilityRole="button" accessibilityLabel="Save changes" testID="edit-place-save">
              <Text style={mStyles.btnSaveTxt}>Save</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
      <CustomRadiusModal
        visible={customVisible}
        initial={isPreset(radius) ? 100 : radius}
        onSave={m => { setRadius(m); setCustomVisible(false); }}
        onCancel={() => setCustomVisible(false)}
      />
    </Modal>
  );
}

// ── Confirm-delete modal (replaces Alert.alert, which is a no-op on web) ────

function ConfirmDeleteModal({
  visible, place, onConfirm, onCancel,
}: { visible: boolean; place: SavedPlace | null; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={mStyles.overlay}>
        <View style={mStyles.box} testID="dp-delete-confirm-modal">
          <Text style={mStyles.title}>Delete saved place</Text>
          <Text style={mStyles.hint}>
            Remove &ldquo;{place?.label ?? ''}&rdquo; from your saved places? This cannot be undone.
          </Text>
          <View style={mStyles.row}>
            <Pressable
              style={[mStyles.btn, mStyles.btnCancel]}
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Cancel delete"
              testID="dp-delete-cancel"
            >
              <Text style={mStyles.btnCancelTxt}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[mStyles.btn, mStyles.btnDanger]}
              onPress={onConfirm}
              accessibilityRole="button"
              accessibilityLabel="Confirm delete"
              testID="dp-delete-confirm"
            >
              <Text style={mStyles.btnSaveTxt}>Delete</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Info / error modal (replaces Alert.alert for save failures, which is a
// no-op on react-native-web — users were previously left with no feedback) ──

function InfoModal({
  visible, title, message, onClose,
}: { visible: boolean; title: string; message: string; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={mStyles.overlay}>
        <View style={mStyles.box} testID="dp-info-modal">
          <Text style={mStyles.title}>{title}</Text>
          <Text style={mStyles.hint}>{message}</Text>
          <Pressable
            style={[mStyles.btn, mStyles.btnSave]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            testID="dp-info-close"
          >
            <Text style={mStyles.btnSaveTxt}>OK</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

/** Plain-language reason shown BEFORE the OS/browser location prompt. */
function LocationIntroModal({
  visible, onAllow, onNotNow,
}: { visible: boolean; onAllow: () => void; onNotNow: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onNotNow}>
      <View style={mStyles.overlay}>
        <View style={mStyles.box} testID="dp-location-intro">
          <Text style={mStyles.title}>Show your position on the map?</Text>
          <Text style={mStyles.hint}>
            DHARA will draw a dot where you are, so you can see your starting point and pick a destination
            near you. It stays on this phone — nothing is uploaded, no one is told, and there is no
            background tracking. You can carry on without it.
          </Text>
          <Pressable
            style={[mStyles.btn, mStyles.btnSave]}
            onPress={onAllow}
            accessibilityRole="button"
            testID="dp-location-allow"
          >
            <Text style={mStyles.btnSaveTxt}>Show my position</Text>
          </Pressable>
          <Pressable
            style={[mStyles.btn, mStyles.btnCancel]}
            onPress={onNotNow}
            accessibilityRole="button"
            testID="dp-location-not-now"
          >
            <Text style={mStyles.btnCancelTxt}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export function DestinationPicker({ value, onChange, authToken, testID, apiBase, gpsForegroundEnabled }: Props) {
  const base = apiBase ?? process.env.EXPO_PUBLIC_BACKEND_URL ?? '';

  // ── Stale-closure guard ───────────────────────────────────────────────────
  // All async callbacks (map events, search results, Places debounce) that
  // spread `value` must read the LATEST value, not the one that existed when
  // the callback was last created.  A ref is synchronously updated on every
  // render so it is always current without adding `value` to every dep array
  // (which would not help anyway — React batches synchronous events, but
  // native-map drag callbacks and resolved fetch promises are NOT batched, so
  // they can fire with a stale closure even in React 18).
  const valueRef = useRef<DestinationValue>(value);
  useEffect(() => { valueRef.current = value; });
  // ─────────────────────────────────────────────────────────────────────────

  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customVisible, setCustomVisible] = useState(false);
  const [editTarget, setEditTarget] = useState<SavedPlace | null>(null);
  const hasAuth = !!authToken;

  // Address search (GO1A — real search via OpenStreetMap Nominatim).
  // Batch 2: search only ever runs on an EXPLICIT user action (Search button
  // press, or the keyboard's search/done key) — never automatically while
  // typing. This avoids sending a request per keystroke to the public
  // Nominatim endpoint.
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const searchReqRef = useRef(0);
  // Bug fix: tapping the Search button (or a suggestion row) blurs the
  // TextInput, which scheduled a 150ms-delayed hide. Nominatim's fair-use
  // pacing (up to 1s) plus network latency means the fetch routinely
  // resolves AFTER that 150ms window, so the delayed hide fired and wiped
  // out `showSuggestions(true)` the instant real results arrived — the
  // request succeeded server-side but the dropdown never appeared. This ref
  // is set on `onPressIn` of anything that intentionally blurs the input
  // (Search button, suggestion rows) so the blur-hide skips exactly once.
  const suppressBlurHideRef = useRef(false);
  // Bumped only on an explicit "jump" (search pick / saved place pick) so the
  // map recentres — NOT on every drag, which should stay within the current view.
  const [mapRecenterKey, setMapRecenterKey] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<SavedPlace | null>(null);
  const [errorModal, setErrorModal] = useState<{ title: string; message: string } | null>(null);

  // ── Places (New) debounced autocomplete pilot (default OFF) ────────────
  // Typing debounces (~300ms) into /api/geo/autocomplete, reusing one
  // session token per search session (new token on first keystroke of a
  // fresh search, discarded after a details lookup). Any error — network,
  // 503 (flag off server-side), timeout — fails CLOSED: the dropdown just
  // stays hidden and the pre-existing manual Search button / OSM flow above
  // keeps working completely unaffected.
  const [placesSuggestions, setPlacesSuggestions] = useState<PlacesSuggestion[]>([]);
  const [showPlacesDropdown, setShowPlacesDropdown] = useState(false);
  const [placesLoading, setPlacesLoading] = useState(false);
  const [placesEmpty, setPlacesEmpty] = useState(false);

  // ── Live position (display only, foreground only) ──────────────────────
  const live = useLivePosition();
  const [askLocation, setAskLocation] = useState(false);
  const [followUserKey, setFollowUserKey] = useState(0);
  const livePointRef = useRef(live.point);
  useEffect(() => { livePointRef.current = live.point; });

  // If the user already allowed location earlier, start showing the dot
  // straight away — no prompt, nothing uploaded.
  useEffect(() => { void live.resumeIfAlreadyGranted(); }, [live.resumeIfAlreadyGranted]);

  // Centre on the user the first time a fix arrives, unless a pin is already set.
  const centredOnUserRef = useRef(false);
  useEffect(() => {
    if (centredOnUserRef.current || !live.point) return;
    centredOnUserRef.current = true;
    if (!isFinitePair(valueRef.current.latitude, valueRef.current.longitude)) {
      setFollowUserKey(k => k + 1);
    }
  }, [live.point]);
  const placesSessionTokenRef = useRef<string | null>(null);
  const placesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const placesReqRef = useRef(0);

  useEffect(() => () => { if (placesDebounceRef.current) clearTimeout(placesDebounceRef.current); }, []);

  // Load saved places once on mount (or when auth becomes available)
  useEffect(() => {
    if (!hasAuth) return;
    setLoadingPlaces(true);
    fetchSavedPlaces(base, authToken!)
      .then(setPlaces)
      .catch(() => {})
      .finally(() => setLoadingPlaces(false));
  }, [hasAuth, authToken, base]);

  const submitSearch = useCallback(async () => {
    // Read label from ref so the search always uses the current text even if
    // the callback was created before the most recent label keystroke landed.
    const trimmed = valueRef.current.label.trim();
    // Pressing Enter blurs the field on web; the blur handler would hide the
    // results the moment they arrive, so skip that hide exactly once.
    suppressBlurHideRef.current = true;
    // Drop any in-flight typeahead so a late response cannot pop the old
    // dropdown back over these results.
    if (placesDebounceRef.current) clearTimeout(placesDebounceRef.current);
    placesReqRef.current++;
    setPlacesSuggestions([]);
    setPlacesEmpty(false);
    setPlacesLoading(false);
    setShowSuggestions(true);
    setShowPlacesDropdown(false);
    if (trimmed.length < SEARCH_MIN_CHARS) {
      setSuggestions([]);
      setSearchError(false);
      return;
    }
    const reqId = ++searchReqRef.current;
    setSearching(true);
    setSearchError(false);
    try {
      const results = await fetchAddressSuggestions(base, trimmed);
      if (searchReqRef.current !== reqId) return; // superseded by a newer search
      setSuggestions(results);
      setSearchError(false);
    } catch {
      if (searchReqRef.current !== reqId) return;
      setSuggestions([]);
      setSearchError(true);
    } finally {
      if (searchReqRef.current === reqId) setSearching(false);
    }
  }, [base]);

  const handleLabelChange = useCallback((text: string) => {
    // Use ref so the spread always picks up the current radiusMeters, even if
    // this callback fires before the radius-chip state update has re-rendered.
    onChange({ ...valueRef.current, label: text, savedPlaceId: undefined });
    // Typing alone never triggers the manual search — stale results no longer apply.
    setSuggestions([]);
    setShowSuggestions(false);
    setSearchError(false);

    if (placesDebounceRef.current) clearTimeout(placesDebounceRef.current);
    // N-02: /api/geo/autocomplete now requires an authenticated session.
    // Without one, fail closed exactly like the flag-off path — dropdown
    // stays off, the manual OSM Search button keeps working.
    if (!PLACES_AUTOCOMPLETE_ENABLED || !authToken) return;

    const trimmed = text.trim();
    if (trimmed.length < SEARCH_MIN_CHARS) {
      placesReqRef.current++;          // discard any in-flight lookup
      setPlacesSuggestions([]);
      setPlacesEmpty(false);
      setPlacesLoading(false);
      setShowPlacesDropdown(false);
      return;
    }
    // Show the dropdown immediately with a small spinner, so slow networks
    // never look like a dead search box.
    setPlacesLoading(true);
    setPlacesEmpty(false);
    setShowPlacesDropdown(true);

    placesDebounceRef.current = setTimeout(async () => {
      if (!placesSessionTokenRef.current) {
        placesSessionTokenRef.current = Crypto.randomUUID();
      }
      const token = placesSessionTokenRef.current;
      const reqId = ++placesReqRef.current;
      setPlacesLoading(true);
      try {
        // Bias only when the user has already allowed location.
        const results = await fetchPlacesAutocomplete(base, trimmed, token, authToken, livePointRef.current);
        if (placesReqRef.current !== reqId) return; // superseded by newer keystroke
        setPlacesSuggestions(results);
        setPlacesEmpty(results.length === 0);
        setShowPlacesDropdown(true);
      } catch {
        if (placesReqRef.current !== reqId) return;
        // Nothing usable came back — say so plainly, never a raw error.
        setPlacesSuggestions([]);
        setPlacesEmpty(true);
        setShowPlacesDropdown(true);
      } finally {
        if (placesReqRef.current === reqId) setPlacesLoading(false);
      }
    }, PLACES_DEBOUNCE_MS);
  }, [onChange, base, authToken]);

  const selectPlacesSuggestion = useCallback(async (s: PlacesSuggestion) => {
    const token = placesSessionTokenRef.current;
    setShowPlacesDropdown(false);
    if (!token || !authToken) return;
    setPlacesLoading(true);
    try {
      const details = await fetchPlaceDetails(base, s.place_id, token, s.provider, authToken);
      if (details) {
        // Read ref: the user may have changed radiusMeters after typing started.
        onChange({
          ...valueRef.current,
          label: placesSuggestionLabel(s).slice(0, 120),
          savedPlaceId: undefined,
          latitude: details.latitude,
          longitude: details.longitude,
        });
        setMapRecenterKey(k => k + 1);
      }
    } catch {
      // Fail closed — keep the typed text as-is; manual Search still works.
    } finally {
      setPlacesLoading(false);
      setPlacesSuggestions([]);
      setPlacesEmpty(false);
      placesSessionTokenRef.current = null; // session concluded — fresh token next search
    }
  }, [base, onChange, authToken]);

  const selectSuggestion = useCallback((s: AddressSuggestion) => {
    // Read ref: address suggestions may resolve after a radius chip was tapped.
    onChange({
      ...valueRef.current,
      label: shortAddressLabel(s.label),
      savedPlaceId: undefined,
      latitude: s.latitude,
      longitude: s.longitude,
    });
    setSuggestions([]);
    setShowSuggestions(false);
    setShowPlacesDropdown(false);
    setMapRecenterKey(k => k + 1);
  }, [onChange]);

  const selectPreset = useCallback((m: number) => {
    onChange({ ...valueRef.current, radiusMeters: m });
  }, [onChange]);

  const selectPlace = useCallback((p: SavedPlace) => {
    onChange({
      label: p.label,
      radiusMeters: p.radius_meters,
      savedPlaceId: p.place_id,
      latitude: p.latitude,
      longitude: p.longitude,
    });
    setShowSuggestions(false);
    setMapRecenterKey(k => k + 1);
  }, [onChange]);

  const movePin = useCallback((lat: number, lng: number) => {
    // Read ref: a map drag event fired by the native map tile renderer can
    // arrive between a radius-chip tap and the next React render cycle.
    onChange({ ...valueRef.current, latitude: lat, longitude: lng });
  }, [onChange]);

  const saveCurrentAsPlace = useCallback(async () => {
    const cur = valueRef.current; // snapshot ref at call time
    if (!hasAuth || !cur.label.trim()) return;
    setSaving(true);
    try {
      const created = await createSavedPlace(base, authToken!, {
        label: cur.label.trim().slice(0, 80),
        radius_meters: cur.radiusMeters,
        latitude: cur.latitude ?? undefined,
        longitude: cur.longitude ?? undefined,
      });
      if (created) {
        setPlaces(prev => [created, ...prev]);
        onChange({ ...valueRef.current, savedPlaceId: created.place_id });
      } else {
        setErrorModal({
          title: 'Could not save',
          message: 'You may have reached the 10 saved places limit, or the destination name was not valid.',
        });
      }
    } catch {
      setErrorModal({ title: 'Could not save', message: 'Check your connection and try again.' });
    } finally {
      setSaving(false);
    }
  }, [hasAuth, authToken, base, onChange]);

  const handleEdit = useCallback(async (label: string, radius: number) => {
    if (!editTarget || !authToken) return;
    const updated = await updateSavedPlace(base, authToken, editTarget.place_id, {
      label, radius_meters: radius,
    }).catch(() => null);
    if (updated) {
      setPlaces(prev => prev.map(p => p.place_id === updated.place_id ? updated : p));
      // Read ref so we don't compare against a stale savedPlaceId.
      if (valueRef.current.savedPlaceId === updated.place_id) {
        onChange({
          label: updated.label,
          radiusMeters: updated.radius_meters,
          savedPlaceId: updated.place_id,
          latitude: updated.latitude,
          longitude: updated.longitude,
        });
      }
    }
    setEditTarget(null);
  }, [editTarget, authToken, base, onChange]);

  // Batch 2: Alert.alert is a no-op on react-native-web — delete confirmation
  // now uses an in-app Modal (ConfirmDeleteModal) instead. handleDelete just
  // opens it; confirmDelete performs the actual deletion.
  const handleDelete = useCallback((place: SavedPlace) => {
    setDeleteTarget(place);
  }, []);

  const confirmDelete = useCallback(async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    const ok = await deleteSavedPlace(base, authToken!, target.place_id).catch(() => false);
    if (ok) {
      setPlaces(prev => prev.filter(p => p.place_id !== target.place_id));
      // Read ref: user may have changed selection while the delete request was in-flight.
      if (valueRef.current.savedPlaceId === target.place_id) {
        onChange({ ...valueRef.current, savedPlaceId: undefined });
      }
    } else {
      setErrorModal({ title: 'Could not delete', message: 'Check your connection and try again.' });
    }
  }, [deleteTarget, authToken, base, onChange]);

  const alreadySaved = !!value.savedPlaceId || places.some(
    p => p.label.toLowerCase() === value.label.trim().toLowerCase()
  );

  return (
    <View testID={testID ?? 'destination-picker'}>
      {/* ── Destination search / input ───────────────────────────────── */}
      <Text style={styles.fieldLabel}>Where are you going?</Text>
      <View style={styles.inputRow}>
        <TextInput
          testID="dp-destination-input"
          value={value.label}
          onChangeText={handleLabelChange}
          onFocus={() => {
            setShowSuggestions(suggestions.length > 0 || searchError);
            if (PLACES_AUTOCOMPLETE_ENABLED && placesSuggestions.length > 0) setShowPlacesDropdown(true);
          }}
          onBlur={() => { setTimeout(() => {
            if (suppressBlurHideRef.current) { suppressBlurHideRef.current = false; return; }
            setShowSuggestions(false);
            setShowPlacesDropdown(false);
          }, 150); }}
          onSubmitEditing={submitSearch}
          submitBehavior="submit"
          placeholder="Search an address, or type a label (e.g. bus stop)…"
          placeholderTextColor={c.muted}
          style={[styles.input, { flex: 1 }]}
          returnKeyType="search"
          maxLength={120}
          accessibilityLabel="Destination address or name"
          accessibilityHint="Type an address or label, then tap Search to look it up"
        />
        {value.label.length > 0 && (
          <Pressable
            onPress={() => {
              handleLabelChange('');
              if (placesDebounceRef.current) clearTimeout(placesDebounceRef.current);
              placesReqRef.current++;      // discard any in-flight lookup
              searchReqRef.current++;
              setPlacesSuggestions([]);
              setPlacesEmpty(false);
              setPlacesLoading(false);
              setShowPlacesDropdown(false);
              setSuggestions([]);
              setShowSuggestions(false);
              setSearching(false);
            }}
            onPressIn={() => { suppressBlurHideRef.current = true; }}
            style={styles.searchBtn}
            accessibilityRole="button"
            accessibilityLabel="Clear the destination field"
            testID="dp-clear-input"
          >
            <Ionicons name="close" size={18} color={c.muted} />
          </Pressable>
        )}
        {/* The manual search still runs on this explicit tap (or the keyboard's
            Search key); the debounced dropdown below never disables it. */}
        <Pressable
          onPress={submitSearch}
          onPressIn={() => { suppressBlurHideRef.current = true; }}
          disabled={value.label.trim().length < SEARCH_MIN_CHARS}
          style={[styles.searchBtn, value.label.trim().length < SEARCH_MIN_CHARS && styles.searchBtnDisabled]}
          accessibilityRole="button"
          accessibilityLabel="Search for this address"
          testID="dp-search-button"
        >
          {(searching || placesLoading)
            ? <ActivityIndicator size="small" color={c.navy} />
            : <Ionicons name="search" size={18} color={c.navy} />
          }
        </Pressable>
        {hasAuth && value.label.trim().length > 0 && !alreadySaved && !searching && (
          <Pressable
            onPress={saveCurrentAsPlace}
            disabled={saving}
            style={styles.saveChip}
            accessibilityRole="button"
            accessibilityLabel="Save this destination for future use"
            testID="dp-save-place"
          >
            {saving
              ? <ActivityIndicator size="small" color={c.navy} />
              : <Ionicons name="bookmark-outline" size={18} color={c.navy} />
            }
          </Pressable>
        )}
      </View>

      {/* ── Address search suggestions (OpenStreetMap Nominatim) ─────────── */}
      {showSuggestions && (suggestions.length > 0 || searchError) && (
        <View style={styles.suggestionsBox} testID="dp-suggestions">
          {searchError ? (
            <Text style={styles.suggestionEmptyTxt}>Address search is temporarily unavailable. Try again shortly.</Text>
          ) : (
            suggestions.map((s, i) => (
              <Pressable
                key={`${s.latitude},${s.longitude},${i}`}
                style={styles.suggestionRow}
                onPressIn={() => { suppressBlurHideRef.current = true; }}
                onPress={() => selectSuggestion(s)}
                accessibilityRole="button"
                accessibilityLabel={`Select address ${s.label}`}
                testID={`dp-suggestion-${i}`}
              >
                <Ionicons name="location-outline" size={16} color={c.muted} />
                <Text style={styles.suggestionTxt} numberOfLines={2}>{s.label}</Text>
              </Pressable>
            ))
          )}
        </View>
      )}

      {/* ── Places (New) debounced autocomplete dropdown (pilot, default OFF) ──
          Purely additive: appears only while PLACES_AUTOCOMPLETE_ENABLED and a
          debounced lookup has suggestions. Never shown together with the
          manual-search box above (typing always clears that one first). */}
      {PLACES_AUTOCOMPLETE_ENABLED && showPlacesDropdown && (
        <View style={styles.suggestionsBox} testID="dp-places-suggestions">
          {placesLoading && placesSuggestions.length === 0 && (
            <View style={styles.suggestionRow} testID="dp-places-loading">
              <ActivityIndicator size="small" color={c.muted} />
              <Text style={styles.suggestionTxt}>Looking for places…</Text>
            </View>
          )}
          {!placesLoading && placesEmpty && placesSuggestions.length === 0 && (
            <Text style={styles.suggestionEmptyTxt} testID="dp-places-empty">
              No places found. Try a different spelling, or type your own label.
            </Text>
          )}
          {placesSuggestions.map((s, i) => (
            <Pressable
              key={`${s.place_id}-${i}`}
              style={styles.suggestionRow}
              onPressIn={() => { suppressBlurHideRef.current = true; }}
              onPress={() => selectPlacesSuggestion(s)}
              accessibilityRole="button"
              accessibilityLabel={`Select address ${s.main_text}${s.secondary_text ? ', ' + s.secondary_text : ''}`}
              testID={`dp-places-suggestion-${i}`}
            >
              <Ionicons name="location-outline" size={16} color={c.muted} />
              <View style={{ flex: 1 }}>
                <Text style={styles.suggestionTxt} numberOfLines={1}>{s.main_text}</Text>
                {!!s.secondary_text && (
                  <Text style={styles.suggestionSecondaryTxt} numberOfLines={1}>{s.secondary_text}</Text>
                )}
              </View>
            </Pressable>
          ))}
        </View>
      )}

      {/* ── Live position controls (display only, foreground only) ──────── */}
      <View style={styles.liveRow}>
        <Pressable
          style={styles.liveBtn}
          onPress={() => {
            if (live.status === 'granted' && live.point) { setFollowUserKey(k => k + 1); return; }
            if (live.status === 'blocked') { live.openSettings(); return; }
            setAskLocation(true);   // explain first, then ask
          }}
          accessibilityRole="button"
          accessibilityLabel="Show my current position on this map"
          testID="dp-use-my-location"
        >
          {live.status === 'asking'
            ? <ActivityIndicator size="small" color={c.navy} />
            : <Ionicons name="locate" size={16} color={c.navy} />}
          <Text style={styles.liveBtnTxt}>
            {live.status === 'granted' ? 'Recenter on me' : 'Use my location'}
          </Text>
        </Pressable>
      </View>
      {live.status === 'granted' && (
        <Text style={styles.liveNote} testID="dp-live-note">
          Your live position is shown on this map only. Nothing is uploaded or tracked.
        </Text>
      )}
      {(live.status === 'denied' || live.status === 'blocked' || live.status === 'unavailable') && (
        <Text style={styles.liveNote} testID="dp-live-note">
          {live.status === 'unavailable'
            ? 'Location is unavailable on this device. Search for a place or drag the pin instead.'
            : live.status === 'blocked'
              ? 'Location is switched off for DHARA. You can turn it on in Settings, or just search or drag the pin.'
              : 'No problem — search for a place or drag the pin instead.'}
        </Text>
      )}

      {/* ── Map pin + live position dot ─────────────────────────────────── */}
      <DestinationMapPicker
        testID="dp-map-picker"
        latitude={value.latitude ?? null}
        longitude={value.longitude ?? null}
        radiusMeters={value.radiusMeters}
        onPositionChange={movePin}
        recenterKey={mapRecenterKey}
        userLocation={live.point}
        followUserKey={followUserKey}
      />

      {/* ── Saved places quick-select ─────────────────────────────────── */}
      {hasAuth && (
        <View style={styles.savedSection}>
          <View style={styles.savedHeader}>
            <Ionicons name="bookmark" size={13} color={c.muted} />
            <Text style={styles.savedTitle}>Saved places</Text>
            {loadingPlaces && <ActivityIndicator size="small" color={c.muted} style={{ marginLeft: 6 }} />}
          </View>
          {places.length === 0 && !loadingPlaces && (
            <Text style={styles.emptyTxt}>None yet — type a destination and tap the bookmark to save.</Text>
          )}
          {places.map(p => (
            <View key={p.place_id} style={[styles.savedRow, value.savedPlaceId === p.place_id && styles.savedRowSelected]}>
              <Pressable
                style={styles.savedMain}
                onPress={() => selectPlace(p)}
                accessibilityRole="button"
                accessibilityLabel={`Select ${p.label}, ${p.radius_label} arrival area`}
                testID={`dp-saved-${p.place_id}`}
              >
                <Ionicons
                  name={value.savedPlaceId === p.place_id ? 'location' : 'location-outline'}
                  size={16}
                  color={value.savedPlaceId === p.place_id ? c.navy : c.muted}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.savedLabel}>{p.label}</Text>
                  <Text style={styles.savedMeta}>{p.radius_label} planned area</Text>
                </View>
              </Pressable>
              <Pressable
                onPress={() => setEditTarget(p)}
                style={styles.iconBtn}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${p.label}`}
                testID={`dp-edit-${p.place_id}`}
              >
                <Ionicons name="pencil-outline" size={16} color={c.muted} />
              </Pressable>
              <Pressable
                onPress={() => handleDelete(p)}
                style={styles.iconBtn}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${p.label}`}
                testID={`dp-delete-${p.place_id}`}
              >
                <Ionicons name="trash-outline" size={16} color={c.muted} />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {/* ── Radius selection ──────────────────────────────────────────── */}
      <Text style={styles.fieldLabel}>Planned arrival area</Text>
      <View style={styles.radiusRow}>
        {RADIUS_PRESETS.map(p => (
          <Pressable
            key={p.meters}
            style={[styles.radiusChip, value.radiusMeters === p.meters && styles.radiusChipActive]}
            onPress={() => selectPreset(p.meters)}
            accessibilityRole="radio"
            accessibilityState={{ checked: value.radiusMeters === p.meters }}
            aria-checked={value.radiusMeters === p.meters}
            accessibilityLabel={`${p.label} arrival area`}
            testID={`dp-radius-${p.meters}`}
          >
            <Text style={[styles.radiusTxt, value.radiusMeters === p.meters && styles.radiusTxtActive]}>
              {p.label}
            </Text>
          </Pressable>
        ))}
        <Pressable
          style={[styles.radiusChip, !isPreset(value.radiusMeters) && styles.radiusChipActive]}
          onPress={() => setCustomVisible(true)}
          accessibilityRole="button"
          accessibilityLabel={isPreset(value.radiusMeters) ? 'Set custom radius' : `Custom: ${value.radiusMeters} m`}
          testID="dp-radius-custom"
        >
          <Text style={[styles.radiusTxt, !isPreset(value.radiusMeters) && styles.radiusTxtActive]}>
            {isPreset(value.radiusMeters) ? 'Custom' : `${value.radiusMeters} m`}
          </Text>
        </Pressable>
      </View>

      {/* ── Mandatory limitation disclosure ─────────────────────────────── */}
      <View style={styles.disclosureBox} testID="dp-disclosure">
        <Ionicons name="information-circle-outline" size={15} color={c.muted} />
        <Text style={styles.disclosureTxt}>
          {gpsForegroundEnabled
            // GPS feature is on for this journey: say so accurately — foreground-only,
            // not yet running, never background, never an automatic alert.
            ? `Planned arrival area only. Radius selection does not activate geofence monitoring. If you start this journey, DHARA will share your location only while this app is open on your screen — never in the background, and no one is alerted automatically. ${ADDRESS_SOURCE_DISCLOSURE}`
            // Default (feature off): no GPS capability exists for this journey at all.
            : `Planned arrival area only. Radius selection does not activate geofence monitoring or any location tracking. ${ADDRESS_SOURCE_DISCLOSURE}`}
        </Text>
      </View>

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      <CustomRadiusModal
        visible={customVisible}
        initial={isPreset(value.radiusMeters) ? 100 : value.radiusMeters}
        onSave={m => { onChange({ ...valueRef.current, radiusMeters: m }); setCustomVisible(false); }}
        onCancel={() => setCustomVisible(false)}
      />
      <ConfirmDeleteModal
        visible={!!deleteTarget}
        place={deleteTarget}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
      <InfoModal
        visible={!!errorModal}
        title={errorModal?.title ?? ''}
        message={errorModal?.message ?? ''}
        onClose={() => setErrorModal(null)}
      />
      <EditPlaceModal
        visible={!!editTarget}
        place={editTarget}
        onSave={handleEdit}
        onCancel={() => setEditTarget(null)}
      />
      {/* Plain-language reason shown BEFORE the OS/browser location prompt. */}
      <LocationIntroModal
        visible={askLocation}
        onAllow={() => { setAskLocation(false); void live.request(); }}
        onNotNow={() => setAskLocation(false)}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  fieldLabel: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.ink, marginBottom: 8, marginTop: 4 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  input: {
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
    fontFamily: theme.fonts.body, fontSize: 15, color: c.ink,
    // flex:1 alone can overflow on web (intrinsic min-content width), which
    // pushed the bookmark button off a 375px screen.
    minWidth: 0, flexShrink: 1,
  },
  saveChip: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: c.navySoft,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.navy,
  },
  searchBtn: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: c.navySoft,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.navy,
  },
  searchBtnDisabled: { opacity: 0.4 },
  searchSpinner: { width: 24, alignItems: 'center', justifyContent: 'center' },
  suggestionsBox: {
    borderWidth: 1, borderColor: c.lines, borderRadius: 12, backgroundColor: c.surface,
    marginTop: -6, marginBottom: 12, overflow: 'hidden',
    // Keep the dropdown above the map on web and native.
    zIndex: 20, elevation: 6,
  },
  liveRow: { flexDirection: 'row', marginBottom: 8 },
  liveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 14,
    borderRadius: 999, borderWidth: 1, borderColor: c.navy, backgroundColor: c.surface,
  },
  liveBtnTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.navy },
  liveNote: { fontFamily: theme.fonts.body, fontSize: 11, color: c.muted, lineHeight: 16, marginBottom: 8 },
  suggestionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.lines,
  },
  suggestionTxt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 13, color: c.ink, lineHeight: 18 },
  suggestionSecondaryTxt: { fontFamily: theme.fonts.body, fontSize: 11, color: c.muted, marginTop: 1 },
  suggestionEmptyTxt: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, padding: 12, fontStyle: 'italic' },
  savedSection: { marginBottom: 16 },
  savedHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  savedTitle: { fontFamily: theme.fonts.bodySemiBold, fontSize: 12, color: c.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  emptyTxt: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, fontStyle: 'italic', paddingVertical: 4 },
  savedRow: {
    flexDirection: 'row', alignItems: 'center', borderRadius: 12,
    borderWidth: 1.5, borderColor: c.lines, backgroundColor: c.surface,
    marginBottom: 6, overflow: 'hidden',
  },
  savedRowSelected: { borderColor: c.navy, backgroundColor: c.navySoft },
  savedMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  savedLabel: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.ink },
  savedMeta: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, marginTop: 1 },
  iconBtn: { width: 40, height: 48, alignItems: 'center', justifyContent: 'center' },
  radiusRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 10 },
  radiusChip: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20,
    borderWidth: 1.5, borderColor: c.lines, backgroundColor: c.surface, minWidth: 68, alignItems: 'center',
  },
  radiusChipActive: { borderColor: c.navy, backgroundColor: c.navySoft },
  radiusTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 14, color: c.muted },
  radiusTxtActive: { color: c.navy },
  disclosureBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 7,
    backgroundColor: c.surface, borderRadius: 10, borderWidth: 1,
    borderColor: c.lines, padding: 10, marginTop: 4,
  },
  disclosureTxt: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, flex: 1, lineHeight: 18 },
});

const mStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  box: { backgroundColor: '#fff', borderRadius: 18, padding: 24, width: '100%', maxWidth: 380, gap: 12 },
  title: { fontFamily: theme.fonts.displayBold, fontSize: 18, color: c.ink },
  hint: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted },
  input: {
    borderWidth: 1, borderColor: c.lines, borderRadius: 10, padding: 12,
    fontFamily: theme.fonts.body, fontSize: 16, color: c.ink,
  },
  err: { fontFamily: theme.fonts.body, fontSize: 13, color: c.error },
  row: { flexDirection: 'row', gap: 10, marginTop: 4 },
  btn: { flex: 1, borderRadius: 10, padding: 12, alignItems: 'center' },
  btnCancel: { borderWidth: 1, borderColor: c.lines },
  btnSave: { backgroundColor: c.navy },
  btnDanger: { backgroundColor: c.emergencyRed },
  btnCancelTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.muted },
  btnSaveTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: '#fff' },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, borderWidth: 1.5, borderColor: c.lines, backgroundColor: c.surface },
  chipActive: { borderColor: c.navy, backgroundColor: c.navySoft },
  chipTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.muted },
  chipActiveTxt: { color: c.navy },
});
