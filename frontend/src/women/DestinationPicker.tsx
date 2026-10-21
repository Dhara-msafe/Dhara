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
 * - Address search only runs when the user types/searches — it never
 *   reads device location and is independent of any GPS/tracking flag.
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
  ActivityIndicator, Alert, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { DestinationMapPicker } from './DestinationMapPicker';

const c = theme.colors;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DestinationValue {
  label: string;
  radiusMeters: number;
  savedPlaceId?: string;
  /**
   * Set by: an address-search selection, dragging/tapping the map pin, or
   * selecting a saved place that already has coordinates. Never populated
   * from device GPS — this component never reads live location.
   */
  latitude?: number | null;
  longitude?: number | null;
}

export interface SavedPlace {
  place_id: string;
  label: string;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number;
  radius_label: string;
}

export interface AddressSuggestion {
  label: string;
  latitude: number;
  longitude: number;
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
const SEARCH_DEBOUNCE_MS = 450;

// ── Address search (OpenStreetMap Nominatim, proxied via our backend) ───────

async function fetchAddressSuggestions(base: string, query: string): Promise<AddressSuggestion[]> {
  const r = await fetch(`${base}/api/geocode/search?q=${encodeURIComponent(query)}&limit=6`);
  if (!r.ok) return [];
  const j = await r.json();
  return j.suggestions ?? [];
}

/** Shorter, cleaner label for a selected address (first 2 comma segments). */
function shortAddressLabel(full: string): string {
  const parts = full.split(',').map(s => s.trim()).filter(Boolean);
  return parts.slice(0, 2).join(', ') || full;
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

// ── Main component ────────────────────────────────────────────────────────────

export function DestinationPicker({ value, onChange, authToken, testID, apiBase, gpsForegroundEnabled }: Props) {
  const base = apiBase ?? process.env.EXPO_PUBLIC_BACKEND_URL ?? '';
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customVisible, setCustomVisible] = useState(false);
  const [editTarget, setEditTarget] = useState<SavedPlace | null>(null);
  const hasAuth = !!authToken;

  // Address search (GO1A — real search via OpenStreetMap Nominatim)
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped only on an explicit "jump" (search pick / saved place pick) so the
  // map recentres — NOT on every drag, which should stay within the current view.
  const [mapRecenterKey, setMapRecenterKey] = useState(0);

  // Load saved places once on mount (or when auth becomes available)
  useEffect(() => {
    if (!hasAuth) return;
    setLoadingPlaces(true);
    fetchSavedPlaces(base, authToken!)
      .then(setPlaces)
      .catch(() => {})
      .finally(() => setLoadingPlaces(false));
  }, [hasAuth, authToken, base]);

  // Clear any pending debounce timer on unmount
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const runSearch = useCallback((query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < SEARCH_MIN_CHARS) {
      setSuggestions([]);
      setSearching(false);
      setSearchError(false);
      return;
    }
    setSearching(true);
    setSearchError(false);
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await fetchAddressSuggestions(base, trimmed);
        setSuggestions(results);
        setSearchError(false);
      } catch {
        setSuggestions([]);
        setSearchError(true);
      } finally {
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
  }, [base]);

  const handleLabelChange = useCallback((text: string) => {
    onChange({ ...value, label: text, savedPlaceId: undefined });
    setShowSuggestions(true);
    runSearch(text);
  }, [value, onChange, runSearch]);

  const selectSuggestion = useCallback((s: AddressSuggestion) => {
    onChange({
      ...value,
      label: shortAddressLabel(s.label),
      savedPlaceId: undefined,
      latitude: s.latitude,
      longitude: s.longitude,
    });
    setSuggestions([]);
    setShowSuggestions(false);
    setMapRecenterKey(k => k + 1);
  }, [value, onChange]);

