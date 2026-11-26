/**
 * v2.2 rollout — step S4 (Shield tools): Panic lesson reskin to the dark
 * "Shield mode" palette (memory/dhara_redesign/v2_2/editable_screens/PanicLesson.dc.html).
 * Visual only — lesson content stays backend-driven (A6); no listen/content
 * logic changed. Behind EXPO_PUBLIC_UI_V22_S4 (default OFF).
 *
 * Source-level tests, v22_p7_record_states.test.mjs convention.
 * Run with: node --experimental-strip-types --test src/__tests__/v22_s4_panic_lesson.test.mjs
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
const screen = read('app', 'women', 'panic-lesson.tsx');

// Redesign v3 (26 Nov 2026): the dark "Shield mode" is retired, so the flag
// is a constant false and no build setting can turn the purple design on.
test('S4 flag is always OFF (dark Shield mode retired in redesign v3)', () => {
  assert.match(flags, /export const UI_V22_S4: boolean = false;/);
  assert.doesNotMatch(flags, /UI_V22_S4 = process\.env/);
});

test('screen imports the Shield palette and S4 flag', () => {
  assert.match(screen, /import \{ UI_V22_S4 \} from '@\/src\/uiV22Flags';/);
  assert.match(screen, /import \{ shieldColors, shieldGradient \} from '@\/src\/shieldTheme';/);
});

test('gradient background only renders with the flag on; flag OFF keeps the plain View', () => {
  assert.match(screen, /if \(UI_V22_S4\) \{\s*\n\s*return \(\s*\n\s*<LinearGradient colors=\{shieldGradient\.colors\}/);
  assert.match(screen, /return <View style=\{styles\.root\}>\{body\}<\/View>;/);
});

test('root style is transparent under the gradient, opaque cream otherwise', () => {
  assert.match(screen, /root: \{ flex: 1, backgroundColor: UI_V22_S4 \? 'transparent' : c\.background \},/);
});

test('step badges use the per-step accent colours only when the flag is on', () => {
  assert.match(screen, /const accent = STEP_ACCENTS\[i % STEP_ACCENTS\.length\];/);
  assert.match(screen, /UI_V22_S4 && \{ backgroundColor: accent\.bg \}/);
  assert.match(screen, /UI_V22_S4 && \{ color: accent\.nc \}/);
});

test('lesson content and the listen-speech logic are untouched (A6 / B-94/B-79)', () => {
  assert.match(screen, /fetch\(`\$\{API_BASE\}\/api\/women\/panic-lesson\?platform=\$\{platform\}`\)/);
  assert.match(screen, /void speech\.listen\(full, 'fixed_screen'\);/);
});
