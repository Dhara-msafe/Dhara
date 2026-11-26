/**
 * v2.2 rollout — step S4 (Shield tools): Women's Shield hub reskin to the
 * dark "Shield mode" palette (screen-manifest id 33: "Glow effects
 * simplified; text contrast raised"). Visual only — the header stays its
 * existing navy (it was already dark); only the body sections (rights grid,
 * tool card, helplines, campus layer, safety-plan card, discreet cover)
 * switch palette. Behind EXPO_PUBLIC_UI_V22_S4 (default OFF, shared with
 * Panic lesson and Safety plan).
 *
 * This screen also carries two pre-existing flags, UI_V22_P6 (tap-to-call
 * dialler) and UI_V22_P8 (safety-tools-first reorder): S4 must coexist with
 * both without touching their branching logic — it only recolors.
 *
 * Source-level tests, v22_s4_panic_lesson.test.mjs convention.
 * Run with: node --experimental-strip-types --test src/__tests__/v22_s4_women_shield.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const screen = readFileSync(join(root, 'app', 'women-shield.tsx'), 'utf8');

test('screen imports the S4 flag and shield palette alongside the existing P6/P8 flags', () => {
  assert.match(screen, /import \{ UI_V22_P6, UI_V22_P8, UI_V22_S4 \} from '@\/src\/uiV22Flags';/);
  assert.match(screen, /import \{ shieldColors, shieldGradient \} from '@\/src\/shieldTheme';/);
});

test('gradient background only renders with the flag on; flag OFF keeps the plain View', () => {
  assert.match(screen, /if \(UI_V22_S4\) \{\s*\n\s*return \(\s*\n\s*<LinearGradient colors=\{shieldGradient\.colors\}/);
  assert.match(screen, /return <View style=\{styles\.root\}>\{body\}<\/View>;/);
});

test('root style is transparent under the gradient, opaque cream otherwise', () => {
  assert.match(screen, /root: \{ flex: 1, backgroundColor: UI_V22_S4 \? 'transparent' : c\.background \},/);
});

test('header keeps its existing navy background — not reskinned (already dark)', () => {
  assert.match(screen, /header: \{ backgroundColor: c\.navy, paddingHorizontal: 16, paddingBottom: 18 \},/);
});

test('rights-grid, tool-card and helpline-card surfaces switch to the shield card background', () => {
  assert.match(screen, /rightCard: UI_V22_S4\s*\n\s*\? \{ width: '47\.5%', [^]*?backgroundColor: shieldColors\.cardBg,/);
  assert.match(screen, /toolCard: UI_V22_S4\s*\n\s*\? \{ backgroundColor: shieldColors\.cardBg,/);
  assert.match(screen, /hlCard: UI_V22_S4\s*\n\s*\? \{ width: '31%', backgroundColor: shieldColors\.cardBg,/);
});

test('UI_V22_P6 (tap-to-call dialler) branching is untouched', () => {
  assert.match(screen, /icon="school-outline" title="Anti-Ragging helpline"/);
  assert.match(screen, /shownHelplines\.map\(h => \(UI_V22_P6 \? \(/);
  assert.match(screen, /onPress=\{async \(\) => setDialStatus\(await openPhone\(h\.num\)\)\}/);
});

test('UI_V22_P8 (safety-tools-first reorder) branching is untouched', () => {
  assert.match(screen, /\{UI_V22_P8 && <>\s*\n\s*\{\/\* Safety tools \*\/\}/);
  assert.match(screen, /\{!UI_V22_P8 && <>\s*\n\s*<View style=\{styles\.toolRow\}>/);
});

test('discreet-mode cover and the A6 panic-lesson first-open effect are untouched', () => {
  assert.match(screen, /testID="ws-discreet-cover"/);
  assert.match(screen, /router\.push\('\/women\/panic-lesson'\);/);
  assert.match(screen, /PANIC_LESSON_SEEN_KEY/);
});
