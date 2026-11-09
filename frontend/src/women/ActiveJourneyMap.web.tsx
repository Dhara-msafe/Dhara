/**
 * ActiveJourneyMap — web implementation.
 *
 * Primary renderer is Google Maps (JavaScript API), matching native. When
 * EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY isn't configured, this falls back to a
 * free OpenStreetMap/Leaflet map instead of a static "map unavailable" box —
 * same layered-fallback shape already used for Places/Directions on the
 * backend (geo_router.py), just applied to map *rendering* instead of a data
 * API. `leaflet`/`react-leaflet` were already installed (unused) from before
 * this screen was migrated to Google Maps — nothing new to add as a
 * dependency. Raster tiles come straight from tile.openstreetmap.org, whose
 * usage policy is for light/demo traffic only — fine for local dev, previews,
 * and as a no-key fallback, but a production deployment at real scale should
 * use a paid tile provider (Mapbox, MapTiler, Google once keyed) instead.
 *
 * See ActiveJourneyMap.tsx (native) for the full rationale on why this is a
 * separate component from DestinationMapPicker rather than a mode flag on
 * it. Same privacy note applies here: currentLat/currentLng are supplied by
 * the parent (sourced from the native useJourneyGPS hook, a no-op on web —
 * see that hook's web branch) — this component never requests geolocation
 * itself.
 */
import React, { useEffect, useRef, Suspense, lazy } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  GoogleMap,
  LoadScript,
  Marker,
  Circle,
  Polyline,
} from '@react-google-maps/api';
import { theme } from '@/src/theme';
import { isValidCoord, isValidRadius } from '@/src/utils/mapValidation';

// Lazy + Suspense, NOT a static import — leaflet/react-leaflet touch
// `window`/DOM at module-evaluation time, which crashes Expo's web SSR pass
// (runs in Node). Deferring via dynamic import() means this module is only
// required client-side, after hydration, when this branch actually renders.
// See LeafletActiveJourneyMap.web.tsx's file header for the full story.
const LeafletActiveJourneyMap = lazy(() => import('./LeafletActiveJourneyMap.web'));

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

  useEffect(() => {
    if (!WEB_API_KEY || !hasCurrent || !mapRef.current || typeof google === 'undefined') return;
    const bounds = new google.maps.LatLngBounds();
    bounds.extend({ lat: currentLat!, lng: currentLng! });
    bounds.extend({ lat: destLat, lng: destLng });
    mapRef.current.fitBounds(bounds, 60);
  }, [hasCurrent, currentLat, currentLng, destLat, destLng]);

  const center = hasCurrent ? { lat: currentLat!, lng: currentLng! } : { lat: destLat, lng: destLng };

  if (!WEB_API_KEY) {
    return (
      <Suspense fallback={<View style={[styles.fallback, { height: mapHeight }]} testID={testID ?? 'active-journey-map'} />}>
        <LeafletActiveJourneyMap
          currentLat={currentLat} currentLng={currentLng} destLat={destLat} destLng={destLng}
          radiusMeters={radiusMeters} routePolyline={routePolyline} mapHeight={mapHeight} testID={testID}
        />
      </Suspense>
    );
  }

  return (
    <View style={styles.wrap} testID={testID ?? 'active-journey-map'}>
      <LoadScript googleMapsApiKey={WEB_API_KEY} loadingElement={
        <View style={[styles.fallback, { height: mapHeight }]} />
      }>
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
      </LoadScript>
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
