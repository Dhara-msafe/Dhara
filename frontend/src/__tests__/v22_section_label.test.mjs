/**
 * v2.2 step 1 — one section label (UI_V22_TYPE, default OFF).
 *
 * The app had 24 different styles for the same small uppercase label above
 * a group (10-14px, weights 700/800, letter-spacing 0.4-1.5, five colours).
 * 30 of the 57 design screens use one style. With the flag on, the quiet
 * labels share it; each site keeps its own margins; the deliberate accent /
 * heading labels (navy, gold, brand) are left alone, and the two Head Out
 * files are not touched (that chat owns them).
 *
 * Run with: node --experimental-strip-types --test src/__tests__/v22_section_label.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');
const kit = read('src', 'v22SectionLabel.ts');

function walk(d, out = []) {
  for (const f of readdirSync(d)) {
    if (f === 'node_modules' || f === '__tests__') continue;
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}
const files = walk(root).filter((p) => !/\/(memory|scripts)\//.test(p));
const UPPER = /\{[^{}]*textTransform: *'uppercase'[^{}]*\}/g;
const QUIET = /muted|onSurfaceSecondary|onSurfaceTertiary|9CA3AF|#999|MUTED/;
const HEADOUT = ['app/women/head-out/index.tsx', 'src/women/DestinationPicker.tsx'];

test('flag defaults OFF', () => {
  assert.match(read('src', 'uiV22Flags.ts'), /export const UI_V22_TYPE = process\.env\.EXPO_PUBLIC_UI_V22_TYPE === 'true';/);
});

test('the shared style matches the design spec', () => {
  assert.match(kit, /fontSize: 12,/);
  assert.match(kit, /fontWeight: '700',/);
  assert.match(kit, /color: theme\.colors\.muted,/);     // #505B68, the design's label colour
  assert.match(kit, /letterSpacing: 0\.6,/);
  assert.match(kit, /textTransform: 'uppercase',/);
  assert.match(kit, /fontFamily: theme\.fonts\.bodyBold,/);
});

test('the shared style sets type only — it can never move a label', () => {
  const block = kit.slice(kit.indexOf('V22_SECTION_LABEL: TextStyle = {'), kit.indexOf('};', kit.indexOf('V22_SECTION_LABEL')));
  for (const banned of ['margin', 'padding', 'width', 'height', 'position', 'flex', 'top', 'left']) {
    assert.ok(!block.includes(banned), `the shared label must not set ${banned}`);
  }
  // own first, shared second: the site's margins survive, the type is replaced.
  assert.match(kit, /return UI_V22_TYPE \? \{ \.\.\.own, \.\.\.V22_SECTION_LABEL \} : own;/);
});

test('every quiet label now uses the shared style', () => {
  const stragglers = [];
  for (const p of files) {
    const rel = relative(root, p);
    if (rel === 'src/v22SectionLabel.ts' || HEADOUT.includes(rel)) continue;
    const s = readFileSync(p, 'utf8');
    for (const m of s.match(UPPER) || []) {
      const col = /color: *([^,}]+)/.exec(m);
      if (col && QUIET.test(col[1]) && !s.includes(`v22SectionLabel(${m}`)) stragglers.push(`${rel}: ${col[1].trim()}`);
    }
  }
  assert.deepEqual(stragglers, [], 'these quiet labels were missed');
});

test('accent and heading labels are left alone', () => {
  let accents = 0;
  for (const p of files) {
    const s = readFileSync(p, 'utf8');
    for (const m of s.match(UPPER) || []) {
      const col = /color: *([^,}]+)/.exec(m);
      if (col && !QUIET.test(col[1])) {
        accents++;
        assert.ok(!s.includes(`v22SectionLabel(${m}`), `accent label must stay as it is: ${relative(root, p)}`);
      }
    }
  }
  assert.ok(accents >= 5, `expected the deliberate accent labels to remain, found ${accents}`);
});

test('the Head Out chat files are untouched', () => {
  for (const rel of HEADOUT) {
    assert.ok(!read(...rel.split('/')).includes('v22SectionLabel'), `${rel} belongs to the Head Out chat`);
  }
});
