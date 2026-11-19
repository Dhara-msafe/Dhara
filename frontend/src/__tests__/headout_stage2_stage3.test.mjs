// headout_stage2_stage3.test.mjs
//
// Source-level wiring checks for Stages 2 and 3 of the Head Out demo.
//
// Stage 2 — UI gaps:
//   (a) radius.tsx   : map, GPS accuracy note, arrival note, disclaimer
//   (b) circle.tsx   : "What will they receive?" section heading
//   (c) index.tsx    : "Not there yet" side-by-side with "I arrived"
//
// Stage 3 — Demo simulator:
//   index.tsx: HEADOUT_DEMO_ENABLED flag, demo banner, four control buttons,
//              GPS override, auto-consent, four demo handlers
//
// Run:  node frontend/src/__tests__/headout_stage2_stage3.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

function read(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

const radius = read('app/women/head-out/radius.tsx');
const circle = read('app/women/head-out/circle.tsx');
const index  = read('app/women/head-out/index.tsx');

// ══════════════════════════════════════════════════════════════════════════════
// STAGE 2(a) — radius.tsx
// ══════════════════════════════════════════════════════════════════════════════

test('S2A-01: radius.tsx imports DestinationMapPicker', () => {
  assert.match(
    radius,
    /import\s+\{[^}]*DestinationMapPicker[^}]*\}\s+from/,
    'radius.tsx must import DestinationMapPicker',
  );
});

