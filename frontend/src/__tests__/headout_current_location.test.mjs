// headout_current_location.test.mjs
//
// Source-level wiring checks for the "Use my current location" feature added to
// Head Out destination screen (Step 1) — destination.tsx.
//
// All checks read the TypeScript source as plain text; no React rendering or
// device APIs required. Pattern mirrors b126_typed_destination_geocode.test.mjs.
//
// Run:  node frontend/src/__tests__/headout_current_location.test.mjs

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

// ── CL-01: useLivePosition is imported ──────────────────────────────────────
test('CL-01: useLivePosition is imported from @/src/women/useLivePosition', () => {
  assert.match(
    src,
    /import\s+\{[^}]*useLivePosition[^}]*\}\s+from\s+['"]@\/src\/women\/useLivePosition['"]/,
    'destination.tsx must import useLivePosition',
  );
});

// ── CL-02: hook is initialised inside the component ─────────────────────────
test('CL-02: useLivePosition hook is called and stored in "live"', () => {
  assert.match(
    src,
    /const\s+live\s*=\s*useLivePosition\(\)/,
    'destination.tsx must call useLivePosition() and store the result in "live"',
  );
});

// ── CL-03: resumeIfAlreadyGranted is called on mount ────────────────────────
test('CL-03: live.resumeIfAlreadyGranted() is called in a mount-only useEffect', () => {
  assert.match(
    src,
    /live\.resumeIfAlreadyGranted\(\)/,
    'destination.tsx must call live.resumeIfAlreadyGranted()',
  );
  // The call must appear inside a useEffect with an empty deps array.
  assert.match(
    src,
    /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[^}]*live\.resumeIfAlreadyGranted\(\)[^}]*\}\s*,\s*\[\s*\]\s*\)/,
    'live.resumeIfAlreadyGranted() must be called inside useEffect(..., [])',
  );
});

// ── CL-04: button with correct testID is rendered ───────────────────────────
test('CL-04: "Use my current location" button has testID="headout-dest-use-my-location"', () => {
  assert.match(
    src,
    /testID\s*=\s*["']headout-dest-use-my-location["']/,
    'destination.tsx must render an element with testID="headout-dest-use-my-location"',
  );
});

// ── CL-05: button calls live.request() ──────────────────────────────────────
test('CL-05: the location button calls live.request()', () => {
  assert.match(
    src,
    /live\.request\(\)/,
    'destination.tsx must call live.request() when the user taps the location button',
  );
});

// ── CL-06: userLocation prop is passed to DestinationMapPicker ──────────────
test('CL-06: userLocation={live.point} is passed to DestinationMapPicker', () => {
  assert.match(
    src,
    /userLocation\s*=\s*\{live\.point\}/,
    'destination.tsx must pass userLocation={live.point} to DestinationMapPicker',
  );
});

// ── CL-07: auto-recenter guards — no override when user has acted ────────────
test('CL-07: auto-recenter only fires when label is empty and no pin has been placed', () => {
  // The effect must check value.label before bumping the key.
  assert.match(
    src,
    /value\.label\.trim\(\)\s*!==\s*['"]{2}/,
    'auto-recenter effect must bail out when value.label is non-empty',
  );
  // The effect must also check that no pin is placed (latitude != null).
  assert.match(
    src,
    /value\.latitude\s*!=\s*null/,
    'auto-recenter effect must bail out when value.latitude is already set',
  );
});

// ── CL-08: liveAutoRecenteredRef prevents re-recentering after first fix ─────
test('CL-08: liveAutoRecenteredRef prevents repeated auto-recentering', () => {
  assert.match(
    src,
    /liveAutoRecenteredRef\s*=\s*useRef\(false\)/,
    'destination.tsx must declare liveAutoRecenteredRef = useRef(false)',
  );
  assert.match(
    src,
    /liveAutoRecenteredRef\.current\s*=\s*true/,
    'auto-recenter effect must set liveAutoRecenteredRef.current = true after firing',
  );
});

// ── CL-09: status text for 'asking' state ───────────────────────────────────
test('CL-09: "Getting your location" status text is shown when status=asking', () => {
  assert.match(
    src,
    /live\.status\s*===\s*['"]asking['"]/,
    'destination.tsx must handle live.status === "asking"',
  );
  assert.match(
    src,
    /Getting your location/,
    'destination.tsx must display a "Getting your location" message when asking',
  );
});

// ── CL-10: status text for 'denied' state ───────────────────────────────────
test('CL-10: denied status shows a message offering to try again', () => {
  assert.match(
    src,
    /live\.status\s*===\s*['"]denied['"]/,
    'destination.tsx must handle live.status === "denied"',
  );
  assert.match(
    src,
    /[Dd]enied/,
    'destination.tsx must surface a "denied" message to the user',
  );
});

// ── CL-11: status text for 'blocked' state + settings button ────────────────
test('CL-11: blocked status shows an "Open settings" button (native only via live.canOpenSettings)', () => {
  assert.match(
    src,
    /live\.status\s*===\s*['"]blocked['"]/,
    'destination.tsx must handle live.status === "blocked"',
  );
  assert.match(
    src,
    /live\.openSettings\(\)/,
    'destination.tsx must call live.openSettings() from the blocked UI',
  );
  assert.match(
    src,
    /live\.canOpenSettings/,
    'Open settings button must be gated on live.canOpenSettings (native only)',
  );
  assert.match(
    src,
    /testID\s*=\s*["']headout-dest-open-settings["']/,
    '"Open settings" button must have testID="headout-dest-open-settings"',
  );
});

// ── CL-12: status text for 'unavailable' state ──────────────────────────────
test('CL-12: unavailable status shows a plain message', () => {
  assert.match(
    src,
    /live\.status\s*===\s*['"]unavailable['"]/,
    'destination.tsx must handle live.status === "unavailable"',
  );
  assert.match(
    src,
    /not available/i,
    'destination.tsx must surface a "not available" message for unavailable state',
  );
});

// ── CL-13: B-126 guard — existing handleNext geocode fallback still present ──
test('CL-13 (B-126 guard): handleNext still geocodes a typed, coordinate-less destination', () => {
  const nextStart = src.indexOf('const handleNext');
  assert.ok(nextStart > -1, 'destination.tsx must still define handleNext');
  const handleNext = src.slice(nextStart, src.indexOf('return (', nextStart));
  assert.match(
    handleNext,
    /final\.latitude\s*==\s*null\s*\|\|\s*final\.longitude\s*==\s*null/,
    'handleNext must still check for missing coordinates (B-126 fix must not be removed)',
  );
});

// ── CL-14: no GPS flag or upload code touched ───────────────────────────────
test('CL-14: GPS upload env flag (GO1B_GPS) is not referenced in destination.tsx', () => {
  assert.doesNotMatch(
    src,
    /GO1B_GPS/,
    'destination.tsx must not reference the journey GPS upload flag',
  );
});
