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
import { ScreenHeader } from '@/src/components/dhara/ScreenHeader';
import { DestinationMapPicker } from '@/src/women/DestinationMapPicker';
import { useAuth } from '@/src/auth';
import { useHeadOutWizard } from '@/src/women/headOutWizardStore';
import { getRecentDestinations, recordRecentDestination, type RecentDestination } from '@/src/women/headOutRecents';
import type { DestinationValue } from '@/src/women/DestinationPicker';

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
async function fetchPlacesAutocomplete(base: string, input: string, sessionToken: string): Promise<PlacesSuggestionRow[]> {
  const r = await fetch(
    `${base}/api/geo/autocomplete?input=${encodeURIComponent(input)}&session_token=${encodeURIComponent(sessionToken)}&limit=5`
  );
  if (!r.ok) throw new Error(`places_autocomplete_${r.status}`);
  const j = await r.json();
  const rows: { place_id: string; main_text: string; secondary_text: string; provider: string }[] = j.suggestions ?? [];
  return rows.map(row => ({
    kind: 'places' as const,
    place_id: row.place_id,
    label: row.secondary_text ? `${row.main_text}, ${row.secondary_text}` : row.main_text,
    provider: row.provider,
  }));
}

/** Resolves a Places row's actual coordinates. Only ever called once, right
 * when the user taps the suggestion — see PlacesSuggestionRow's doc comment
 * for why. Returns null on any failure so the caller can show a plain
 * "couldn't load that address" message instead of silently doing nothing. */
