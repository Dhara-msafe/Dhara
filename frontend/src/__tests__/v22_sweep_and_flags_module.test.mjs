/**
 * v2.2 — 390px sweep fixes (UI_V22_SWEEP, default OFF) + a guard that the
 * shared flags module really loads.
 *
 * Why the loader test: every other v22 test reads source as TEXT, so a
 * syntax error in src/uiV22Flags.ts (a lost comment opener after a merge
 * on 22 Nov) passed all tests while the file would not compile. This test
 * imports the module itself and fails if it cannot be parsed.
 *
 * Run with: node --experimental-strip-types --test src/__tests__/v22_sweep_and_flags_module.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');

test('src/uiV22Flags.ts loads, and every UI_V22_* flag is a boolean that defaults OFF', async () => {
  for (const k of Object.keys(process.env)) if (k.startsWith('EXPO_PUBLIC_UI_V22')) delete process.env[k];
  const flags = await import(join(root, 'src', 'uiV22Flags.ts') + '?t=' + Date.now());
  const names = Object.keys(flags).filter((k) => k.startsWith('UI_V22_'));
  assert.ok(names.length >= 6, `expected the v22 flags, got ${names.join(', ')}`);
  for (const n of names) {
    assert.equal(typeof flags[n], 'boolean', `${n} must be a boolean`);
    assert.equal(flags[n], false, `${n} must be OFF when its env var is unset`);
  }
});

test('sweep flag defaults OFF', () => {
  assert.match(read('src', 'uiV22Flags.ts'), /export const UI_V22_SWEEP = process\.env\.EXPO_PUBLIC_UI_V22_SWEEP === 'true';/);
});

test('FIR draft tiles: title, description and BNS line may use two lines', () => {
  const s = read('app', 'fir-draft', 'index.tsx');
  for (const field of ['mod.label', 'mod.sublabel', 'mod.bns']) {
    assert.match(s, new RegExp(`numberOfLines=\\{UI_V22_SWEEP \\? 2 : 1\\}>\\{${field.replace('.', '\\.')}\\}`), `${field} must wrap with the flag`);
  }
  // Tiles grow with the text (minHeight, not a fixed height).
  assert.match(s, /moduleCard: \{[\s\S]*?minHeight: 66,/);
});

test('Family journey header title wraps instead of being cut off', () => {
  assert.match(read('src', 'familyJourney', 'ui.tsx'), /<Text style=\{styles\.hTitle\} numberOfLines=\{UI_V22_SWEEP \? 2 : 1\}>\{title\}<\/Text>/);
});
