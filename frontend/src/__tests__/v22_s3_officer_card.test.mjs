/**
 * v2.2 rollout — step S3 (Safety core): Officer card reskin to the light
 * cream/navy palette (memory/dhara_redesign/v2_2/editable_screens/Officer.dc.html).
 * Visual only (screen-manifest id 27: "retained ... Visual only") — the
 * rights-card fetch, silent-mode speech gating (A4), and metered-question
 * logic stay untouched. Behind EXPO_PUBLIC_UI_V22_S3 (default OFF).
 *
 * Source-level tests, v22_s4_panic_lesson.test.mjs convention.
 * Run with: node --experimental-strip-types --test src/__tests__/v22_s3_officer_card.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');
const flags = read('src', 'uiV22Flags.ts');
const screen = read('app', 'women', 'officer-card.tsx');

test('S3 flag defaults OFF', () => {
  assert.match(flags, /export const UI_V22_S3 = process\.env\.EXPO_PUBLIC_UI_V22_S3 === 'true';/);
});

test('screen imports the S3 flag', () => {
  assert.match(screen, /import \{ UI_V22_S3 \} from '@\/src\/uiV22Flags';/);
});

test('root background is cream under the flag, navy otherwise', () => {
  assert.match(screen, /root: \{ flex: 1, backgroundColor: UI_V22_S3 \? c\.cream : c\.navy \},/);
});

test('back button becomes a bordered white circle under the flag', () => {
  assert.match(screen, /back: UI_V22_S3\s*\n\s*\? \{ width: 48, height: 48, borderRadius: 24, borderWidth: 1\.5, borderColor: c\.lines, backgroundColor: c\.surface/);
});

test('verdict/title/law-chip text switches from white-on-navy to navy-on-cream', () => {
  assert.match(screen, /barTitle: \{ color: UI_V22_S3 \? c\.navy : '#fff'/);
  assert.match(screen, /big: \{ color: UI_V22_S3 \? c\.navy : '#fff'/);
  assert.match(screen, /lawTxt: \{ color: UI_V22_S3 \? c\.navy : '#fff'/);
});

test('silent-mode speech gating (A4) is untouched', () => {
  assert.match(screen, /if \(silent\) stopSpeech\(\);/);
  assert.match(screen, /const speakVerdict = \(\) => \{\s*\n\s*if \(silent \|\| !card\) return;/);
});

test('rights-card fetch and metered-question wiring are untouched', () => {
  assert.match(screen, /useRightsCard\(params\.scenario \|\| 'police_wont_file', language\.code\)/);
  assert.match(screen, /void speech\.listen\(card\.verdict, 'fixed_screen'\);/);
});
