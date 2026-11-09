/**
 * AlertLocationMap — web implementation (Google Maps JavaScript API).
 *
 * Replaced the previous text-only fallback. Shows a static Google Map with
 * the recipient's last-known-location marker and accuracy circle.
 * Uses @react-google-maps/api with EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY.
 *
 * No device GPS is read — the coordinates are passed in by the caller
 * from data already fetched from the backend.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { GoogleMap, useJsApiLoader, Marker, Circle } from '@react-google-maps/api';
import { theme } from '@/src/theme';

const c = theme.colors;

const WEB_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY ?? '';

const MAP_CONTAINER_STYLE = { width: '100%', height: '180px', borderRadius: '14px' };

const MAP_OPTIONS: google.maps.MapOptions = {
  disableDefaultUI: true,
  zoomControl: true,
  clickableIcons: false,
};

const CIRCLE_OPTIONS: google.maps.CircleOptions = {
  fillColor: '#1A3F74',
  fillOpacity: 0.15,
  strokeColor: '#1A3F74',
  strokeOpacity: 0.6,
  strokeWeight: 1,
  clickable: false,
};

type Props = {
  lat: number;
  lng: number;
  accuracyMeters?: number;
};

export function AlertLocationMap({ lat, lng, accuracyMeters }: Props) {
  const center = { lat, lng };
  // No `id` passed — shares the same default loader singleton as
  // DestinationMapPicker.web.tsx / ActiveJourneyMap.web.tsx's useJsApiLoader
  // calls, so this map never fights another one over who owns <LoadScript>.
  const { isLoaded } = useJsApiLoader({ googleMapsApiKey: WEB_API_KEY });

  if (!WEB_API_KEY) {
    return (
      <View style={styles.fallback} testID="alert-location-map">
        <Text style={styles.txt}>
          Map preview available in the mobile app. Use &quot;Open in Maps&quot; below to view this location.
        </Text>
      </View>
    );
  }

  if (!isLoaded) {
    return (
      <View style={styles.wrap} testID="alert-location-map">
        <View style={styles.fallback}><Text style={styles.txt}>Loading map…</Text></View>
      </View>
    );
  }

  return (
    <View style={styles.wrap} testID="alert-location-map">
      <GoogleMap
        mapContainerStyle={MAP_CONTAINER_STYLE}
        center={center}
        zoom={15}
        options={MAP_OPTIONS}
      >
        <Marker position={center} title="Last known location" />
        {!!accuracyMeters && accuracyMeters > 0 && (
          <Circle center={center} radius={accuracyMeters} options={CIRCLE_OPTIONS} />
        )}
      </GoogleMap>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10 },
  fallback: {
    backgroundColor: c.surfaceSecondary,
    borderRadius: 14,
    padding: 14,
    marginTop: 10,
  },
  txt: {
    fontFamily: theme.fonts.body,
    fontSize: 12,
    color: c.muted,
    lineHeight: 17,
  },
});
