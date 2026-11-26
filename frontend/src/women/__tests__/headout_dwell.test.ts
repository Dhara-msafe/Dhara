/**
 * DWELL private check-in (Final Flow trigger row, owner GO 26 Nov).
 * Pure-logic tests for src/women/headOutDwell.ts plus wiring checks: the
 * prompt is private (never an alert path), once per stillness episode, and
 * suppressed while arrived/deviated prompts own the screen.
 *
 * Run: node --experimental-strip-types --import ./src/voice/core/__tests__/ts-resolve.mjs \
 *        --test src/women/__tests__/headout_dwell.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  updateDwell, shouldPromptDwell, acknowledgeDwell, dwellMinutes,
  DWELL_THRESHOLD_MS, DWELL_RADIUS_METERS, DWELL_MAX_ACCURACY_METERS,
} from '../headOutDwell';

const T0 = Date.parse('2026-11-26T10:00:00Z');
const fix = (lat: number, lng: number, atMs: number, accuracy: number | null = 10) =>
  ({ latitude: lat, longitude: lng, accuracy, lastFixAt: atMs });

test('still past the threshold prompts; movement resets the episode', () => {
  let s = updateDwell(null, fix(17.4, 78.5, T0));
  // jitter within the radius does not move the anchor
  s = updateDwell(s, fix(17.4001, 78.50001, T0 + 60_000));
  assert.equal(shouldPromptDwell(s, T0 + DWELL_THRESHOLD_MS - 1), false);
  assert.equal(shouldPromptDwell(s, T0 + DWELL_THRESHOLD_MS), true);
  assert.equal(dwellMinutes(s!, T0 + DWELL_THRESHOLD_MS), 10);
  // real movement (>40 m) starts a fresh episode
  s = updateDwell(s, fix(17.401, 78.501, T0 + DWELL_THRESHOLD_MS));
  assert.equal(shouldPromptDwell(s, T0 + DWELL_THRESHOLD_MS + 1), false);
  assert.ok(DWELL_RADIUS_METERS >= 30, 'radius must sit above ordinary GPS jitter');
});

test('once per episode: acknowledged never re-prompts without movement first', () => {
  let s = updateDwell(null, fix(17.4, 78.5, T0));
  s = acknowledgeDwell(s);
  assert.equal(shouldPromptDwell(s, T0 + 2 * DWELL_THRESHOLD_MS), false);
  // she moves, then is still again → a new full threshold is required
  s = updateDwell(s, fix(17.401, 78.501, T0 + 2 * DWELL_THRESHOLD_MS));
  assert.equal(shouldPromptDwell(s, T0 + 2 * DWELL_THRESHOLD_MS + DWELL_THRESHOLD_MS - 1), false);
  assert.equal(shouldPromptDwell(s, T0 + 3 * DWELL_THRESHOLD_MS), true);
});

test('bad input never starts or breaks an episode', () => {
  let s = updateDwell(null, fix(17.4, 78.5, T0));
  const before = s;
  s = updateDwell(s, fix(17.9, 78.9, T0 + 1000, DWELL_MAX_ACCURACY_METERS + 1)); // hopeless accuracy
  assert.equal(s, before);
  s = updateDwell(s, null);
  assert.equal(s, before);
  s = updateDwell(s, fix(NaN, 78.5, T0 + 2000));
  assert.equal(s, before);
  assert.equal(shouldPromptDwell(null, T0), false);
});

test('wiring: private by construction — prompt buttons use only existing paths, no new sends', () => {
  // babel-jest transforms import.meta → ({env:process.env}), so .url/.dirname
  // are undefined at runtime.  __dirname is available in the CJS output.
  /* eslint-disable-next-line no-undef */
  const idx = readFileSync(join(__dirname, '..', '..', '..', 'app/women/head-out/index.tsx'), 'utf8');
  assert.match(idx, /testID="headout-dwell-prompt"/);
  // Gated off while arrived/deviated prompts own the screen.
  assert.match(idx, /dwellPromptMinutes != null && journeyPhase === 'normal'/);
  assert.match(idx, /if \(hasArrived \|\| hasDeviated\) return;/);
  // "I'm okay" only hides the card; "Need help" reuses the one existing flow.
  assert.match(idx, /testID="headout-dwell-okay"[\s\S]{0,200}?onPress=\{\(\) => setDwellPromptMinutes\(null\)\}/);
  assert.match(idx, /testID="headout-dwell-need-help"[\s\S]{0,200}?void requestHelp\(\);/);
  // Honest copy: nothing automatic.
  assert.match(idx, /Nobody is told about this pause automatically\./);
  // No fetch/API call anywhere in the dwell blocks.
  const dwellChunks = idx.split('dwell').filter((_, i) => i > 0);
  assert.ok(!/API_BASE[^\n]{0,80}dwell|dwell[^\n]{0,200}fetch\(/i.test(idx), 'dwell must not add a network path');
  // Episode state resets when the journey is gone.
  assert.match(idx, /dwellRef\.current = null;/);
});
