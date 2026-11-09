/**
 * mapValidation — platform-independent coordinate and radius guards.
 *
 * Shared between DestinationMapPicker (native) and its logic tests.
 * No React, no native modules — safe to import in any environment.
 */

/**
 * Returns true for any finite, in-range coordinate pair including (0, 0).
 * Rejects null, undefined, NaN, Infinity, and out-of-range values.
 */
export function isValidCoord(
  lat: number | null | undefined,
  lng: number | null | undefined,
): boolean {
  return (
    lat != null &&
    lng != null &&
    isFinite(lat) &&
    isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Returns true when r is a finite number within the permitted arrival-radius
 * band (50 – 2 000 m).
 *
 * Rejects: NaN, Infinity, -Infinity, negative values, zero, and any value
 * outside 50–2000 m so that the react-native-maps <Circle> component never
 * receives a non-finite or nonsensical radius prop.
 */
export function isValidRadius(r: number): boolean {
  return typeof r === 'number' && isFinite(r) && r >= 50 && r <= 2000;
}

/** Great-circle distance in metres. Used for arrival-zone detection (Head
 * Out's "inside arrival zone" screen) — a straight-line formula is the right
 * tool there since it's compared against a radius, not a road network. */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLambda = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLambda / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Approximate shortest distance (metres) from a point to a polyline, used for
 * route-deviation detection ("outside the expected route"). Uses an
 * equirectangular flat-earth projection local to the polyline's first point —
 * accurate enough at the few-hundred-metre scale this is compared against
 * (a city-block journey, not a cross-country one); not meant for long routes.
 */
export function distanceToPolylineMeters(lat: number, lng: number, polyline: [number, number][]): number {
  if (polyline.length === 0) return Infinity;
  if (polyline.length === 1) return haversineMeters(lat, lng, polyline[0][0], polyline[0][1]);

  const refLat = polyline[0][0];
  const cosRef = Math.cos((refLat * Math.PI) / 180);
  const R = 6371000;
  const toXY = (plat: number, plng: number): [number, number] => [
    ((plng - polyline[0][1]) * Math.PI / 180) * cosRef * R,
    ((plat - polyline[0][0]) * Math.PI / 180) * R,
  ];

  const [px, py] = toXY(lat, lng);
  let best = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const [ax, ay] = toXY(polyline[i][0], polyline[i][1]);
    const [bx, by] = toXY(polyline[i + 1][0], polyline[i + 1][1]);
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    const dist = Math.hypot(px - cx, py - cy);
    if (dist < best) best = dist;
  }
  return best;
}