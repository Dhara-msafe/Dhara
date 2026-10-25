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
