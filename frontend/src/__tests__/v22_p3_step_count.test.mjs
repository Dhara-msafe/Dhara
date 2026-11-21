/**
 * v2.2 rollout — phase 3 (one onboarding step count).
 *
 * Owner-confirmed onboarding order (21 Nov 2026): Language (1), How it
 * helps (2), Consent (3), State (4). language.tsx says "STEP 1 OF 4" and
 * consent.tsx "STEP 3 OF 4", but how-it-helps.tsx said "Step 2 of 3", so
 * the visible count jumped mid-onboarding. Phase 3 makes how-it-helps say
 * "Step 2 of 4" (with a 4-segment progress bar) behind
 * EXPO_PUBLIC_UI_V22_P3, default OFF.
 *
 * Head Out's own "Step n of 3" labels (app/women/head-out/*) are a separate
 * 3-step journey and must NOT be touched by this phase.
 *
 * Source-level tests, qaModeBanner.test.mjs convention.
 * Run with: node --test src/__tests__/v22_p3_step_count.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const app = (...p) => readFileSync(join(here, '..', '..', 'app', ...p), 'utf8');

const howItHelps = app('how-it-helps.tsx');

test('flag defaults OFF and gates the label', () => {
  assert.match(howItHelps, /const UI_V22_P3 = process\.env\.EXPO_PUBLIC_UI_V22_P3 === 'true';/);
  assert.match(howItHelps, /\{UI_V22_P3 \? 'Step 2 of 4' : 'Step 2 of 3'\}/);
});

test('progress bar gains its 4th segment only with the flag ON', () => {
  assert.match(howItHelps, /\{UI_V22_P3 && <View style=\{styles\.progressSeg\} \/>\}/);
  // Still exactly two "done" segments either way (we are ON step 2).
  const done = howItHelps.match(/styles\.progressSegDone\]/g) || [];
  assert.equal(done.length, 2, 'exactly 2 done segments');
});

test('the other onboarding screens already say "of 4" and are untouched', () => {
  assert.ok(app('language.tsx').includes('STEP 1 OF 4'), 'language.tsx must say STEP 1 OF 4');
  assert.ok(app('consent.tsx').includes('STEP 3 OF 4'), 'consent.tsx must say STEP 3 OF 4');
});

test("Head Out's separate 3-step journey keeps its own labels", () => {
  assert.ok(app('women', 'head-out', 'destination.tsx').includes('Step 1 of 3'));
  assert.ok(app('women', 'head-out', 'radius.tsx').includes('Step 2 of 3'));
  assert.ok(app('women', 'head-out', 'circle.tsx').includes('Step 3 of 3'));
});
