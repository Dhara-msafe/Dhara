/**
 * DestinationMapPicker — web implementation (OpenStreetMap via Leaflet).
 *
 * Isolated synthetic pilot (see DestinationPicker.tsx for full scope notes).
 * Renders public OSM tiles with a single draggable pin and a radius circle.
 * No geocoding, no address search, no Google Places/Routes calls are made —
 * the pin's position is only ever set by the user dragging it or tapping
 * the map. The starting position is a generic, clearly-labelled demo point,
 * never derived from device location or any search/geocoding API.
 *
 * IMPORTANT: `leaflet` reads `window` at module-evaluation time, which
 * crashes Expo Router's web SSR pass (no `window` on the server) for every
 * route, not just this one. To avoid that, the leaflet/react-leaflet
 * modules are loaded lazily inside a `useEffect` (client-only — effects
 * never run during SSR), never via a top-level `import`.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import 'leaflet/dist/leaflet.css';
import { theme } from '@/src/theme';

const c = theme.colors;

// Generic demo centre (New Delhi) used only until a pin position exists.
// Never derived from device GPS or any search/geocoding API.
const DEMO_CENTER: [number, number] = [28.6139, 77.209];

interface Props {
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  onPositionChange: (lat: number, lng: number) => void;
  /** Change this value to force the map to recentre (e.g. a different saved place was picked). */
  recenterKey?: string | number;
  testID?: string;
}

type LeafletModules = {
  MapContainer: any; TileLayer: any; Marker: any; Circle: any; useMapEvents: any; L: any;
};

let cachedModules: LeafletModules | null = null;

function loadLeaflet(): Promise<LeafletModules> {
  if (cachedModules) return Promise.resolve(cachedModules);
  return Promise.all([
    import('react-leaflet'),
    import('leaflet'),
  ]).then(([rl, Lmod]) => {
    const L = (Lmod as any).default ?? Lmod;
    cachedModules = {
      MapContainer: rl.MapContainer,
      TileLayer: rl.TileLayer,
      Marker: rl.Marker,
      Circle: rl.Circle,
      useMapEvents: rl.useMapEvents,
      L,
    };
    return cachedModules;
  });
}

export function DestinationMapPicker(props: Props) {
  const [mods, setMods] = useState<LeafletModules | null>(cachedModules);

  useEffect(() => {
    let active = true;
    if (!mods) {
      loadLeaflet().then(m => { if (active) setMods(m); }).catch((err) => {
        console.error('[DestinationMapPicker] failed to load leaflet:', err);
      });
    }
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!mods) {
    return (
      <View style={styles.wrap} testID={props.testID ?? 'destination-map-picker'}>
        <View style={styles.loadingBox}>
          <Text style={styles.hint}>Loading map preview…</Text>
        </View>
      </View>
    );
  }

  return <LeafletMap {...props} mods={mods} />;
}

function LeafletMap({
  latitude, longitude, radiusMeters, onPositionChange, recenterKey, testID, mods,
}: Props & { mods: LeafletModules }) {
  const { MapContainer, TileLayer, Marker, Circle, useMapEvents, L } = mods;
  const hasPin = latitude != null && longitude != null;

  const pinIcon = useMemo(() => L.divIcon({
    className: 'dp-pin-icon',
    html: '<div style="width:26px;height:26px;border-radius:50% 50% 50% 0;background:#1A3F74;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,0.45);"></div>',
    iconSize: [26, 26],
    iconAnchor: [13, 26],
  }), [L]);

  // Only used to (re)seed the map's initial view — changing it remounts the
  // map (via the `key` below) so the view recentres on an explicit pick.
  const initial = useMemo<[number, number]>(
    () => (hasPin ? [latitude as number, longitude as number] : DEMO_CENTER),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recenterKey],
  );

  const [pos, setPos] = useState<[number, number]>(initial);
  useEffect(() => { setPos(initial); }, [initial]);

  const handleMove = useCallback((lat: number, lng: number) => {
    setPos([lat, lng]);
    onPositionChange(lat, lng);
  }, [onPositionChange]);

  function ClickToMove() {
    useMapEvents({
      click(e: any) { handleMove(e.latlng.lat, e.latlng.lng); },
    });
    return null;
  }

  return (
    <View testID={testID ?? 'destination-map-picker'} style={styles.wrap}>
      <div style={{ height: 220, width: '100%', borderRadius: 14, overflow: 'hidden' }}>
        <MapContainer
          key={String(recenterKey ?? 'default')}
          center={initial}
          zoom={15}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Marker
            position={pos}
            icon={pinIcon}
            draggable
            eventHandlers={{
              dragend(e: any) {
                const p = e.target.getLatLng();
                handleMove(p.lat, p.lng);
              },
            }}
          />
          <Circle
            center={pos}
            radius={radiusMeters}
            pathOptions={{ color: '#1A3F74', fillColor: '#1A3F74', fillOpacity: 0.12, weight: 1.5 }}
          />
          <ClickToMove />
        </MapContainer>
      </div>
      <Text style={styles.hint} testID="destination-map-picker-hint">
        {hasPin
          ? 'Drag the pin or tap the map to adjust your planned arrival spot.'
          : 'Demo view \u2014 drag the pin or tap the map to set a planned arrival spot. No address search is performed.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  loadingBox: {
    height: 220, width: '100%', borderRadius: 14,
    backgroundColor: c.surfaceSecondary, alignItems: 'center', justifyContent: 'center',
  },
  hint: { fontFamily: theme.fonts.body, fontSize: 11, color: c.muted, marginTop: 6, lineHeight: 15 },
});
