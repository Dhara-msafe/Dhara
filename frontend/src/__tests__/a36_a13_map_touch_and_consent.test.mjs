// A36 part 1: the page must not scroll while she is working with the map
// (tester bug T1). A13: the consent sentence must match what the app does.
// Run: node --experimental-strip-types --test src/__tests__/a36_a13_map_touch_and_consent.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const picker = read('src/women/DestinationMapPicker.tsx');
const destination = read('app/women/head-out/destination.tsx');
const radius = read('app/women/head-out/radius.tsx');
const consent = read('src/women/DestinationPicker.tsx');
/** The file without its comment lines: what the woman can actually read. */
const consentText = consent.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

// ── A36 part 1 ───────────────────────────────────────────────────────────────

test('the map reports when a finger is on it', () => {
  assert.match(picker, /onInteractionChange\?: \(active: boolean\) => void/);
  assert.match(picker, /onTouchStart=\{touch\(true\)\}/);
  assert.match(picker, /onTouchEnd=\{touch\(false\)\}/);
  assert.match(picker, /onTouchCancel=\{touch\(false\)\}/);
});

test('dragging the pin holds the page too, and releases it', () => {
  assert.match(picker, /onDragStart=\{touch\(true\)\}/);
  assert.match(picker, /onDragEnd=\{\(e: any\) => \{ handleDragEnd\(e\); onInteractionChange\?\.\(false\); \}\}/);
});

test('a missing callback can never break a touch', () => {
  const fn = picker.slice(picker.indexOf('const touch ='), picker.indexOf('const touch =') + 200);
  assert.match(fn, /try \{/);
  assert.match(fn, /catch/);
});

for (const [name, src] of [['destination', destination], ['radius', radius]]) {
  test(`the ${name} screen stops scrolling while the map is held`, () => {
    assert.match(src, /const \[mapActive, setMapActive\] = useState\(false\)/);
    assert.match(src, /<ScrollView scrollEnabled=\{!mapActive\}/);
    assert.match(src, /onInteractionChange=\{setMapActive\}/);
    // exactly one map on each screen, wired once
    assert.equal((src.match(/onInteractionChange=\{setMapActive\}/g) || []).length, 1);
  });
}

test('the page scrolls normally when the map is not being touched', () => {
  // scrollEnabled is driven only by mapActive, which starts false.
  for (const src of [destination, radius]) {
    assert.doesNotMatch(src, /scrollEnabled=\{false\}/);
    assert.match(src, /useState\(false\);\n/);
  }
});

// ── A13 ──────────────────────────────────────────────────────────────────────

test('the old promise that nobody is alerted automatically is gone', () => {
  assert.doesNotMatch(consentText, /no one is alerted automatically/);
  assert.doesNotMatch(consentText, /never in the background, and no one is alerted/);
});

test('the new sentence says what actually happens', () => {
  const gpsOn = consentText.slice(consentText.indexOf('Planned arrival area only. Radius selection does not activate geofence monitoring. If you start'));
  const line = gpsOn.slice(0, 500);
  assert.match(line, /only while this app is open on your screen/, 'foreground-only must stay: it is still true');
  assert.match(line, /never in the background/);
  assert.match(line, /miss your check-in, the people you chose are alerted in DHARA automatically/);
  assert.match(line, /does not send them a text message/);
});

test('the sentence for a journey with GPS off is unchanged', () => {
  assert.match(consentText, /does not activate geofence monitoring or any location tracking/);
});

test('nothing in the app still claims location is shared in the background', () => {
  for (const [name, src] of [['picker', consentText], ['destination', destination], ['radius', radius]]) {
    assert.doesNotMatch(src, /shares? your location in the background/i, name);
  }
});