  const selectPreset = useCallback((m: number) => {
    onChange({ ...value, radiusMeters: m });
  }, [value, onChange]);

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
    onChange({ ...value, latitude: lat, longitude: lng });
  }, [value, onChange]);

  const saveCurrentAsPlace = useCallback(async () => {
    if (!hasAuth || !value.label.trim()) return;
    setSaving(true);
    try {
      const created = await createSavedPlace(base, authToken!, {
        label: value.label.trim().slice(0, 80),
        radius_meters: value.radiusMeters,
        latitude: value.latitude ?? undefined,
        longitude: value.longitude ?? undefined,
      });
      if (created) {
        setPlaces(prev => [created, ...prev]);
        onChange({ ...value, savedPlaceId: created.place_id });
      } else {
        Alert.alert('Could not save', 'You may have reached the 10 saved places limit, or the destination name was not valid.');
      }
    } catch {
      Alert.alert('Could not save', 'Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }, [hasAuth, authToken, base, value, onChange]);

  const handleEdit = useCallback(async (label: string, radius: number) => {
    if (!editTarget || !authToken) return;
    const updated = await updateSavedPlace(base, authToken, editTarget.place_id, {
      label, radius_meters: radius,
    }).catch(() => null);
    if (updated) {
      setPlaces(prev => prev.map(p => p.place_id === updated.place_id ? updated : p));
      // If this place is selected, update the picker value too
      if (value.savedPlaceId === updated.place_id) {
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
  }, [editTarget, authToken, base, value, onChange]);

  const handleDelete = useCallback((place: SavedPlace) => {
    Alert.alert(
      'Delete saved place',
      `Remove "${place.label}" from your saved places?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const ok = await deleteSavedPlace(base, authToken!, place.place_id).catch(() => false);
            if (ok) {
              setPlaces(prev => prev.filter(p => p.place_id !== place.place_id));
              if (value.savedPlaceId === place.place_id) {
                onChange({ ...value, savedPlaceId: undefined });
              }
            }
          },
        },
      ],
    );
  }, [authToken, base, value, onChange]);

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
          onFocus={() => setShowSuggestions(suggestions.length > 0 || value.label.trim().length >= SEARCH_MIN_CHARS)}
          onBlur={() => { setTimeout(() => setShowSuggestions(false), 150); }}
          placeholder="Search an address, or type a label (e.g. bus stop)…"
          placeholderTextColor={c.muted}
          style={[styles.input, { flex: 1 }]}
          returnKeyType="done"
          maxLength={120}
          accessibilityLabel="Destination address or name"
          accessibilityHint="Search for an address or type where you are going"
        />
        {searching && <ActivityIndicator size="small" color={c.muted} style={styles.searchSpinner} />}
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

      {/* ── Map pin (GO1A pilot — web: OSM/Leaflet; native: placeholder) ── */}
      <DestinationMapPicker
        testID="dp-map-picker"
        latitude={value.latitude ?? null}
        longitude={value.longitude ?? null}
        radiusMeters={value.radiusMeters}
        onPositionChange={movePin}
        recenterKey={mapRecenterKey}
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
            ? 'Planned arrival area only. Radius selection does not activate geofence monitoring. If you start this journey, DHARA will share your location only while this app is open on your screen — never in the background, and no one is alerted automatically. Address suggestions come from OpenStreetMap search and are only looked up when you type — never from your device location.'
            // Default (feature off): no GPS capability exists for this journey at all.
            : 'Planned arrival area only. Radius selection does not activate geofence monitoring or any location tracking. Address suggestions come from OpenStreetMap search and are only looked up when you type — never from your device location.'}
        </Text>
      </View>

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      <CustomRadiusModal
        visible={customVisible}
        initial={isPreset(value.radiusMeters) ? 100 : value.radiusMeters}
        onSave={m => { onChange({ ...value, radiusMeters: m }); setCustomVisible(false); }}
        onCancel={() => setCustomVisible(false)}
      />
      <EditPlaceModal
        visible={!!editTarget}
        place={editTarget}
        onSave={handleEdit}
        onCancel={() => setEditTarget(null)}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  fieldLabel: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.ink, marginBottom: 8, marginTop: 4 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  input: {
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.lines,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
    fontFamily: theme.fonts.body, fontSize: 15, color: c.ink,
  },
  saveChip: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: c.navySoft,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.navy,
  },
  searchSpinner: { width: 24, alignItems: 'center', justifyContent: 'center' },
  suggestionsBox: {
    borderWidth: 1, borderColor: c.lines, borderRadius: 12, backgroundColor: c.surface,
    marginTop: -6, marginBottom: 12, overflow: 'hidden',
  },
  suggestionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.lines,
  },
  suggestionTxt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 13, color: c.ink, lineHeight: 18 },
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
  btnCancelTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: c.muted },
  btnSaveTxt: { fontFamily: theme.fonts.bodyBold, fontSize: 14, color: '#fff' },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, borderWidth: 1.5, borderColor: c.lines, backgroundColor: c.surface },
  chipActive: { borderColor: c.navy, backgroundColor: c.navySoft },
  chipTxt: { fontFamily: theme.fonts.bodySemiBold, fontSize: 13, color: c.muted },
  chipActiveTxt: { color: c.navy },
});
