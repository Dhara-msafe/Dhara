/**
 * The actual Leaflet/OpenStreetMap renderer for DestinationMapPicker.web.tsx,
 * split into its own module and loaded via React.lazy() there — same SSR
 * rationale as LeafletActiveJourneyMap.web.tsx (see that file's header for
 * the full story): leaflet/@react-leaflet touch `window` at module-eval
 * time, which crashes Expo's web SSR pass if imported statically.
 */
import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker as LMarker, Circle as LCircle, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { isValidRadius } from '@/src/utils/mapValidation';

const pinIcon = L.divIcon({
  className: '', html: `
    <svg width="26" height="34" viewBox="0 0 24 32" fill="#1A3F74" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20c0-6.6-5.4-12-12-12z"/>
      <circle cx="12" cy="12" r="4.5" fill="#fff"/>
    </svg>`,
  iconSize: [26, 34], iconAnchor: [13, 34],
});

function Recenter({ lat, lng, recenterKey }: { lat: number; lng: number; recenterKey?: string | number }) {
  const map = useMap();
  useEffect(() => {
    map.panTo([lat, lng]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterKey]);
  return null;
}

function ClickHandler({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onClick(e.latlng.lat, e.latlng.lng) });
  return null;
}

export interface LeafletDestinationMapPickerProps {
  markerPos: { lat: number; lng: number };
  radiusMeters: number;
  onPositionChange: (lat: number, lng: number) => void;
  recenterKey?: string | number;
  mapHeight: number;
}

export default function LeafletDestinationMapPicker({
  markerPos, radiusMeters, onPositionChange, recenterKey, mapHeight,
}: LeafletDestinationMapPickerProps) {
  return (
    <MapContainer center={[markerPos.lat, markerPos.lng]} zoom={15} style={{ height: mapHeight, width: '100%', borderRadius: 14 }} attributionControl>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
      <Recenter lat={markerPos.lat} lng={markerPos.lng} recenterKey={recenterKey} />
      <ClickHandler onClick={onPositionChange} />
      <LMarker
        position={[markerPos.lat, markerPos.lng]}
        icon={pinIcon}
        draggable
        eventHandlers={{
          dragend: (e) => {
            const pos = e.target.getLatLng();
            onPositionChange(pos.lat, pos.lng);
          },
        }}
      />
      {isValidRadius(radiusMeters) && (
        <LCircle center={[markerPos.lat, markerPos.lng]} radius={radiusMeters} pathOptions={{ color: '#1A3F74', weight: 1.5, fillOpacity: 0.12, opacity: 0.55 }} />
      )}
    </MapContainer>
  );
}
