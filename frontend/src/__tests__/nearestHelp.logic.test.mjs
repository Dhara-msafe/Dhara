/**
 * Nearest Help — logic-layer tests (no React, no native modules).
 *
 * Tests the pure helpers extracted from app/women/nearest-help.tsx:
 * distance formatting and the in-app-search vs. external-Maps-fallback
 * decision (fail-closed whenever location/backend-flag/results aren't
 * available — never a dead end).
 * Run with: node --experimental-strip-types src/__tests__/nearestHelp.logic.test.mjs
 *
 * These tests exercise the pure-logic layer only. Live Google Places
 * responses, actual geolocation permission prompts, and the dialler/Maps
 * hand-off itself are NOT RUN here — see backend/tests/test_nearest_help_places.py
 * for the live-endpoint contract, and the manual browser-preview pass done
 * alongside this feature's implementation for the real fallback behaviour.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Copied from app/women/nearest-help.tsx — kept in sync manually, same
// convention destinationMapPicker.logic.test.mjs already uses for its
// handlePosition/recenterEffect simulations (no bundler available to import
// a .tsx file with RN imports directly into a plain Node script). ──────────
function formatDistance(m) {
  if (m == null) return null;
  return m < 1000 ? `${m} m away` : `${(m / 1000).toFixed(1)} km away`;
}

/** Mirrors handleSelect's branching in nearest-help.tsx: Sakhi OSC uses Text
 * Search regardless of location (bias-only); police/hospital require a
 * resolved device location before Nearby Search is even attempted. */
function resolveSearchResults(category, loc, placesResults, nearbyResults) {
  if (category === 'osc') return placesResults;
  if (loc) return nearbyResults;
  return [];
}

/** Mirrors handleSelect's final fail-closed decision: zero results (for any
 * reason — no location, feature off, network error, genuinely zero nearby
 * places) means fall back to the pre-existing external-Maps action, never a
 * dead screen. */
function decideOutcome(found) {
  return found.length === 0 ? { action: 'openMap' } : { action: 'showResults', results: found };
}

// ── Test helpers ─────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); console.log(`  ✅  ${label}`); passed++; }
  catch (e) { console.log(`  ❌  ${label}\n      ${e.message}`); failed++; }
}

// ── formatDistance ───────────────────────────────────────────────────────────
console.log('\n── formatDistance ───────────────────────────────────────────────');

test('null distance renders nothing', () => {
  assert.equal(formatDistance(null), null);
});
test('sub-kilometre distance renders in metres', () => {
  assert.equal(formatDistance(850), '850 m away');
});
test('boundary at 999 m stays in metres', () => {
  assert.equal(formatDistance(999), '999 m away');
});
test('boundary at exactly 1000 m switches to km', () => {
  assert.equal(formatDistance(1000), '1.0 km away');
});
test('multi-kilometre distance rounds to one decimal', () => {
  assert.equal(formatDistance(4200), '4.2 km away');
});
test('zero distance (colocated) still renders, not treated as null', () => {
  assert.equal(formatDistance(0), '0 m away');
});

// ── resolveSearchResults (per-category gating) ──────────────────────────────
console.log('\n── resolveSearchResults (location gating per category) ─────────');

test('police/hospital with no device location never attempts Nearby Search', () => {
  const result = resolveSearchResults('police', null, [], [{ name: 'should not appear' }]);
  assert.deepEqual(result, []);
});
test('police/hospital with a resolved location uses Nearby Search results', () => {
  const nearby = [{ name: 'Local police station' }];
  const result = resolveSearchResults('hospital', { lat: 19.07, lng: 72.87 }, [], nearby);
  assert.deepEqual(result, nearby);
});
test('Sakhi OSC uses Text Search regardless of location availability', () => {
  const places = [{ name: 'Sakhi OSC' }];
  assert.deepEqual(resolveSearchResults('osc', null, places, []), places);
  assert.deepEqual(resolveSearchResults('osc', { lat: 19.07, lng: 72.87 }, places, []), places);
});

// ── decideOutcome (fail-closed to external Maps) ────────────────────────────
console.log('\n── decideOutcome (fail-closed, never a dead end) ───────────────');

test('zero results falls back to external Maps, not an empty screen', () => {
  assert.deepEqual(decideOutcome([]), { action: 'openMap' });
});
test('any results at all show the in-app results list', () => {
  const found = [{ name: 'A place' }];
  assert.deepEqual(decideOutcome(found), { action: 'showResults', results: found });
});

// ── Source-level guards ──────────────────────────────────────────────────────
console.log('\n── Source-level guards ──────────────────────────────────────────');

const src = readFileSync(join(__dirname, '../../app/women/nearest-help.tsx'), 'utf8');

test('never claims results are officially verified government facilities', () => {
  assert.ok(!/officially verified/i.test(src), 'review explicitly warns against this framing');
});
test('calling uses the outbound-guarded openPhone helper, not a raw dialler call', () => {
  assert.ok(src.includes("import { openPhone } from '@/src/women/helpActions'"));
  assert.ok(!src.includes('Linking.openURL'), 'must route through outbound.ts, not call Linking directly');
});
// N-01/B-39: this assertion used to pin 112 to the old static/disabled
// display (EmergencyNumberStatic), written against a stale pre-0bbafb4
// branch. That component was deleted on 2026-11-07 when the dialler was
// intentionally restored here (same direction as B-02 / N-10 app-wide), but
// the import lingered as dead code pointing at a file that no longer
// exists — breaking the bundle — while this test kept "passing" because it
// only substring-matched the import line, never checked it was rendered.
// Asserting the real, current contract instead: 112 calls the live dialler
// through the outbound-guarded helper, and the deleted component is gone
// for good, not reintroduced.
test('112 calls the real dialler via the outbound-guarded openPhone helper', () => {
  assert.ok(/onPress=\{async \(\) => setStatus\(await openPhone\('112'\)\)\}/.test(src));
});
test('does not reintroduce the deleted static/disabled emergency display', () => {
  assert.ok(!src.includes('EmergencyNumberStatic'));
  assert.ok(!src.includes('EmergencyNotActiveNotice'));
});
test('manual "search in Maps instead" fallback is still present alongside results', () => {
  assert.ok(src.includes('nearest-help-manual-search'));
});

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(60)}`);
console.log(`  ${passed} passed   ${failed} failed   ${passed + failed} total`);
console.log('═'.repeat(60));
if (failed > 0) process.exit(1);
