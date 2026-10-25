/**
 * mapValidation.test.mjs — device-level map validation logic tests.
 *
 * Imports the actual production helpers (isValidCoord, isValidRadius) from
 * mapValidation.ts.  These are platform-independent utilities with no React
 * or native-module dependencies, so they run cleanly in Node with
 * --experimental-strip-types.
 *
 * NATIVE-BUILD ITEMS (NOT RUN here):
 *   N-1  react-native-maps <MapView> renders on iOS (requires Xcode build)
 *   N-2  react-native-maps <MapView> renders on Android (requires Gradle build)
 *   N-3  Marker drag event returns valid coords (device gesture test)
 *   N-4  <Circle> radius ring visible at 50 m and 2 000 m extremes (visual test)
 *   N-5  GPS lat/lng arrive within isValidCoord bounds on real device
 *   N-6  Map tiles load without requiring a Google Maps Platform API key
 *
 * Run with:
 *   node --experimental-strip-types \
 *     src/__tests__/mapValidation.test.mjs
 */

import assert from 'node:assert/strict';
import { isValidCoord, isValidRadius } from '../utils/mapValidation.ts';

// ── Test harness ──────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const queue = [];
function test(label, fn) { queue.push({ label, fn }); }

async function run() {
  for (const { label, fn } of queue) {
    try {
      await fn();
      console.log(`  PASS  ${label}`);
      passed++;
    } catch (e) {
      console.log(`  FAIL  ${label}  — ${e.message}`);
      failed++;
    }
  }
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${passed} PASS   ${failed} FAIL   ${passed + failed} total`);
  console.log('═'.repeat(60));
  if (failed) process.exit(1);
}

// ══════════════════════════════════════════════════════════════════
//  isValidCoord
// ══════════════════════════════════════════════════════════════════

test('MV-1: isValidCoord returns true for a typical Indian city coordinate', () => {
  assert.equal(isValidCoord(19.076, 72.8777), true, 'Mumbai should be valid');
  assert.equal(isValidCoord(12.9716, 77.5946), true, 'Bengaluru should be valid');
  assert.equal(isValidCoord(28.6139, 77.209), true, 'New Delhi should be valid');
});

test('MV-2: isValidCoord returns true for (0, 0) — equator/prime-meridian', () => {
  // (0,0) is a valid coordinate in the ocean. Must not be rejected as "falsy".
  assert.equal(isValidCoord(0, 0), true);
});

test('MV-3: isValidCoord returns true for the extreme valid corners of the globe', () => {
  assert.equal(isValidCoord(90, 180), true,  'NE extreme');
  assert.equal(isValidCoord(-90, -180), true, 'SW extreme');
  assert.equal(isValidCoord(90, -180), true,  'NW extreme');
  assert.equal(isValidCoord(-90, 180), true,  'SE extreme');
});

test('MV-4: isValidCoord rejects null / undefined in either position', () => {
  assert.equal(isValidCoord(null, 72.8777), false);
  assert.equal(isValidCoord(19.076, null), false);
  assert.equal(isValidCoord(null, null), false);
  assert.equal(isValidCoord(undefined, 72.8777), false);
  assert.equal(isValidCoord(19.076, undefined), false);
});

test('MV-5: isValidCoord rejects NaN in either position', () => {
  assert.equal(isValidCoord(NaN, 72.8777), false);
  assert.equal(isValidCoord(19.076, NaN), false);
  assert.equal(isValidCoord(NaN, NaN), false);
});

test('MV-6: isValidCoord rejects ±Infinity', () => {
  assert.equal(isValidCoord(Infinity, 72.8777), false);
  assert.equal(isValidCoord(-Infinity, 77.5946), false);
  assert.equal(isValidCoord(19.076, Infinity), false);
  assert.equal(isValidCoord(19.076, -Infinity), false);
});

test('MV-7: isValidCoord rejects latitude out of range (> 90 or < -90)', () => {
  assert.equal(isValidCoord(90.001, 0), false, 'lat just above 90 must fail');
  assert.equal(isValidCoord(-90.001, 0), false, 'lat just below -90 must fail');
  assert.equal(isValidCoord(180, 0), false, 'lat=180 is wrong axis, must fail');
  assert.equal(isValidCoord(-180, 0), false);
});

test('MV-8: isValidCoord rejects longitude out of range (> 180 or < -180)', () => {
  assert.equal(isValidCoord(0, 180.001), false, 'lng just above 180 must fail');
  assert.equal(isValidCoord(0, -180.001), false);
  assert.equal(isValidCoord(0, 360), false);
});

test('MV-9: isValidCoord accepts the boundary values exactly (not exclusive)', () => {
  // Boundary: lat ∈ [-90, 90], lng ∈ [-180, 180] — inclusive both ends.
  assert.equal(isValidCoord(90, 0), true);
  assert.equal(isValidCoord(-90, 0), true);
  assert.equal(isValidCoord(0, 180), true);
  assert.equal(isValidCoord(0, -180), true);
});

// ══════════════════════════════════════════════════════════════════
//  isValidRadius
// ══════════════════════════════════════════════════════════════════

test('MV-10: isValidRadius returns true within the permitted band (50–2000 m)', () => {
  assert.equal(isValidRadius(50), true,   'minimum 50 m must be valid');
  assert.equal(isValidRadius(200), true,  '200 m typical arrival zone');
  assert.equal(isValidRadius(500), true,  '500 m');
  assert.equal(isValidRadius(2000), true, 'maximum 2 000 m must be valid');
});

test('MV-11: isValidRadius rejects values below the 50 m minimum', () => {
  assert.equal(isValidRadius(0), false,   '0 m makes no sense');
  assert.equal(isValidRadius(1), false,   '1 m sub-minimum');
  assert.equal(isValidRadius(49), false,  '49 m just below minimum');
  assert.equal(isValidRadius(-10), false, 'negative radius');
});

test('MV-12: isValidRadius rejects values above the 2 000 m maximum', () => {
  assert.equal(isValidRadius(2001), false, '2001 m just above maximum');
  assert.equal(isValidRadius(5000), false, '5 km');
  assert.equal(isValidRadius(1e6), false,  '1 000 km absurd value');
});

test('MV-13: isValidRadius rejects NaN, Infinity, -Infinity', () => {
  assert.equal(isValidRadius(NaN), false);
  assert.equal(isValidRadius(Infinity), false);
  assert.equal(isValidRadius(-Infinity), false);
});

test('MV-14: isValidRadius rejects non-number types', () => {
  // @ts-ignore — intentionally passing wrong type to verify runtime guard
  assert.equal(isValidRadius('200'), false, 'string "200" must be rejected');
  // @ts-ignore
  assert.equal(isValidRadius(null), false);
  // @ts-ignore
  assert.equal(isValidRadius(undefined), false);
});

test('MV-15: boundary values 50 and 2000 are inclusive', () => {
  assert.equal(isValidRadius(50), true,   'lower boundary inclusive');
  assert.equal(isValidRadius(2000), true, 'upper boundary inclusive');
  assert.equal(isValidRadius(49.999), false, 'just under lower boundary');
  assert.equal(isValidRadius(2000.001), false, 'just over upper boundary');
});

// ══════════════════════════════════════════════════════════════════
//  Combined guard (isValidCoord AND isValidRadius must both pass
//  before the map component receives its props)
// ══════════════════════════════════════════════════════════════════

test('MV-16: both guards pass for a realistic destination pin drop scenario', () => {
  const lat = 19.076, lng = 72.8777, radius = 300;
  assert.equal(isValidCoord(lat, lng), true,   'coord guard passes');
  assert.equal(isValidRadius(radius), true,    'radius guard passes');
  // Both pass → safe to pass to <MapView> / <Circle>
  assert.equal(isValidCoord(lat, lng) && isValidRadius(radius), true);
});

test('MV-17: a bad coord blocks the render even if radius is fine', () => {
  const lat = NaN, lng = 72.8777, radius = 300;
  assert.equal(isValidCoord(lat, lng) && isValidRadius(radius), false,
    'NaN lat must veto the combined guard');
});

test('MV-18: a bad radius blocks the render even if coord is fine', () => {
  const lat = 19.076, lng = 72.8777, radius = 0;
  assert.equal(isValidCoord(lat, lng) && isValidRadius(radius), false,
    'zero radius must veto the combined guard');
});

await run();

console.log(`
NOT RUN — native-device validation (requires a real device build):
  N-1  react-native-maps <MapView> renders correctly on iOS (Xcode build)
  N-2  react-native-maps <MapView> renders correctly on Android (Gradle build)
  N-3  Marker drag event returns coordinates that pass isValidCoord
  N-4  <Circle> radius ring visible at exactly 50 m and 2 000 m
  N-5  Live GPS coordinates from expo-location pass isValidCoord on device
  N-6  Map tiles load via OSM without requiring a Google Maps API key
  N-7  DestinationMapPicker renders the arrival-radius picker correctly
`);
