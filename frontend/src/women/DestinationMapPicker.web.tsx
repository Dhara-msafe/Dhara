/**
 * DestinationMapPicker — web implementation (Google Maps JavaScript API).
 *
 * Replaced from the previous OpenStreetMap/Leaflet implementation.
 * Uses @react-google-maps/api with EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY.
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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  GoogleMap,
  LoadScript,
  Marker,
  Circle,
} from '@react-google-maps/api';
import { theme } from '@/src/theme';
import { isValidCoord, isValidRadius } from '@/src/utils/mapValidation';

const c = theme.colors;

// Generic demo centre (New Delhi) — never from device GPS.
const DEMO_LAT = 28.6139;
const DEMO_LNG = 77.209;

const WEB_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY ?? '';

const MAP_CONTAINER_STYLE = { width: '100%', height: '220px', borderRadius: '14px' };

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
}

export function DestinationMapPicker({
  latitude,
  longitude,
  radiusMeters,
  onPositionChange,
  recenterKey,
  testID,
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

  if (!WEB_API_KEY) {
    return (
      <View style={styles.wrap} testID={testID ?? 'destination-map-picker'}>
        <View style={styles.fallback}>
          <Text style={styles.hint}>Map unavailable — web API key not configured.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap} testID={testID ?? 'destination-map-picker'}>
      <LoadScript googleMapsApiKey={WEB_API_KEY} loadingElement={
        <View style={styles.fallback}><Text style={styles.hint}>Loading map…</Text></View>
      }>
        <GoogleMap
          mapContainerStyle={MAP_CONTAINER_STYLE}
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
          : 'Demo view \u2014 click the map or drag the pin to set your planned arrival area. No device location is used.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
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
