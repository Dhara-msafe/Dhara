/**
 * W2-J05 leftovers (fix/headout/W2-J05-leftovers, Feature #65) — source-level
 * wiring checks, same style as w2j05_head_out_checkin_wiring.test.ts:
 *  (a) the active journey shows the "Location uncertain" note when tracking
 *      is on but the fix is stale or inaccurate (guards fixIsFresh/fixIsAccurate);
 *  (b) frontend/.env.example names every Head Out flag (names only);
 *  (c) the destination screen tells the user when address suggestions came
 *      from OpenStreetMap instead of Google.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

test('active journey: location-uncertain note is gated on tracking + stale/inaccurate fix', () => {
  const src = read('app/women/head-out/index.tsx');
  assert.match(src, /headout-location-uncertain/);
  assert.match(src, /Location uncertain — DHARA can't confirm your arrival from this reading\. Tap \\"I'm safe\\" or \\"Need help\\" yourself\./);
  // The note must key on the same freshness/accuracy guards the arrival check uses.
  assert.match(src, /gps\.tracking && !\(fixIsFresh && fixIsAccurate\)/);
  assert.match(src, /const fixIsFresh = /);
  assert.match(src, /const fixIsAccurate = /);
});

test('.env.example names every Head Out flag (names only, no secrets)', () => {
  const env = read('.env.example');
  for (const flag of [
    'EXPO_PUBLIC_GO1B_GPS',
    'EXPO_PUBLIC_GO1C_LIVE_ROUTE',
    'EXPO_PUBLIC_TRUSTED_CIRCLE_RECIPIENT',
    'EXPO_PUBLIC_GUARDIAN_SHARE',
    'EXPO_PUBLIC_ALERT_SIMULATION_MODE',
    'EXPO_PUBLIC_HEADOUT_DEMO',
  ]) {
    assert.match(env, new RegExp(`^${flag}=`, 'm'), `${flag} missing from .env.example`);
  }
  // Names only: the Head Out demo flag must not carry a value in the example.
  assert.match(env, /^EXPO_PUBLIC_HEADOUT_DEMO=$/m);
});

test('destination: OSM source note exists and is driven by the layered search result', () => {
  const src = read('app/women/head-out/destination.tsx');
  assert.match(src, /headout-osm-source-note/);
  assert.match(src, /Showing OpenStreetMap results — Google address search is currently unavailable/);
  // The layered search reports its source, and the screen stores it.
  assert.match(src, /source: 'google' \| 'osm'/);
  assert.match(src, /suggestionSource === 'osm'/);
  assert.match(src, /setSuggestionSource\(results\.source\)/);
  // Backend-side OSM fallback rows (provider === 'osm') are labelled OSM too.
  assert.match(src, /every\(r => r\.provider === 'osm'\)/);
});
