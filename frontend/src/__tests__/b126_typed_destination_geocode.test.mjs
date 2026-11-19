// B-126 (19 Nov 2026): "Head Out: typed destination saves no coordinates, so
// the active journey shows 'Map unavailable' and no route."
//
// Typing in the destination box deliberately CLEARS latitude/longitude (so a
// stale pin can never contradict the typed words), and Next only requires a
// non-empty label. A journey started from a typed destination therefore
// reached the backend with destination_lat/lng = null, and the active-journey
// screen hid the route map (hasDestCoord false). Seen live by the owner on
// the web preview, 19 Nov 2026: destination "hyderabad", "Map unavailable".
//
// The fix: handleNext resolves a typed, coordinate-less label through the
// free OSM endpoint (/api/geocode/search — no flag, no key) that this screen
// already uses for suggestions, attaching the top match's coordinates.
// Best-effort only: on no match or network failure the journey still starts
// text-only, exactly as before.
//
// Source-level wiring checks — this is a React Native screen with RN/Expo
// imports and can't be executed directly in this test runner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  join(here, '..', '..', 'app', 'women', 'head-out', 'destination.tsx'),
  'utf8',
);
const nextStart = src.indexOf('const handleNext');
assert.ok(nextStart > -1, 'destination.tsx must still define handleNext');
const handleNext = src.slice(nextStart, src.indexOf('return (', nextStart));

test('B-126: handleNext geocodes a typed destination that has no coordinates', () => {
  assert.match(
    handleNext,
    /final\.latitude\s*==\s*null\s*\|\|\s*final\.longitude\s*==\s*null/,
    'handleNext must check for missing coordinates before continuing',
  );
  assert.match(
    handleNext,
    /fetchOsmSuggestions\(\s*base\s*,\s*final\.label\s*\)/,
    'handleNext must resolve the typed label through the existing OSM helper',
  );
});

test('B-126: the fallback is best-effort — a text-only journey still starts', () => {
  const afterFallback = handleNext.slice(handleNext.indexOf('fetchOsmSuggestions('));
  assert.match(
    afterFallback,
    /setDraft\(final\)/,
    'setDraft must still run after the fallback',
  );
  const between = afterFallback.slice(0, afterFallback.indexOf('setDraft(final)'));
  assert.doesNotMatch(
    between,
    /return\s*;/,
    'no early return may stop a text-only journey from starting when geocoding fails',
  );
});

test('B-126 guard: typing still clears coordinates (stale-pin protection stays)', () => {
  assert.match(
    src,
    /savedPlaceId:\s*undefined,\s*latitude:\s*null,\s*longitude:\s*null/,
    'the typing handler must keep clearing coordinates so a stale pin never contradicts the words',
  );
});

test('B-126 guard: Next still only requires a label (text-only journeys stay allowed)', () => {
  assert.match(
    src,
    /const canContinue = value\.label\.trim\(\)\.length > 0;/,
    'canContinue must not start demanding coordinates — the fallback, not a blocker, is the fix',
  );
});
