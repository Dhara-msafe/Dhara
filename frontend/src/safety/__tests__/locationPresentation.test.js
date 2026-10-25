/**
 * Focused unit tests for locationPresentation.ts
 *
 * Run via compiled JS:
 *   cd /app/frontend
 *   ./node_modules/.bin/tsc --module commonjs --target es2017 --esModuleInterop true \
 *       --skipLibCheck true --outDir /tmp/lp_out src/safety/locationPresentation.ts
 *   node src/safety/__tests__/locationPresentation.test.js
 *
 * Uses only Node.js built-in assert — no test framework installed.
 */
'use strict';

const assert = require('assert');
const path = require('path');

// Load compiled output produced by the tsc invocation above.
const { formatLocationFix } = require('/tmp/lp_out/locationPresentation.js');

// Reference: known OLC for Zurich city centre
// encode(47.365590, 8.524997) → "8FVC9G8F+6X"
// encode(0, 0)               → "6FG22222+22"
// Decoded 8FVC9G8F+6X latCenter ≈ 47.36556, lngCenter ≈ 8.52493

const NOW = new Date('2025-06-01T12:00:00Z');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  PASS', name);
    passed++;
  } catch (e) {
    console.error('  FAIL', name, '\n      ', e.message);
    failed++;
  }
}

console.log('\n=== locationPresentation unit tests ===\n');

// ── 1. Valid full Plus Code output using known reference cases ────────────────
console.log('GROUP 1: Valid Plus Code output');

test('Zurich coords produce expected Plus Code', () => {
  const r = formatLocationFix({ latitude: 47.365590, longitude: 8.524997, accuracyM: 15, capturedAt: NOW }, NOW);
  assert.ok(r.isValid, 'isValid should be true');
  assert.strictEqual(r.plusCode.length, 11, 'full Plus Code is 11 chars (10 + separator "+")');
  // OLC spec: first 4 chars encode the 20° block
  assert.ok(r.plusCode.startsWith('8FVC'), `expected prefix 8FVC, got ${r.plusCode}`);
});

test('Plus Code encodes the coordinate, not accuracy', () => {
  const r1 = formatLocationFix({ latitude: 47.365590, longitude: 8.524997, accuracyM: 5, capturedAt: NOW }, NOW);
  const r2 = formatLocationFix({ latitude: 47.365590, longitude: 8.524997, accuracyM: 9999, capturedAt: NOW }, NOW);
  assert.strictEqual(r1.plusCode, r2.plusCode, 'accuracy must not change the Plus Code');
});

test('coordinates string has 6 dp', () => {
  const r = formatLocationFix({ latitude: 47.365590, longitude: 8.524997, accuracyM: 15, capturedAt: NOW }, NOW);
  assert.match(r.coordinates, /^-?\d+\.\d{6}, -?\d+\.\d{6}$/);
});

// ── 2. Zero, invalid and boundary coordinates ────────────────────────────────
console.log('\nGROUP 2: Coordinate edge cases');

test('zero latitude and longitude are valid', () => {
  const r = formatLocationFix({ latitude: 0, longitude: 0, accuracyM: 10, capturedAt: NOW }, NOW);
  assert.ok(r.isValid, 'lat=0, lng=0 should be valid');
  assert.ok(r.plusCode.length > 0);
});

test('boundary: lat=90, lng=180', () => {
  const r = formatLocationFix({ latitude: 90, longitude: 180, accuracyM: 10, capturedAt: NOW }, NOW);
  assert.ok(r.isValid);
  assert.ok(r.plusCode.length > 0);
});

test('boundary: lat=-90, lng=-180', () => {
  const r = formatLocationFix({ latitude: -90, longitude: -180, accuracyM: 10, capturedAt: NOW }, NOW);
  assert.ok(r.isValid);
});

test('lat out of range > 90 → invalid', () => {
  const r = formatLocationFix({ latitude: 91, longitude: 0, accuracyM: 10, capturedAt: NOW }, NOW);
  assert.strictEqual(r.isValid, false);
  assert.strictEqual(r.plusCode, '');
  assert.strictEqual(r.coordinates, '');
});

test('lng out of range > 180 → invalid', () => {
  const r = formatLocationFix({ latitude: 0, longitude: 181, accuracyM: 10, capturedAt: NOW }, NOW);
  assert.strictEqual(r.isValid, false);
});

test('NaN latitude → invalid', () => {
  const r = formatLocationFix({ latitude: NaN, longitude: 0, accuracyM: 10, capturedAt: NOW }, NOW);
  assert.strictEqual(r.isValid, false);
  assert.strictEqual(r.plusCode, '');
});

test('Infinity longitude → invalid', () => {
  const r = formatLocationFix({ latitude: 0, longitude: Infinity, accuracyM: 10, capturedAt: NOW }, NOW);
  assert.strictEqual(r.isValid, false);
});

// ── 3. Accuracy edge cases ────────────────────────────────────────────────────
console.log('\nGROUP 3: Accuracy display');

test('accuracy = 0 → "Accuracy unavailable"', () => {
  const r = formatLocationFix({ latitude: 47.365590, longitude: 8.524997, accuracyM: 0, capturedAt: NOW }, NOW);
  assert.strictEqual(r.accuracy, 'Accuracy unavailable');
});