async function fetchPlaceDetails(
  base: string, placeId: string, sessionToken: string, provider: string,
): Promise<{ label: string; latitude: number; longitude: number } | null> {
  try {
    const r = await fetch(
      `${base}/api/geo/details?place_id=${encodeURIComponent(placeId)}&session_token=${encodeURIComponent(sessionToken)}&provider=${encodeURIComponent(provider)}`
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
): Promise<UnifiedSuggestion[]> {
  if (!sessionTokenRef.current) sessionTokenRef.current = Crypto.randomUUID();
  try {
    const placesResults = await fetchPlacesAutocomplete(base, query, sessionTokenRef.current);
    if (placesResults.length > 0) return placesResults;
  } catch {
    // Pilot off (503), misconfigured, or Google/network error — fall through to OSM.
  }
  return fetchOsmSuggestions(base, query);
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
  const [tab, setTab] = useState<Tab>('saved');
  // Bumped only on an explicit "jump" (saved place / recent / address pick)
  // so the map recentres — not on every drag, which should stay in view.
  const [mapRecenterKey, setMapRecenterKey] = useState(0);

  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [recents, setRecents] = useState<RecentDestination[]>([]);

  const [addressSuggestions, setAddressSuggestions] = useState<UnifiedSuggestion[]>([]);
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

  useEffect(() => {
    if (!authToken) return;
    setLoadingSaved(true);
    fetchSavedPlaces(base, authToken).then(setSavedPlaces).finally(() => setLoadingSaved(false));
  }, [authToken, base]);

  useEffect(() => { getRecentDestinations().then(setRecents); }, []);

  useEffect(() => () => { if (addressDebounceRef.current) clearTimeout(addressDebounceRef.current); }, []);

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
      const results = await searchAddressesLayered(base, trimmed, placesSessionTokenRef);
      if (addressReqRef.current !== reqId) return; // superseded by a newer keystroke
      setAddressSuggestions(results);
      setShowAddressDropdown(results.length > 0);
      setAddressSearching(false);
    }, ADDRESS_SEARCH_DEBOUNCE_MS);
  }, [base]);

  const selectSavedPlace = useCallback((p: SavedPlace) => {
    coordsFromSelectionRef.current = true;
    setValue({ label: p.label, radiusMeters: p.radius_meters, savedPlaceId: p.place_id, latitude: p.latitude, longitude: p.longitude });
    setShowAddressDropdown(false);
    setMapRecenterKey(k => k + 1);
  }, []);

  const selectRecent = useCallback((r: RecentDestination) => {
    coordsFromSelectionRef.current = true;
    setValue({ label: r.label, radiusMeters: r.radiusMeters, latitude: r.latitude ?? null, longitude: r.longitude ?? null, savedPlaceId: undefined });
    setShowAddressDropdown(false);
    setMapRecenterKey(k => k + 1);
  }, []);

  const selectAddressSuggestion = useCallback(async (s: UnifiedSuggestion) => {
    if (s.kind === 'coords') {
      coordsFromSelectionRef.current = true;
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
    if (!token) return;
    setResolvingPlace(true);
    const details = await fetchPlaceDetails(base, s.place_id, token, s.provider);
    setResolvingPlace(false);
    placesSessionTokenRef.current = null; // session concluded — fresh token next search
    if (!details) return; // fails closed — typed text stays exactly as the user left it
    coordsFromSelectionRef.current = true;
    setValue(v => ({ label: shortAddressLabel(details.label), radiusMeters: v.radiusMeters, savedPlaceId: undefined, latitude: details.latitude, longitude: details.longitude }));
    setAddressSuggestions([]);
    setMapRecenterKey(k => k + 1);
  }, [base]);

  const movePin = useCallback((lat: number, lng: number) => {
    // A manual pin drop/drag is deliberately NOT a "selection pair" — see
    // coordsFromSelectionRef and onChangeText's comment for why typing a
    // label afterward is allowed to keep these coordinates.
    coordsFromSelectionRef.current = false;
    setValue(v => ({ ...v, latitude: lat, longitude: lng }));
  }, []);

  const useAsCustom = useCallback(() => {
    // Explicitly commit to "my own typed text", clearing any saved-place link
    // and any coordinates picked earlier (e.g. from a different saved place)
    // so this reads unambiguously as a fresh, unlinked custom destination.
    coordsFromSelectionRef.current = false;
    setValue(v => ({ label: v.label, radiusMeters: v.radiusMeters, savedPlaceId: undefined, latitude: null, longitude: null }));
  }, []);

  const canContinue = value.label.trim().length > 0;

  const handleNext = useCallback(async () => {
    const final: DestinationValue = { ...value, label: value.label.trim() };
    if (!final.label) return;
    setDraft(final);
    await recordRecentDestination(final);
    router.push('/women/head-out/radius');
  }, [value, setDraft, router]);

  return (
    <View style={styles.root}>
      <ScreenHeader title="Head Out" subtitle="Step 1 of 3 — Where are you going?" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 110 }]} keyboardShouldPersistTaps="handled">

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
            {addressSuggestions.map((s, i) => (
              <Pressable
                key={s.kind === 'coords' ? `coords-${s.latitude}-${s.longitude}-${i}` : `places-${s.place_id}`}
                testID={`headout-address-suggestion-${i}`}
                style={styles.suggestionRow}
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
              style={[styles.tab, tab === t.key && styles.tabActive]}
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
                style={[styles.placeRow, value.savedPlaceId === p.place_id && styles.placeRowActive]}
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
              style={styles.customRow}
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
                style={styles.placeRow}
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
        <DestinationMapPicker
          testID="headout-dest-map"
          latitude={value.latitude ?? null}
          longitude={value.longitude ?? null}
          radiusMeters={value.radiusMeters}
          onPositionChange={movePin}
          recenterKey={mapRecenterKey}
        />
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
        <Pressable
          testID="headout-dest-next"
          style={[styles.nextBtn, !canContinue && styles.nextBtnDisabled]}
          disabled={!canContinue}
          onPress={handleNext}
          accessibilityRole="button"
          accessibilityLabel="Next — set arrival radius"
        >
          <Text style={styles.nextBtnTxt}>Next</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  content: { padding: 20, gap: 4 },
  fieldLabel: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.ink, marginBottom: 8, marginTop: 14 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
  },
  searchInput: { flex: 1, fontFamily: theme.fonts.body, fontSize: 15, color: c.ink },
  suggestionsBox: {
    borderWidth: 1, borderColor: c.lines, borderRadius: 12, backgroundColor: c.surface,
    marginTop: 6, overflow: 'hidden',
  },
  suggestionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.lines,
  },
  suggestionTxt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 13, color: c.ink, lineHeight: 18 },
  tabRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines },
  tabActive: { backgroundColor: c.navySoft, borderColor: c.navy },
  tabTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.muted },
  tabTxtActive: { color: c.navy },
  listSection: { marginTop: 14, gap: 8 },
  emptyTxt: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, fontStyle: 'italic', paddingVertical: 6 },
  placeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines,
    borderRadius: 12, padding: 12,
  },
  placeRowActive: { borderColor: c.navy, backgroundColor: c.navySoft },
  placeIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: c.navySoft, alignItems: 'center', justifyContent: 'center' },
  placeLabel: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.ink, flex: 1 },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  customTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 14, color: c.darkGold },
  mapHint: { fontFamily: theme.fonts.body, fontSize: 13, color: c.muted, marginTop: 14, fontStyle: 'italic' },
  footer: {
    paddingHorizontal: 20, paddingTop: 12, backgroundColor: c.background,
    borderTopWidth: 1, borderTopColor: c.lines,
  },
  nextBtn: { backgroundColor: c.navy, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  nextBtnDisabled: { opacity: 0.4 },
  nextBtnTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 16, color: '#fff' },
});