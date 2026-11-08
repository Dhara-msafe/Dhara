/**
 * DestinationMapPicker — web implementation.
 *
 * Primary renderer is Google Maps (JavaScript API), matching native. When
 * EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY isn't configured, this falls back to a
 * free OpenStreetMap/Leaflet map — see ActiveJourneyMap.web.tsx's file header
 * for the full rationale (same pattern, same already-installed dependency,
 * same production-scale tile-provider caveat).
 *
 * Features:
 *  • Draggable destination pin
 *  • Radius circle showing the planned arrival area
 *  • Tap-to-move pin
 *  • Responds to recenterKey prop for saved-place selection
 *
 * Privacy contract:
 *  • No device GPS is ever requested or read.
 *  • Starting position uses parent-supplied coords or the New Delhi demo point.
 *  • No geocoding or address lookup is performed.
 *
 * LoadScript is lazy (only loads the Maps JS bundle when this component
 * mounts) and cached across re-renders so the script is fetched once per
 * session regardless of how many instances render.
 */

import React, { useCallback, useEffect, useRef, useState, Suspense, lazy } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  GoogleMap,
  LoadScript,
  Marker,
  Circle,
} from '@react-google-maps/api';
import { theme } from '@/src/theme';
import { isValidCoord, isValidRadius } from '@/src/utils/mapValidation';

// Lazy + Suspense, NOT a static import — see LeafletActiveJourneyMap.web.tsx's
// file header for why (leaflet/react-leaflet crash Expo's web SSR pass if
// required eagerly).
const LeafletDestinationMapPicker = lazy(() => import('./LeafletDestinationMapPicker.web'));

const c = theme.colors;

// Generic demo centre (New Delhi) — never from device GPS.
const DEMO_LAT = 28.6139;
const DEMO_LNG = 77.209;

const WEB_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY ?? '';

function mapContainerStyle(heightPx: number) {
  return { width: '100%', height: `${heightPx}px`, borderRadius: '14px' };
}

const MAP_OPTIONS: google.maps.MapOptions = {
  disableDefaultUI: true,
  zoomControl: true,
  clickableIcons: false,
};

const CIRCLE_OPTIONS: google.maps.CircleOptions = {
  fillColor: '#1A3F74',
  fillOpacity: 0.12,
  strokeColor: '#1A3F74',
  strokeOpacity: 0.55,
  strokeWeight: 1.5,
  clickable: false,
};

export interface Props {
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  onPositionChange: (lat: number, lng: number) => void;
  recenterKey?: string | number;
  testID?: string;
  /** Map height in px. Defaults to 220 (the original embedded-preview size). */
  mapHeight?: number;
}

export function DestinationMapPicker({
  latitude,
  longitude,
  radiusMeters,
  onPositionChange,
  recenterKey,
  testID,
  mapHeight = 220,
}: Props) {
  const hasPin = isValidCoord(latitude, longitude);
  const initLat = hasPin ? latitude! : DEMO_LAT;
  const initLng = hasPin ? longitude! : DEMO_LNG;

  const [markerPos, setMarkerPos] = useState<google.maps.LatLngLiteral>({ lat: initLat, lng: initLng });
  const mapRef = useRef<google.maps.Map | null>(null);

  // Re-centre map when recenterKey changes (saved place selected by parent)
  useEffect(() => {
    const lat = isValidCoord(latitude, longitude) ? latitude! : DEMO_LAT;
    const lng = isValidCoord(latitude, longitude) ? longitude! : DEMO_LNG;
    setMarkerPos({ lat, lng });
    mapRef.current?.panTo({ lat, lng });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterKey]);

  const handleMapClick = useCallback(
    (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();
      if (!isValidCoord(lat, lng)) return;
      setMarkerPos({ lat, lng });
      onPositionChange(lat, lng);
    },
    [onPositionChange],
  );

  const handleDragEnd = useCallback(
    (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();
      if (!isValidCoord(lat, lng)) return;
      setMarkerPos({ lat, lng });
      onPositionChange(lat, lng);
    },
    [onPositionChange],
  );

  const handleLeafletPositionChange = useCallback((lat: number, lng: number) => {
    if (!isValidCoord(lat, lng)) return;
    setMarkerPos({ lat, lng });
    onPositionChange(lat, lng);
  }, [onPositionChange]);

  if (!WEB_API_KEY) {
    return (
      <View style={styles.wrap} testID={testID ?? 'destination-map-picker'}>
        <Suspense fallback={<View style={[styles.fallback, { height: mapHeight }]} />}>
          <LeafletDestinationMapPicker
            markerPos={markerPos} radiusMeters={radiusMeters}
            onPositionChange={handleLeafletPositionChange} recenterKey={recenterKey} mapHeight={mapHeight}
          />
        </Suspense>
        <Text style={styles.hint} testID="destination-map-picker-hint">
          {hasPin
            ? 'Drag the pin or click the map to adjust your planned arrival area.'
            : 'Demo view — click the map or drag the pin to set your planned arrival area. No device location is used.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap} testID={testID ?? 'destination-map-picker'}>
      <LoadScript googleMapsApiKey={WEB_API_KEY} loadingElement={
        <View style={[styles.fallback, { height: mapHeight }]}><Text style={styles.hint}>Loading map…</Text></View>
      }>
        <GoogleMap
          mapContainerStyle={mapContainerStyle(mapHeight)}
          center={markerPos}
          zoom={15}
          options={MAP_OPTIONS}
          onClick={handleMapClick}
          onLoad={(map) => { mapRef.current = map; }}
        >
          <Marker
            position={markerPos}
            draggable
            onDragEnd={handleDragEnd}
            title="Planned destination"
          />
          {isValidRadius(radiusMeters) && (
            <Circle
              center={markerPos}
              radius={radiusMeters}
              options={CIRCLE_OPTIONS}
            />
          )}
        </GoogleMap>
      </LoadScript>
      <Text style={styles.hint} testID="destination-map-picker-hint">
        {hasPin
          ? 'Drag the pin or click the map to adjust your planned arrival area.'
          : 'Demo view — click the map or drag the pin to set your planned arrival area. No device location is used.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14, alignSelf: 'stretch', width: '100%' },
  fallback: {
    height: 220,
    borderRadius: 14,
    backgroundColor: c.surfaceSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    fontFamily: theme.fonts.body,
    fontSize: 11,
    color: c.muted,
    marginTop: 6,
    lineHeight: 15,
  },
});