test('accuracy = null → "Accuracy unavailable"', () => {
  const r = formatLocationFix({ latitude: 47.365590, longitude: 8.524997, accuracyM: null, capturedAt: NOW }, NOW);
  assert.strictEqual(r.accuracy, 'Accuracy unavailable');
});

test('accuracy = undefined → "Accuracy unavailable"', () => {
  const r = formatLocationFix({ latitude: 47.365590, longitude: 8.524997, accuracyM: undefined, capturedAt: NOW }, NOW);
  assert.strictEqual(r.accuracy, 'Accuracy unavailable');
});

test('negative accuracy → "Accuracy unavailable"', () => {
  const r = formatLocationFix({ latitude: 47.365590, longitude: 8.524997, accuracyM: -5, capturedAt: NOW }, NOW);
  assert.strictEqual(r.accuracy, 'Accuracy unavailable');
});

test('NaN accuracy → "Accuracy unavailable"', () => {
  const r = formatLocationFix({ latitude: 47.365590, longitude: 8.524997, accuracyM: NaN, capturedAt: NOW }, NOW);
  assert.strictEqual(r.accuracy, 'Accuracy unavailable');
});

test('large accuracy 5000 m shown as-is (approximate estimate)', () => {
  const r = formatLocationFix({ latitude: 47.365590, longitude: 8.524997, accuracyM: 5000, capturedAt: NOW }, NOW);
  // Must not be silently replaced with a smaller value
  assert.strictEqual(r.accuracy, '\u00b15000 m', `got: ${r.accuracy}`);
});

test('normal accuracy 15 m → "±15 m"', () => {
  const r = formatLocationFix({ latitude: 47.365590, longitude: 8.524997, accuracyM: 15, capturedAt: NOW }, NOW);
  assert.strictEqual(r.accuracy, '\u00b115 m');
});

// ── 4. Timestamp / age using injected clock ───────────────────────────────────
console.log('\nGROUP 4: Timestamp and age');

const BASE = new Date('2025-06-01T12:00:00Z');

test('capturedAt = now → "just now"', () => {
  const r = formatLocationFix({ latitude: 47.365590, longitude: 8.524997, accuracyM: 15, capturedAt: BASE }, BASE);
  assert.strictEqual(r.age, 'just now');
});

test('capturedAt 5 min ago → "5 min ago"', () => {
  const captured = new Date(BASE.getTime() - 5 * 60_000);
  const r = formatLocationFix({ latitude: 47.365590, longitude: 8.524997, accuracyM: 15, capturedAt: captured }, BASE);
  assert.strictEqual(r.age, '5 min ago');
});

test('capturedAt 35 min ago → "35 min ago" — old sample must not appear fresh', () => {
  const captured = new Date(BASE.getTime() - 35 * 60_000);
  const r = formatLocationFix({ latitude: 47.365590, longitude: 8.524997, accuracyM: 15, capturedAt: captured }, BASE);
  assert.strictEqual(r.age, '35 min ago', `age was "${r.age}" — old fix must not appear newly captured`);
});

test('capturedAt 2 h ago → "2 h ago"', () => {
  const captured = new Date(BASE.getTime() - 2 * 3600_000);
  const r = formatLocationFix({ latitude: 47.365590, longitude: 8.524997, accuracyM: 15, capturedAt: captured }, BASE);
  assert.strictEqual(r.age, '2 h ago');
});

test('capturedAt 3 days ago → "3 days ago"', () => {
  const captured = new Date(BASE.getTime() - 3 * 86400_000);
  const r = formatLocationFix({ latitude: 47.365590, longitude: 8.524997, accuracyM: 15, capturedAt: captured }, BASE);
  assert.strictEqual(r.age, '3 days ago');
});

test('future capturedAt → "future timestamp"', () => {
  const future = new Date(BASE.getTime() + 60_000);
  const r = formatLocationFix({ latitude: 47.365590, longitude: 8.524997, accuracyM: 15, capturedAt: future }, BASE);
  assert.strictEqual(r.age, 'future timestamp');
});

test('capturedAt = null → age "unknown"', () => {
  const r = formatLocationFix({ latitude: 47.365590, longitude: 8.524997, accuracyM: 15, capturedAt: null }, BASE);
  assert.strictEqual(r.age, 'unknown');
  assert.strictEqual(r.capturedAtLabel, 'Unknown');
});

test('capturedAt invalid string → age "unknown", capturedAtLabel "Unknown"', () => {
  const r = formatLocationFix({ latitude: 47.365590, longitude: 8.524997, accuracyM: 15, capturedAt: 'not-a-date' }, BASE);
  assert.strictEqual(r.age, 'unknown');
  assert.strictEqual(r.capturedAtLabel, 'Unknown');
});

// ── 5. Invalid coords + valid accuracy/timestamp still returns partial data ──
console.log('\nGROUP 5: Invalid coords preserve accuracy and age fields');

test('invalid coords still returns formatted accuracy and age', () => {
  const captured = new Date(BASE.getTime() - 10 * 60_000);
  const r = formatLocationFix({ latitude: 200, longitude: 0, accuracyM: 20, capturedAt: captured }, BASE);
  assert.strictEqual(r.isValid, false);
  assert.strictEqual(r.plusCode, '');
  assert.strictEqual(r.coordinates, '');
  assert.strictEqual(r.accuracy, '\u00b120 m');   // accuracy still formatted
  assert.strictEqual(r.age, '10 min ago');         // age still computed
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
