/**
 * B-82 (D-02) — the Silent Alert tile on the Emergency hub must be hidden
 * for closed-test builds, per the Decision Log's D-02 recommendation
 * ("Testers must not see unfinished safety tools").
 *
 * D-02 itself is still formally Open/unanswered in the DHARA Decision Log
 * as of 17 Nov — this was built to the team's own stated recommendation
 * ahead of the formal answer (same call as B-89), scoped so it can ONLY
 * ever affect OUTBOUND_PROFILE === 'closed_testing' builds. Every other
 * profile (internal_qa, production, or unset/dev) must render Silent
 * Alert exactly as before — nothing here may change their behaviour.
 *
 * app/emergency.tsx transitively imports react-native / expo-router /
 * expo-safe-area-context, which don't resolve under plain Node in this
 * sandbox — source-level wiring checks only, same convention as the
 * repo's other app/-screen tests in this folder (e.g. b87_notetaker_wave1_gate).
 *
 * Run with:
 *   node --experimental-strip-types --test src/__tests__/b82_silent_alert_closed_test_gate.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '..', '..', 'app', 'emergency.tsx'), 'utf8');
const OUTBOUND_SRC = readFileSync(join(__dirname, '..', 'outbound.ts'), 'utf8');

test('emergency.tsx imports OUTBOUND_PROFILE from the existing outbound guard, not a new flag', () => {
  assert.match(SRC, /import \{ OUTBOUND_PROFILE \} from '@\/src\/outbound';/);
});

test('the gate constant is scoped to exactly the closed_testing profile', () => {
  assert.match(
    SRC,
    /const HIDE_SILENT_ALERT_FOR_CLOSED_TEST = OUTBOUND_PROFILE === 'closed_testing';/,
  );
});

test('closed_testing is a real, existing profile value in outbound.ts (not invented here)', () => {
  assert.match(OUTBOUND_SRC, /'closed_testing'/);
});

test('the tiles array is filtered, not conditionally spliced or reordered', () => {
  assert.match(
    SRC,
    /\]\.filter\(\(t\) => !\(t\.id === 'silent-alert' && HIDE_SILENT_ALERT_FOR_CLOSED_TEST\)\);/,
  );
});

test('record-now, officer-card and nearest-help tiles are untouched by the filter', () => {
  assert.ok(SRC.includes("id: 'record-now'"));
  assert.ok(SRC.includes("id: 'officer-card'"));
  assert.ok(SRC.includes("id: 'nearest-help'"));
  // None of the other three ids appear inside the filter predicate itself.
  const filterLine = SRC.match(/\]\.filter\([^;]+;/)?.[0] ?? '';
  assert.ok(!filterLine.includes('record-now'));
  assert.ok(!filterLine.includes('officer-card'));
  assert.ok(!filterLine.includes('nearest-help'));
});

test('silent-alert tile definition itself is unchanged — only filtered out, not deleted or altered', () => {
  assert.ok(SRC.includes("id: 'silent-alert'"));
  assert.ok(SRC.includes("route: '/women/silent-alert'"));
});
