// headout_current_location.test.mjs
//
// Source-level wiring checks for the "current location as default" feature on
// Head Out Step 1 — destination.tsx.
//
// Rules:
//  • Reads the TypeScript source as plain text; no React rendering or native
//    device APIs needed.
//  • Mirrors the style of b126_typed_destination_geocode.test.mjs.
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

// ── CL-03: live.request() is called on mount (not resumeIfAlreadyGranted) ───
test('CL-03: live.request() is auto-called on mount via useEffect(..., [])', () => {
  // Must call live.request() — not just resumeIfAlreadyGranted
  assert.match(
    src,
    /live\.request\(\)/,
    'destination.tsx must call live.request()',
  );
  // The call must be inside a mount-only useEffect (empty dependency array).
  // Allow for the eslint-disable comment that sits on the preceding line.
  assert.match(
    src,
    /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?live\.request\(\)[\s\S]*?\}\s*,\s*\[\s*\]\s*\)/,
    'live.request() must be called inside useEffect(..., []) on mount',
  );
  // resumeIfAlreadyGranted must NOT be used as the mount trigger any more
  assert.doesNotMatch(
    src,
    /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[^}]*live\.resumeIfAlreadyGranted/,
    'live.resumeIfAlreadyGranted() must no longer be the mount trigger',
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

