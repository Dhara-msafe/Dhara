/**
 * DestinationMapPicker — native (iOS/Android) implementation.
 *
 * Replaces the pilot placeholder. Renders Google Maps (Android) /
 * Apple Maps (iOS) with a single draggable destination pin and a radius
 * circle labelled as the PLANNED ARRIVAL AREA — not active geofencing.
 *
 * Privacy contract (enforced in this file):
 *  • showsUserLocation is NEVER enabled → no GPS permission is requested.
 *  • followsUserLocation / showsMyLocationButton are both false.
 *  • The starting centre uses parent-supplied coordinates (if valid) or a
 *    clearly-labelled generic demo point (New Delhi). Device GPS is never
 *    read here.
 *
 * Metro platform-extension resolution:
 *  iOS/Android → this file
 *  Web        → DestinationMapPicker.web.tsx (Leaflet/OpenStreetMap)
 *
 * Key wiring: EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is consumed by app.config.js
 * and injected by expo-modules-core as com.google.android.geo.API_KEY.
 * This file never reads or prints the key.
 *
 * Loop-prevention contract:
 *  recenterKey changes → sync markerCoord from parent props + animateToRegion
 *  parent lat/lng change without recenterKey change → echoed back from our
 *    own onPositionChange; internal state is already correct, no update.
 *  User tap/drag → update markerCoord + fire onPositionChange once.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import type { Region } from 'react-native-maps';
import { theme } from '@/src/theme';
import { isValidCoord, isValidRadius } from '@/src/utils/mapValidation';

const c = theme.colors;

// Generic demo centre (New Delhi). Used only until the parent supplies valid
// coordinates. Never derived from device GPS or any geocoding API.
const DEMO_LAT = 28.6139;
const DEMO_LNG = 77.2090;

// Degrees of lat/lng span visible around the pin on initial load (≈ 1.3 km).
// Matches the approximate zoom-15 view in the web Leaflet picker.
const DELTA = 0.012;

// ── Props ─────────────────────────────────────────────────────────────────────

export interface Props {
  latitude: number | null;
  longitude: number | null;
  /** Current arrival-radius in metres; controls the circle, not the pin. */
  radiusMeters: number;
  /** Called when the user taps or drags to a new pin position. */
  onPositionChange: (lat: number, lng: number) => void;
  /**
   * Change this value to force the map to re-centre (e.g. a different saved
   * place was loaded from the parent). Changing lat/lng without changing this
   * key does NOT re-centre — those updates are echoed back from our own
   * onPositionChange callback and must be ignored to prevent loops.
   */
  recenterKey?: string | number;
  testID?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DestinationMapPicker({
  latitude,
  longitude,
  radiusMeters,
  onPositionChange,
  recenterKey,
  testID,
}: Props) {
  // react-native-maps MapView is a class component; cast to any keeps
  // TypeScript happy across library versions while preserving runtime behaviour.
  const mapRef = useRef<any>(null);

  const pinLat = isValidCoord(latitude, longitude) ? latitude! : DEMO_LAT;
  const pinLng = isValidCoord(latitude, longitude) ? longitude! : DEMO_LNG;
  const hasPin = isValidCoord(latitude, longitude);

  // Internal marker position — owned by this component after mount.
  // Seeded from parent on first render and re-seeded on recenterKey changes.
  const [markerCoord, setMarkerCoord] = useState({
    latitude: pinLat,
    longitude: pinLng,
  });

  // ── Re-centre on saved-place selection (recenterKey changes) ───────────────
  // Intentionally depends only on recenterKey, not on latitude/longitude,
  // so parent echoes from onPositionChange are not treated as re-centring.
  useEffect(() => {
    const lat = isValidCoord(latitude, longitude) ? latitude! : DEMO_LAT;
    const lng = isValidCoord(latitude, longitude) ? longitude! : DEMO_LNG;
    const newCoord = { latitude: lat, longitude: lng };
    setMarkerCoord(newCoord);
    mapRef.current?.animateToRegion(
      { ...newCoord, latitudeDelta: DELTA, longitudeDelta: DELTA },
      350,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterKey]);

  // ── Tap-to-move ────────────────────────────────────────────────────────────
  const handleMapPress = useCallback(
    (e: any) => {
      const { latitude: lat, longitude: lng } = e.nativeEvent.coordinate;
      if (!isValidCoord(lat, lng)) return;
      setMarkerCoord({ latitude: lat, longitude: lng });
      onPositionChange(lat, lng);
    },
    [onPositionChange],
  );

  // ── Marker drag ────────────────────────────────────────────────────────────
  const handleDragEnd = useCallback(
    (e: any) => {
      const { latitude: lat, longitude: lng } = e.nativeEvent.coordinate;
      if (!isValidCoord(lat, lng)) return;
      setMarkerCoord({ latitude: lat, longitude: lng });
      onPositionChange(lat, lng);
    },
    [onPositionChange],
  );

  const initialRegion: Region = {
    latitude: pinLat,
    longitude: pinLng,
    latitudeDelta: DELTA,
    longitudeDelta: DELTA,
  };

  return (
    <View style={styles.wrap} testID={testID ?? 'destination-map-picker'}>
      <MapView
        ref={mapRef}
        testID="destination-map-picker-mapview"
        style={styles.map}
        // Google Maps on Android; Apple Maps on iOS (no key needed)
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={initialRegion}
        // ── Privacy: device GPS is NEVER requested ────────────────────────────
        showsUserLocation={false}
        followsUserLocation={false}
        showsMyLocationButton={false}
        // ─────────────────────────────────────────────────────────────────────
        rotateEnabled={false}
        pitchEnabled={false}
        onPress={handleMapPress}
        accessible
        accessibilityLabel="Destination map — tap the map or drag the pin to set your planned arrival area"
      >
        <Marker
          testID="destination-map-picker-marker"
          coordinate={markerCoord}
          draggable
          onDragEnd={handleDragEnd}
          title="Planned destination"
          description="Planned arrival area — drag or tap map to adjust"
          pinColor="#1A3F74"
        />
        {/* Radius circle: PLANNED ARRIVAL AREA, not active geofencing.
            Only rendered when radiusMeters is finite and within 50–2000 m. */}
        {isValidRadius(radiusMeters) && (
          <Circle
            testID="destination-map-picker-circle"
            center={markerCoord}
            radius={radiusMeters}
            fillColor="rgba(26,63,116,0.12)"
            strokeColor="rgba(26,63,116,0.55)"
            strokeWidth={1.5}
          />
        )}
      </MapView>

      <Text style={styles.hint} testID="destination-map-picker-hint">
        {hasPin
          ? 'Drag the pin or tap the map to adjust your planned arrival area.'
          : 'Demo view \u2014 drag the pin or tap the map to set a planned arrival area. No device location is used.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  map: { height: 220, width: '100%', borderRadius: 14 },
  hint: {
    fontFamily: theme.fonts.body,
    fontSize: 11,
    color: c.muted,
    marginTop: 6,
    lineHeight: 15,
  },
});
