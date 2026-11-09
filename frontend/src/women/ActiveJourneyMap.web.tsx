/**
 * ActiveJourneyMap — web implementation.
 *
 * Primary renderer is Google Maps (JavaScript API), matching native. When
 * EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY isn't configured, this falls back to a
 * simple static placeholder (no map drawn) rather than a broken screen — a
 * real Leaflet/OpenStreetMap fallback is a reasonable future enhancement
 * but isn't built yet, so it's not referenced here (same approach as
 * DestinationMapPicker.web.tsx's own no-key fallback).
 *
 * See ActiveJourneyMap.tsx (native) for the full rationale on why this is a
 * separate component from DestinationMapPicker rather than a mode flag on
 * it. Same privacy note applies here: currentLat/currentLng are supplied by
 * the parent (sourced from the native useJourneyGPS hook, a no-op on web —
 * see that hook's web branch) — this component never requests geolocation
 * itself.
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  GoogleMap,
  useJsApiLoader,
  Marker,
  Circle,
  Polyline,
} from '@react-google-maps/api';
import { theme } from '@/src/theme';
import { isValidCoord, isValidRadius } from '@/src/utils/mapValidation';

const c = theme.colors;
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

const ROUTE_OPTIONS: google.maps.PolylineOptions = {
  strokeColor: '#14365A',
  strokeOpacity: 0.9,
  strokeWeight: 4,
  clickable: false,
};

export interface Props {
  currentLat: number | null;
  currentLng: number | null;
  destLat: number;
  destLng: number;
  radiusMeters: number;
  routePolyline: [number, number][] | null;
  mapHeight?: number;
  testID?: string;
}

export function ActiveJourneyMap({
  currentLat, currentLng, destLat, destLng, radiusMeters, routePolyline,
  mapHeight = 260, testID,
}: Props) {
  const hasCurrent = isValidCoord(currentLat, currentLng);
  const mapRef = useRef<google.maps.Map | null>(null);

  // No `id` passed — this intentionally shares the SAME default loader
  // singleton ("__googleMapsScriptId") as DestinationMapPicker.web.tsx's own
  // useJsApiLoader call. @react-google-maps/api's <LoadScript> only supports
  // ONE mounted instance across the whole page; this screen and the
  // destination-picker step both need a Google Map at once (e.g. switching
  // between the wizard and an active journey), so both now load the script
  // through this shared hook instead of each wrapping their own <LoadScript>.
  const { isLoaded } = useJsApiLoader({ googleMapsApiKey: WEB_API_KEY });

  useEffect(() => {
    if (!WEB_API_KEY || !hasCurrent || !mapRef.current || typeof google === 'undefined') return;
    const bounds = new google.maps.LatLngBounds();
    bounds.extend({ lat: currentLat!, lng: currentLng! });
    bounds.extend({ lat: destLat, lng: destLng });
    mapRef.current.fitBounds(bounds, 60);
  }, [hasCurrent, currentLat, currentLng, destLat, destLng]);

  const center = hasCurrent ? { lat: currentLat!, lng: currentLng! } : { lat: destLat, lng: destLng };

  if (!WEB_API_KEY || !isLoaded) {
    return (
      <View style={[styles.fallback, { height: mapHeight }]} testID={testID ?? 'active-journey-map'}>
        {WEB_API_KEY && <Text style={styles.hint}>Loading map…</Text>}
        {!WEB_API_KEY && <Text style={styles.hint}>Map preview isn&apos;t available right now.</Text>}
      </View>
    );
  }

  return (
    <View style={styles.wrap} testID={testID ?? 'active-journey-map'}>
      <GoogleMap
        mapContainerStyle={mapContainerStyle(mapHeight)}
        center={center}
        zoom={15}
        options={MAP_OPTIONS}
        onLoad={(map) => { mapRef.current = map; }}
      >
        {!!routePolyline && routePolyline.length >= 2 && (
          <Polyline
            path={routePolyline.map(([lat, lng]) => ({ lat, lng }))}
            options={ROUTE_OPTIONS}
          />
        )}

        <Marker position={{ lat: destLat, lng: destLng }} title="Destination" />

        {isValidRadius(radiusMeters) && (
          <Circle center={{ lat: destLat, lng: destLng }} radius={radiusMeters} options={CIRCLE_OPTIONS} />
        )}

        {hasCurrent && (
          <Marker
            position={{ lat: currentLat!, lng: currentLng! }}
            title="You"
            icon={{
              path: 0, // google.maps.SymbolPath.CIRCLE — numeric literal avoids a load-order dependency on the `google` global at module-eval time
              scale: 7,
              fillColor: '#1D4ED8',
              fillOpacity: 1,
              strokeColor: '#fff',
              strokeWeight: 2,
            }}
          />
        )}
      </GoogleMap>
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