// ── CL-05: button calls live.request() (retry path) ─────────────────────────
test('CL-05: the location button calls live.request() as a retry action', () => {
  // live.request() must appear more than once — once on mount, once in the button
  const occurrences = (src.match(/live\.request\(\)/g) ?? []).length;
  assert.ok(
    occurrences >= 2,
    `live.request() must appear at least twice (mount + button retry); found ${occurrences}`,
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

// ── CL-07: auto-place guards — no override when user has acted ───────────────
test('CL-07: auto-place only fires when label is empty and no pin has been placed', () => {
  assert.match(
    src,
    /value\.label\.trim\(\)\s*!==\s*['"]{2}/,
    'auto-place effect must bail out when value.label is non-empty',
  );
  assert.match(
    src,
    /value\.latitude\s*!=\s*null/,
    'auto-place effect must bail out when value.latitude is already set',
  );
});

// ── CL-08: liveAutoRecenteredRef prevents repeated auto-placement ────────────
test('CL-08: liveAutoRecenteredRef prevents repeated auto-placement after first fix', () => {
  assert.match(
    src,
    /liveAutoRecenteredRef\s*=\s*useRef\(false\)/,
    'destination.tsx must declare liveAutoRecenteredRef = useRef(false)',
  );
  assert.match(
    src,
    /liveAutoRecenteredRef\.current\s*=\s*true/,
    'auto-place effect must set liveAutoRecenteredRef.current = true after firing',
  );
});

// ── CL-09 (NEW): first GPS fix places the pin at the user's coordinates ──────
test('CL-09: first fix sets value.latitude/longitude from live.point (pin is placed)', () => {
  assert.match(
    src,
    /live\.point[!?]?\.latitude/,
    'auto-place effect must read live.point.latitude to set the pin',
  );
  assert.match(
    src,
    /live\.point[!?]?\.longitude/,
    'auto-place effect must read live.point.longitude to set the pin',
  );
  // setValue must be called inside the auto-place block (not just mapRecenterKey)
  const autoPlaceBlock = (() => {
    const marker = 'liveAutoRecenteredRef.current = true';
    const start = src.indexOf(marker);
    if (start === -1) return '';
    return src.slice(start, start + 300);
  })();
  assert.match(
    autoPlaceBlock,
    /setValue/,
    'auto-place effect must call setValue to place the pin at the GPS coordinates',
  );
});

// ── CL-10: 10-second timeout state and ref declared ─────────────────────────
test('CL-10: locationTimedOut state and locationTimeoutRef ref are declared', () => {
  assert.match(
    src,
    /const\s+\[locationTimedOut,\s*setLocationTimedOut\]\s*=\s*useState\(false\)/,
    'destination.tsx must declare locationTimedOut state via useState(false)',
  );
  assert.match(
    src,
    /locationTimeoutRef\s*=\s*useRef/,
    'destination.tsx must declare locationTimeoutRef via useRef',
  );
});

// ── CL-11: timeout fires after 10 000 ms ────────────────────────────────────
test('CL-11: setTimeout is configured with a 10 000 ms deadline', () => {
  assert.match(
    src,
    /setLocationTimedOut\(true\)\s*,\s*10[_]?000/,
    'destination.tsx must set a 10 000 ms (10_000) deadline for the GPS spinner',
  );
});

// ── CL-12: timeout clears when hook reaches a terminal state ─────────────────
test('CL-12: timeout is cleared and locationTimedOut reset when status is not "asking"', () => {
  assert.match(
    src,
    /live\.status\s*===\s*['"]asking['"]/,
    'terminal-state effect must guard on live.status === "asking"',
  );
  // The same effect must also call setLocationTimedOut(false) for the non-asking branch
  const terminalBlock = (() => {
    const marker = "if (live.status === 'asking') return;";
    const start = src.indexOf(marker);
    if (start === -1) return '';
    return src.slice(start, start + 300);
  })();
  assert.match(
    terminalBlock,
    /setLocationTimedOut\(false\)/,
    'terminal-state effect must call setLocationTimedOut(false) when a fix or refusal arrives',
  );
});

// ── CL-13: timeout message is shown when locationTimedOut is true ────────────
test('CL-13: "Could not get your location. Tap to retry." shown when locationTimedOut', () => {
  assert.match(
    src,
    /locationTimedOut/,
    'destination.tsx must reference locationTimedOut',
  );
  assert.match(
    src,
    /Could not get your location/,
    'destination.tsx must render the timeout message text',
  );
  assert.match(
    src,
    /Tap to retry/,
    'destination.tsx must include "Tap to retry" in the timeout message',
  );
});

// ── CL-14: spinner is gated on !locationTimedOut ─────────────────────────────
test('CL-14: ActivityIndicator spinner is hidden when locationTimedOut is true', () => {
  assert.match(
    src,
    /live\.status\s*===\s*['"]asking['"]\s*&&\s*!locationTimedOut/,
    'ActivityIndicator must be hidden when locationTimedOut=true (gated by !locationTimedOut)',
  );
});

// ── CL-15: "Getting your location" status text is similarly gated ────────────
test('CL-15: "Getting your location" status text is hidden when locationTimedOut', () => {
  assert.match(
    src,
    /Getting your location/,
    'destination.tsx must display a "Getting your location" message',
  );
  // The asking message block must include !locationTimedOut
  const askingBlock = (() => {
    const marker = 'Getting your location';
    const start = src.lastIndexOf('!locationTimedOut', src.indexOf(marker));
    return start !== -1 ? 'found' : '';
  })();
  assert.ok(
    askingBlock === 'found',
    '"Getting your location" text must be gated on !locationTimedOut',
  );
});

// ── CL-16: denied status still shows a message ───────────────────────────────
test('CL-16: denied status shows a message offering to try again', () => {
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

// ── CL-17: blocked status shows "Open settings" button (native only) ─────────
test('CL-17: blocked status shows an "Open settings" button via live.openSettings / canOpenSettings', () => {
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
    '"Open settings" button must be gated on live.canOpenSettings (native only)',
  );
  assert.match(
    src,
    /testID\s*=\s*["']headout-dest-open-settings["']/,
    '"Open settings" button must have testID="headout-dest-open-settings"',
  );
});

// ── CL-18: unavailable status shows a plain message ──────────────────────────
test('CL-18: unavailable status shows a plain message', () => {
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

// ── CL-19: B-126 guard — existing handleNext geocode fallback still present ──
test('CL-19 (B-126 guard): handleNext still geocodes a typed, coordinate-less destination', () => {
  const nextStart = src.indexOf('const handleNext');
  assert.ok(nextStart > -1, 'destination.tsx must still define handleNext');
  const handleNext = src.slice(nextStart, src.indexOf('return (', nextStart));
  assert.match(
    handleNext,
    /final\.latitude\s*==\s*null\s*\|\|\s*final\.longitude\s*==\s*null/,
    'handleNext must still check for missing coordinates (B-126 fix must not be removed)',
  );
});

// ── CL-20: no GPS upload flag touched ────────────────────────────────────────
test('CL-20: GPS upload env flag (GO1B_GPS) is not referenced in destination.tsx', () => {
  assert.doesNotMatch(
    src,
    /GO1B_GPS/,
    'destination.tsx must not reference the journey GPS upload flag',
  );
});
