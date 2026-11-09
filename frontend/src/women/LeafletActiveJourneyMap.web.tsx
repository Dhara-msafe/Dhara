/**
 * The actual Leaflet/OpenStreetMap renderer for ActiveJourneyMap.web.tsx,
 * split into its own module and loaded via React.lazy() there. Leaflet (and
 * @react-leaflet/core) touch `window`/DOM at module-evaluation time, which
 * crashes Expo's web SSR pass (runs in Node, no `window`) if imported
 * statically from a module that's part of the eagerly-evaluated bundle.
 * React.lazy()'s dynamic import() defers requiring this file until it
 * actually renders client-side, after hydration — SSR never touches it.
 */
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { MapContainer, TileLayer, Marker as LMarker, Circle as LCircle, Polyline as LPolyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { isValidCoord, isValidRadius } from '@/src/utils/mapValidation';
import { theme } from '@/src/theme';

const c = theme.colors;

const destIcon = L.divIcon({
  className: '', html: `
    <svg width="26" height="34" viewBox="0 0 24 32" fill="${c.emergencyRed}" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20c0-6.6-5.4-12-12-12z"/>
      <circle cx="12" cy="12" r="4.5" fill="#fff"/>
    </svg>`,
  iconSize: [26, 34], iconAnchor: [13, 34],
});
const currentIcon = L.divIcon({
  className: '', html: `
    <div style="width:16px;height:16px;border-radius:50%;background:#1D4ED8;border:2.5px solid #fff;box-shadow:0 0 0 5px rgba(29,78,216,0.22);"></div>`,
  iconSize: [16, 16], iconAnchor: [8, 8],
});

function FitBounds({ hasCurrent, currentLat, currentLng, destLat, destLng }: {
  hasCurrent: boolean; currentLat: number | null; currentLng: number | null; destLat: number; destLng: number;
}) {
  const map = useMap();
  useEffect(() => {
    if (hasCurrent) {
      map.fitBounds([[currentLat!, currentLng!], [destLat, destLng]], { padding: [60, 60] });
    } else {
      map.setView([destLat, destLng], 15);
    }
  }, [hasCurrent, currentLat, currentLng, destLat, destLng, map]);
  return null;
}

export interface LeafletActiveJourneyMapProps {
  currentLat: number | null;
  currentLng: number | null;
  destLat: number;
  destLng: number;
  radiusMeters: number;
  routePolyline: [number, number][] | null;
  mapHeight: number;
  testID?: string;
}

export default function LeafletActiveJourneyMap({
  currentLat, currentLng, destLat, destLng, radiusMeters, routePolyline, mapHeight, testID,
}: LeafletActiveJourneyMapProps) {
  const hasCurrent = isValidCoord(currentLat, currentLng);
  const center: [number, number] = hasCurrent ? [currentLat!, currentLng!] : [destLat, destLng];

  return (
    <View style={{ marginBottom: 14, alignSelf: 'stretch', width: '100%' }} testID={testID ?? 'active-journey-map'}>
      <MapContainer center={center} zoom={15} style={{ height: mapHeight, width: '100%', borderRadius: 14 }} attributionControl>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
        <FitBounds hasCurrent={hasCurrent} currentLat={currentLat} currentLng={currentLng} destLat={destLat} destLng={destLng} />

        {!!routePolyline && routePolyline.length >= 2 && (
          <LPolyline positions={routePolyline} pathOptions={{ color: '#14365A', weight: 4, opacity: 0.9 }} />
        )}

        <LMarker position={[destLat, destLng]} icon={destIcon} />

        {isValidRadius(radiusMeters) && (
          <LCircle center={[destLat, destLng]} radius={radiusMeters} pathOptions={{ color: '#1A3F74', weight: 1.5, fillOpacity: 0.12, opacity: 0.55 }} />
        )}

        {hasCurrent && <LMarker position={[currentLat!, currentLng!]} icon={currentIcon} />}
      </MapContainer>
    </View>
  );
}
