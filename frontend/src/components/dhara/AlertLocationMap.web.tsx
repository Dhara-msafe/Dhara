/**
 * AlertLocationMap — web fallback.
 *
 * `react-native-maps` is a native-only module and cannot render on web.
 * Metro automatically picks this file for web builds (via the `.web.tsx`
 * platform extension), so the native module is never imported into the web
 * bundle. The existing "Open in Maps" button on the alert screen remains
 * the way to view this location visually on web/Expo Go preview; this file
 * only avoids a blank/crashed area where the map would have been.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '@/src/theme';

const c = theme.colors;

type Props = {
  lat: number;
  lng: number;
  accuracyMeters?: number;
};

// eslint-disable-next-line no-empty-pattern
export function AlertLocationMap({}: Props) {
  return (
    <View style={styles.box} testID="alert-location-map">
      <Text style={styles.txt}>
        Map preview is available in the DHARA mobile app. Use &quot;Open in Maps&quot; below to view this location.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: c.surfaceSecondary, borderRadius: 14, padding: 14, marginTop: 10 },
  txt: { fontFamily: theme.fonts.body, fontSize: 12, color: c.muted, lineHeight: 17 },
});
