/**
 * DestinationMapPicker — native (iOS/Android) placeholder.
 *
 * The interactive pin + radius map is implemented for the web preview only
 * (DestinationMapPicker.web.tsx — OpenStreetMap tiles via Leaflet). Native
 * rendering with react-native-maps needs a verified, app-restricted Google
 * Maps API key (EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is still a placeholder —
 * see frontend/.env) plus a native build to validate, so this placeholder
 * keeps native builds safe and avoids a blank/grey map area. Manual label
 * entry and the radius chips above remain fully functional on every
 * platform; no location is read automatically here.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';

const c = theme.colors;

interface Props {
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  onPositionChange: (lat: number, lng: number) => void;
  recenterKey?: string | number;
  testID?: string;
}

// eslint-disable-next-line no-empty-pattern
export function DestinationMapPicker({}: Props) {
  return (
    <View style={styles.box} testID="destination-map-picker-native-stub">
      <Ionicons name="map-outline" size={20} color={c.muted} />
      <Text style={styles.txt}>
        An interactive map pin is available in the web preview during this pilot. Use the destination name and planned-arrival radius above \u2014 no location is read automatically on this device.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: c.surfaceSecondary, borderRadius: 14, padding: 14, marginBottom: 14,
  },
  txt: { flex: 1, fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, lineHeight: 17 },
});
