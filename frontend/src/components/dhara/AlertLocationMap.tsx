/**
 * AlertLocationMap — native (iOS/Android) implementation.
 *
 * Renders a small embedded map showing the recipient's last-known-location
 * marker plus an accuracy circle. Metro's platform-extension resolution
 * automatically picks THIS file on iOS/Android and `AlertLocationMap.web.tsx`
 * on web, so `react-native-maps` (a native-only module) is never imported
 * into the web bundle — avoiding a bundling/runtime crash on web/Expo Go.
 *
 * Uses Apple Maps on iOS (no API key needed) and Google Maps on Android
 * (requires EXPO_PUBLIC_GOOGLE_MAPS_API_KEY / the react-native-maps config
 * plugin key in app.json — currently a placeholder; see frontend/.env).
 *
 * P1 Map Integration — scope: marker + accuracy circle + static preview
 * only. No continuous tracking / live watch — this renders a single
 * last-known snapshot already fetched by the caller.
 */
import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import MapView, { Marker, Circle, PROVIDER_GOOGLE } from 'react-native-maps';

type Props = {
  lat: number;
  lng: number;
  accuracyMeters?: number;
};

export function AlertLocationMap({ lat, lng, accuracyMeters }: Props) {
  const coordinate = { latitude: lat, longitude: lng };
  return (
    <MapView
      testID="alert-location-map"
      style={styles.map}
      provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
      initialRegion={{ ...coordinate, latitudeDelta: 0.01, longitudeDelta: 0.01 }}
    >
      <Marker coordinate={coordinate} title="Last known location" />
      {!!accuracyMeters && accuracyMeters > 0 && (
        <Circle
          center={coordinate}
          radius={accuracyMeters}
          fillColor="rgba(26,63,116,0.15)"
          strokeColor="rgba(26,63,116,0.6)"
          strokeWidth={1}
        />
      )}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { height: 180, width: '100%', borderRadius: 14, marginTop: 10 },
});
