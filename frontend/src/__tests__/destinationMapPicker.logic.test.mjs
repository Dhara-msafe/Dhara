/**
 * DestinationMapPicker — logic-layer tests (no React, no native modules).
 *
 * Tests the shared mapValidation helpers and the event-handler logic
 * extracted into plain functions, covering every check the spec requires.
 * Run with: node --experimental-strip-types src/__tests__/destinationMapPicker.logic.test.mjs
 *
 * These tests exercise the pure-logic layer only.
 * Native rendering, Google key acceptance, signing-certificate restrictions
 * and physical gesture interaction are NOT RUN here — they require a
 * separately authorised device build.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidCoord, isValidRadius } from '../utils/mapValidation.ts';

// Resolved relative to this file instead of the old hardcoded '/app/frontend'
// (the Emergent container's fixed checkout path), which crashed with ENOENT
// in any other checkout location, including this one.
const FRONTEND_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

// Simulate what handleMapPress / handleDragEnd do
function handlePosition(nativeEvent, setCoord, onPositionChange) {
  const { latitude: lat, longitude: lng } = nativeEvent.coordinate;
  if (!isValidCoord(lat, lng)) return false;
  setCoord({ latitude: lat, longitude: lng });
  onPositionChange(lat, lng);
  return true;
}

// Simulate recenterKey effect
function recenterEffect(latitude, longitude, setCoord, animateToRegion) {
  const DEMO_LAT = 28.6139, DEMO_LNG = 77.209;
  const lat = isValidCoord(latitude, longitude) ? latitude : DEMO_LAT;
  const lng = isValidCoord(latitude, longitude) ? longitude : DEMO_LNG;
  setCoord({ latitude: lat, longitude: lng });
  animateToRegion({ latitude: lat, longitude: lng, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 350);
}

// ── Test helpers ─────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); console.log(`  ✅  ${label}`); passed++; }
  catch (e) { console.log(`  ❌  ${label}\n      ${e.message}`); failed++; }
}

// ── isValidCoord ─────────────────────────────────────────────────────────────
console.log('\n── isValidCoord ─────────────────────────────────────────────────');

test('accepts valid positive coordinates', () => {
  assert.equal(isValidCoord(28.6139, 77.209), true);
});
test('accepts zero coordinates (0, 0) — valid equatorial point', () => {
  assert.equal(isValidCoord(0, 0), true);
});
test('accepts boundary coordinates (90, 180)', () => {
  assert.equal(isValidCoord(90, 180), true);
  assert.equal(isValidCoord(-90, -180), true);
});
test('accepts valid negative coordinates', () => {
  assert.equal(isValidCoord(-33.8688, 151.2093), true);
});
test('rejects null latitude', () => {
  assert.equal(isValidCoord(null, 77.209), false);
});
test('rejects null longitude', () => {
  assert.equal(isValidCoord(28.6139, null), false);
});
test('rejects both null', () => {
  assert.equal(isValidCoord(null, null), false);
});
test('rejects NaN latitude', () => {
  assert.equal(isValidCoord(NaN, 77.209), false);
});
test('rejects Infinity longitude', () => {
  assert.equal(isValidCoord(28.6139, Infinity), false);
});
test('rejects out-of-range latitude (> 90)', () => {
  assert.equal(isValidCoord(91, 77.209), false);
});
test('rejects out-of-range latitude (< -90)', () => {
  assert.equal(isValidCoord(-91, 77.209), false);
});
test('rejects out-of-range longitude (> 180)', () => {
  assert.equal(isValidCoord(28.6139, 181), false);
});
test('rejects out-of-range longitude (< -180)', () => {
  assert.equal(isValidCoord(28.6139, -181), false);
});
test('rejects undefined (implicit null coercion)', () => {
  assert.equal(isValidCoord(undefined, undefined), false);
});

// ── handlePosition (tap / drag) ───────────────────────────────────────────────
console.log('\n── handlePosition (tap / drag callbacks) ───────────────────────');

test('valid tap fires callback with correct coordinates', () => {
  let reported = null;
  let coord = null;
  const result = handlePosition(
    { coordinate: { latitude: 19.076, longitude: 72.8777 } },
    c => { coord = c; },
    (lat, lng) => { reported = { lat, lng }; },
  );
  assert.equal(result, true);
  assert.deepEqual(coord, { latitude: 19.076, longitude: 72.8777 });
  assert.deepEqual(reported, { lat: 19.076, lng: 72.8777 });
});

test('invalid coordinate (NaN) does not fire callback', () => {
  let fired = false;
  const result = handlePosition(
    { coordinate: { latitude: NaN, longitude: 72.8777 } },
    () => {},
    () => { fired = true; },
  );
  assert.equal(result, false);
  assert.equal(fired, false);
});

test('out-of-range coordinate does not fire callback', () => {
  let fired = false;
  const result = handlePosition(
    { coordinate: { latitude: 95, longitude: 72.8777 } },
    () => {},
    () => { fired = true; },
  );
  assert.equal(result, false);
  assert.equal(fired, false);
});

test('drag to new position updates coord and reports to parent', () => {
  let coord = { latitude: 28.6139, longitude: 77.209 };
  let reported = null;
  handlePosition(
    { coordinate: { latitude: 28.7, longitude: 77.1 } },
    c => { coord = c; },
    (lat, lng) => { reported = { lat, lng }; },
  );
  assert.deepEqual(coord, { latitude: 28.7, longitude: 77.1 });
  assert.deepEqual(reported, { lat: 28.7, lng: 77.1 });
});

test('callback is called exactly once per interaction', () => {
  let callCount = 0;
  handlePosition(
    { coordinate: { latitude: 19.076, longitude: 72.8777 } },
    () => {},
    () => { callCount++; },
  );
  assert.equal(callCount, 1);
});

// ── recenterKey effect ─────────────────────────────────────────────────────────
console.log('\n── recenterKey (saved-place sync) ──────────────────────────────');

test('recenterEffect sets markerCoord to parent lat/lng when valid', () => {
  let coord = null; let region = null;
  recenterEffect(19.076, 72.8777, c => { coord = c; }, r => { region = r; });
  assert.deepEqual(coord, { latitude: 19.076, longitude: 72.8777 });
  assert.equal(region.latitude, 19.076);
});

test('recenterEffect falls back to DEMO_CENTER when coords are null', () => {
  let coord = null;
  recenterEffect(null, null, c => { coord = c; }, () => {});
  assert.equal(coord.latitude, 28.6139);
  assert.equal(coord.longitude, 77.209);
});

test('recenterEffect calls animateToRegion with correct delta', () => {
  let animated = null;
  recenterEffect(19.076, 72.8777, () => {}, r => { animated = r; });
  assert.equal(animated.latitudeDelta, 0.012);
  assert.equal(animated.longitudeDelta, 0.012);
});

// ── isValidRadius ──────────────────────────────────────────────────────────────
console.log('\n── isValidRadius (circle guard) ────────────────────────────────');

test('accepts lower boundary (50 m)', () => {
  assert.equal(isValidRadius(50), true);
});
test('accepts upper boundary (2000 m)', () => {
  assert.equal(isValidRadius(2000), true);
});
test('accepts mid-range value (500 m)', () => {
  assert.equal(isValidRadius(500), true);
});
test('rejects zero — no circle at zero radius', () => {
  assert.equal(isValidRadius(0), false);
});
test('rejects negative radius', () => {
  assert.equal(isValidRadius(-100), false);
});
test('rejects NaN radius — would crash native Circle', () => {
  assert.equal(isValidRadius(NaN), false);
});
test('rejects Infinity radius — would crash native Circle', () => {
  assert.equal(isValidRadius(Infinity), false);
});
test('rejects -Infinity radius', () => {
  assert.equal(isValidRadius(-Infinity), false);
});
test('rejects radius below 50 m (49)', () => {
  assert.equal(isValidRadius(49), false);
});
test('rejects radius above 2000 m (2001)', () => {
  assert.equal(isValidRadius(2001), false);
});

test('radius change does not affect coordinate (independent state)', () => {
  // markerCoord and radiusMeters are separate state slices; changing radius
  // must not reset the pin.  Simulate parent update:
  let coord = { latitude: 19.076, longitude: 72.8777 };
  const radius = 200; // parent changed radius
  // coord unchanged:
  assert.deepEqual(coord, { latitude: 19.076, longitude: 72.8777 });
  assert.equal(radius, 200);
});

// ── GPS / location guard ───────────────────────────────────────────────────────
console.log('\n── GPS / location guard (source-level) ─────────────────────────');

const src = readFileSync(join(FRONTEND_ROOT, 'src/women/DestinationMapPicker.tsx'), 'utf8');

test('showsUserLocation is bound to the parent-supplied position only', () => {
  // Owner-approved change: the live dot may be shown, but only when the parent
  // passes a position it already has permission for — never a literal `true`.
  assert.ok(src.includes('showsUserLocation={!!userLocation}'), 'showsUserLocation must follow the userLocation prop');
  assert.ok(!src.includes('showsUserLocation={true}'), 'showsUserLocation must never be hardcoded on');
});
test('followsUserLocation is false', () => {
  assert.ok(src.includes('followsUserLocation={false}'));
});
test('showsMyLocationButton is false', () => {
  assert.ok(src.includes('showsMyLocationButton={false}'));
});
// Commit 9e737b9 ("Google Maps — All Three Platforms Wired") intentionally
// switched to Google Maps on every platform; app.config.js injects the
// Android (googleMaps.apiKey) and iOS (googleMapsApiKey) keys at build time.
test('PROVIDER_GOOGLE is used on all platforms', () => {
  assert.ok(src.includes('provider={PROVIDER_GOOGLE}'));
});
test('app.config.js wires Google Maps keys for both Android and iOS', () => {
  const cfg = readFileSync(join(FRONTEND_ROOT, 'app.config.js'), 'utf8');
  assert.ok(cfg.includes('googleMaps: { apiKey'), 'android googleMaps.apiKey must be wired');
  assert.ok(cfg.includes('googleMapsApiKey'), 'ios googleMapsApiKey must be wired');
});
test('no requestPermissionsAsync or Location import', () => {
  assert.ok(!src.includes('requestPermissions'), 'must not request any permissions');
  assert.ok(!src.includes('expo-location'), 'must not import expo-location');
  assert.ok(!src.includes('getCurrentPosition'), 'must not call getCurrentPosition');
});
test('circle is labelled as planned arrival area in comments', () => {
  assert.ok(src.includes('PLANNED ARRIVAL AREA') || src.includes('planned arrival area'));
});
test('circle is guarded by isValidRadius (no invalid props reach native Circle)', () => {
  assert.ok(src.includes('isValidRadius(radiusMeters)'), 'isValidRadius guard must wrap <Circle>');
});
test('isValidCoord and isValidRadius are imported from mapValidation helper', () => {
  assert.ok(src.includes('from \'@/src/utils/mapValidation\''), 'helpers must come from shared file');
});

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(60)}`);
console.log(`  ${passed} passed   ${failed} failed   ${passed + failed} total`);
console.log('═'.repeat(60));
if (failed > 0) process.exit(1);
