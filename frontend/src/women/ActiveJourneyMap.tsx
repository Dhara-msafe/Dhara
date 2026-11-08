/**
 * ActiveJourneyMap — native (iOS/Android) implementation.
 *
 * Read-only live map for an IN-PROGRESS Head Out journey: current position,
 * destination pin, the planned route line, and the arrival-radius circle.
 *
 * Deliberately a SEPARATE component from DestinationMapPicker, not a mode
 * flag on it — DestinationMapPicker's whole privacy contract is "never shows
 * or requests device location" (used during destination *picking*, before a
 * journey exists). Here the opposite is true and intended: the user has
 * already started a live safety journey and showing their own position is
 * the entire point. Reusing one component for both would make that contract
 * a runtime flag instead of a file-level guarantee.
 *
 * currentLat/currentLng come from the ALREADY-RUNNING useJourneyGPS hook
 * (single source of truth) — this component never calls expo-location
 * itself and never sets showsUserLocation, so no second, redundant location
 * subscription or permission prompt is created.
 *
 * Metro platform-extension resolution:
 *  iOS/Android → this file
 *  Web         → ActiveJourneyMap.web.tsx (Google Maps JavaScript API)
 */
import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Circle, Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import type { Region } from 'react-native-maps';
import { theme } from '@/src/theme';
import { isValidCoord, isValidRadius } from '@/src/utils/mapValidation';

const c = theme.colors;
const DELTA = 0.012;

export interface Props {
  currentLat: number | null;
  currentLng: number | null;
  destLat: number;
  destLng: number;
  radiusMeters: number;
  /** [[lat, lng], ...] from GET /api/geo/directions — a straight 2-point line
   * when the backend fell back to its approximate estimate, a real
   * road-following path otherwise. Null/empty while the first fetch is in flight. */
  routePolyline: [number, number][] | null;
  mapHeight?: number;
  testID?: string;
}

export function ActiveJourneyMap({
  currentLat, currentLng, destLat, destLng, radiusMeters, routePolyline,
  mapHeight = 260, testID,
}: Props) {
  const mapRef = useRef<any>(null);
  const hasCurrent = isValidCoord(currentLat, currentLng);

  // Fit both points in view whenever either moves meaningfully — re-running
  // on every GPS tick would feel jumpy, so this only reacts to the two
  // specific coordinate pairs, not a continuous stream of micro-updates.
  useEffect(() => {
    if (!hasCurrent || !mapRef.current) return;
    mapRef.current.fitToCoordinates(
      [{ latitude: currentLat!, longitude: currentLng! }, { latitude: destLat, longitude: destLng }],
      { edgePadding: { top: 60, right: 60, bottom: 60, left: 60 }, animated: true },
    );
  }, [hasCurrent, currentLat, currentLng, destLat, destLng]);

  const initialRegion: Region = {
    latitude: hasCurrent ? currentLat! : destLat,
    longitude: hasCurrent ? currentLng! : destLng,
    latitudeDelta: DELTA,
    longitudeDelta: DELTA,
  };

  return (
    <View style={styles.wrap} testID={testID ?? 'active-journey-map'}>
      <MapView
        ref={mapRef}
        testID="active-journey-map-mapview"
        style={[styles.map, { height: mapHeight }]}
        provider={PROVIDER_GOOGLE}
        initialRegion={initialRegion}
        // The blue dot here is OUR marker below, not the OS's — see file header.
        showsUserLocation={false}
        followsUserLocation={false}
        showsMyLocationButton={false}
        rotateEnabled={false}
        pitchEnabled={false}
        accessible
        accessibilityLabel="Live journey map showing your position, destination, and route"
      >
        {!!routePolyline && routePolyline.length >= 2 && (
          <Polyline
            testID="active-journey-map-route"
            coordinates={routePolyline.map(([lat, lng]) => ({ latitude: lat, longitude: lng }))}
            strokeColor={c.navy}
            strokeWidth={4}
          />
        )}

        <Marker
          testID="active-journey-map-dest"
          coordinate={{ latitude: destLat, longitude: destLng }}
          title="Destination"
          pinColor={c.emergencyRed}
        />

        {isValidRadius(radiusMeters) && (
          <Circle
            testID="active-journey-map-radius"
            center={{ latitude: destLat, longitude: destLng }}
            radius={radiusMeters}
            fillColor="rgba(26,63,116,0.12)"
            strokeColor="rgba(26,63,116,0.55)"
            strokeWidth={1.5}
          />
        )}

        {hasCurrent && (
          <Marker
            testID="active-journey-map-current"
            coordinate={{ latitude: currentLat!, longitude: currentLng! }}
            title="You"
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.currentDotOuter}>
              <View style={styles.currentDotInner} />
            </View>
          </Marker>
        )}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14, alignSelf: 'stretch', width: '100%' },
  map: { height: 260, width: '100%', borderRadius: 14 },
  currentDotOuter: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(29,78,216,0.25)',
    alignItems: 'center', justifyContent: 'center',
  },
  currentDotInner: {
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: '#1D4ED8', borderWidth: 2, borderColor: '#fff',
  },
});