test('S2A-02: radius.tsx renders a DestinationMapPicker with testID="headout-radius-map"', () => {
  assert.match(radius, /testID\s*=\s*["']headout-radius-map["']/, 'map testID must be headout-radius-map');
});

test('S2A-03: radius.tsx passes radiusMeters to the map (live-binding circle)', () => {
  assert.match(
    radius,
    /radiusMeters\s*=\s*\{radiusMeters\}/,
    'radiusMeters prop must be bound to the local radiusMeters state so the circle updates live',
  );
});

test('S2A-04: radius.tsx shows "GPS accuracy: ~10–25 metres"', () => {
  assert.match(radius, /GPS accuracy/, 'GPS accuracy line must appear');
  assert.match(radius, /10[–\-]25\s*met/, 'GPS accuracy range must be 10–25 m');
});

test('S2A-05: radius.tsx shows "We will consider you arrived when you enter this area"', () => {
  assert.match(
    radius,
    /We will consider you arrived when you enter this area/,
    'arrival note must appear verbatim',
  );
});

test('S2A-06: radius.tsx shows the disclaimer note about safety guarantee', () => {
  assert.match(
    radius,
    /Arrival zone is not a safety guarantee/,
    'disclaimer must mention "Arrival zone is not a safety guarantee"',
  );
  assert.match(
    radius,
    /check in based on your situation/,
    'disclaimer must end with "check in based on your situation"',
  );
});

test('S2A-07: radius.tsx uses a stable noopPositionChange (not an inline useCallback)', () => {
  assert.match(
    radius,
    /noopPositionChange\s*=\s*useCallback/,
    'No-op callback must be declared with useCallback before the conditional return',
  );
  assert.doesNotMatch(
    radius,
    /onPositionChange=\{useCallback/,
    'useCallback must NOT be called inline inside JSX (hooks-rules violation)',
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// STAGE 2(b) — circle.tsx
// ══════════════════════════════════════════════════════════════════════════════

test('S2B-01: circle.tsx renders "What will they receive?" heading', () => {
  assert.match(
    circle,
    /What will they receive\?/,
    'circle.tsx must render the section heading "What will they receive?"',
  );
});

test('S2B-02: "What will they receive?" is gated on accepted.length > 0', () => {
  assert.match(
    circle,
    /accepted\.length\s*>\s*0/,
    '"What will they receive?" must only appear when there are accepted recipients',
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// STAGE 2(c) — index.tsx arrived card
// ══════════════════════════════════════════════════════════════════════════════

test('S2C-01: index.tsx "I arrived" and "Not there yet" share a row container', () => {
  assert.match(
    index,
    /styles\.arrivedBtnRow/,
    'arrived card must use an arrivedBtnRow container for side-by-side layout',
  );
});

test('S2C-02: "Not there yet" is a Pressable with testID="headout-not-here-yet"', () => {
  assert.match(
    index,
    /testID\s*=\s*["']headout-not-here-yet["']/,
    '"Not there yet" must keep its testID',
  );
  // Verify it's inside the arrivedBtnRow block (appears after arrivedBtnRow in source)
  const rowIdx = index.indexOf('arrivedBtnRow');
  const notYetIdx = index.indexOf('headout-not-here-yet');
  assert.ok(rowIdx < notYetIdx, '"Not there yet" must appear inside the arrivedBtnRow section');
});

test('S2C-03: arrivedBtnRow and arrivedHalf styles are defined', () => {
  assert.match(index, /arrivedBtnRow\s*:/, 'arrivedBtnRow style must be defined');
  assert.match(index, /arrivedHalf\s*:/, 'arrivedHalf style must be defined');
});

test('S2C-04: outlineNavyBtn style is defined for the "Not there yet" button', () => {
  assert.match(index, /outlineNavyBtn\s*:/, 'outlineNavyBtn style must be defined');
});

// ══════════════════════════════════════════════════════════════════════════════
// STAGE 3 — Demo simulator
// ══════════════════════════════════════════════════════════════════════════════

test('S3-01: HEADOUT_DEMO_ENABLED flag is declared from EXPO_PUBLIC_HEADOUT_DEMO', () => {
  assert.match(
    index,
    /HEADOUT_DEMO_ENABLED\s*=\s*process\.env\.EXPO_PUBLIC_HEADOUT_DEMO\s*===\s*['"]true['"]/,
    'HEADOUT_DEMO_ENABLED must read EXPO_PUBLIC_HEADOUT_DEMO',
  );
});

test('S3-02: DEMO_ROUTE_WAYPOINTS are defined at module level', () => {
  assert.match(index, /DEMO_ROUTE_WAYPOINTS/, 'waypoints array must be defined');
  assert.match(index, /17\.4652.*78\.3488/, 'Main Gate coordinates must be present');
});

test('S3-03: DEMO_OFF_ROUTE_POINTS are defined at module level', () => {
  assert.match(index, /DEMO_OFF_ROUTE_POINTS/, 'off-route points array must be defined');
  assert.match(index, /17\.4680.*78\.3450/, 'first off-route point must be present');
});

test('S3-04: demoGpsPoint state is declared', () => {
  assert.match(index, /demoGpsPoint,\s*setDemoGpsPoint/, 'demoGpsPoint state must exist');
  assert.match(index, /useState.*null.*demoGpsPoint|demoGpsPoint.*useState.*null/s, '');
});

test('S3-05: demoIntervalRef is declared and cleaned up on unmount', () => {
  assert.match(index, /demoIntervalRef\s*=\s*useRef/, 'demoIntervalRef must be declared');
  assert.match(index, /clearInterval\(demoIntervalRef\.current\)/, 'interval must be cleared');
});

test('S3-06: gps is derived from realGps with demo override', () => {
  assert.match(index, /const\s+realGps\s*=\s*useJourneyGPS/, 'useJourneyGPS must be stored as realGps');
  assert.match(
    index,
    /HEADOUT_DEMO_ENABLED\s*&&\s*demoGpsPoint/,
    'gps override must be gated on HEADOUT_DEMO_ENABLED && demoGpsPoint',
  );
});

test('S3-07: demo banner testID="headout-demo-banner" is rendered', () => {
  assert.match(index, /testID\s*=\s*["']headout-demo-banner["']/, 'demo banner must have its testID');
});

test('S3-08: banner text says "Demo mode" and "nothing is sent"', () => {
  assert.match(index, /Demo mode/, 'banner must say "Demo mode"');
  assert.match(index, /nothing is sent/, 'banner must say "nothing is sent"');
});

test('S3-09: four demo control buttons have the right testIDs', () => {
  assert.match(index, /testID\s*=\s*["']headout-demo-start-route["']/, 'Start route button');
  assert.match(index, /testID\s*=\s*["']headout-demo-enter-zone["']/, 'Enter arrival zone button');
  assert.match(index, /testID\s*=\s*["']headout-demo-off-route["']/, 'Go off route button');
  assert.match(index, /testID\s*=\s*["']headout-demo-miss-checkin["']/, 'Miss check-in button');
});

test('S3-10: banner is gated on HEADOUT_DEMO_ENABLED', () => {
  const bannerIdx  = index.indexOf('headout-demo-banner');
  const demoFlag   = index.lastIndexOf('HEADOUT_DEMO_ENABLED', bannerIdx);
  assert.ok(demoFlag > -1 && demoFlag < bannerIdx, 'banner JSX must be inside {HEADOUT_DEMO_ENABLED && ...}');
});

test('S3-11: auto-consent useEffect sets locationConsentGiven when HEADOUT_DEMO_ENABLED', () => {
  assert.match(
    index,
    /HEADOUT_DEMO_ENABLED.*setLocationConsentGiven\(true\)|setLocationConsentGiven\(true\).*HEADOUT_DEMO_ENABLED/s,
    'auto-consent effect must call setLocationConsentGiven(true) when HEADOUT_DEMO_ENABLED',
  );
});

test('S3-12: handleDemoStartRoute steps through DEMO_ROUTE_WAYPOINTS via setInterval', () => {
  assert.match(index, /handleDemoStartRoute\s*=\s*useCallback/, 'handler must exist');
  assert.match(index, /DEMO_ROUTE_WAYPOINTS\[idx\]/, 'handler must index into DEMO_ROUTE_WAYPOINTS');
  assert.match(index, /setInterval\(advance/, 'handler must use setInterval to step through waypoints');
});

test('S3-13: handleDemoEnterZone sets GPS to session.latitude/longitude', () => {
  assert.match(index, /handleDemoEnterZone\s*=\s*useCallback/, 'handler must exist');
  assert.match(
    index,
    /latitude:\s*session\.latitude.*longitude:\s*session\.longitude/s,
    'enter-zone handler must use the session destination coordinates',
  );
});

test('S3-14: handleDemoGoOffRoute fires DEMO_OFF_ROUTE_POINTS with staggered timeouts', () => {
  assert.match(index, /handleDemoGoOffRoute\s*=\s*useCallback/, 'handler must exist');
  assert.match(index, /DEMO_OFF_ROUTE_POINTS\.forEach/, 'handler must iterate off-route points');
  assert.match(index, /setTimeout.*i \* 300|300.*i/s, 'handler must stagger updates by 300 ms');
});

test('S3-15: handleDemoMissCheckIn backdates the session startTime', () => {
  assert.match(index, /handleDemoMissCheckIn\s*=\s*useCallback/, 'handler must exist');
  assert.match(
    index,
    /startTime:\s*Date\.now\(\)\s*-\s*\(session\.durationMins/,
    'handler must backdate startTime so the timer expires immediately',
  );
});

test('S3-16: demo styles are defined (demoBanner, demoBtn, demoBtnTxt)', () => {
  assert.match(index, /demoBanner\s*:/, 'demoBanner style must be defined');
  assert.match(index, /demoBtn\s*:/, 'demoBtn style must be defined');
  assert.match(index, /demoBtnTxt\s*:/, 'demoBtnTxt style must be defined');
});

test('S3-17: HEADOUT_DEMO_ENABLED is false by default (env var absent → false)', () => {
  assert.match(
    index,
    /EXPO_PUBLIC_HEADOUT_DEMO.*===.*['"]true['"]/,
    'flag must be a strict equality check so absent/undefined → false',
  );
});
