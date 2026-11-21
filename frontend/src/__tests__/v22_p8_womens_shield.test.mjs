/**
 * v2.2 rollout — phase 8 (Women's Shield + journey naming, flag OFF).
 *
 * Behind EXPO_PUBLIC_UI_V22_P8 (default OFF):
 * - Women's Shield shows safety tools before "Know your rights"
 * - the dead "Safe-journey check-in" switch row is removed (it only stored
 *   ws_checkin_enabled; nothing reads it)
 * - Discreet mode switch: neutral name ("Discreet mode") + switch role +
 *   real checked state (it was always announced as "Discreet mode is on")
 * - one name for the journey feature: "Head out safely" (Home, profile)
 * - FIR draft Domestic Violence tile drops "498A" (old IPC)
 * - All help: Police & FIR gets its own description
 *
 * Source-level tests, qaModeBanner.test.mjs convention.
 * Run with: node --test src/__tests__/v22_p8_womens_shield.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');
const flags = read('src', 'uiV22Flags.ts');
const shield = read('app', 'women-shield.tsx');
const home = read('app', '(tabs)', 'home.tsx');
const fir = read('app', 'fir-draft', 'index.tsx');
const allHelp = read('app', 'all-help.tsx');
const i18n = read('src', 'ui18n.ts');
const profile = read('src', 'userProfile.ts');

test('flag defaults OFF', () => {
  assert.match(flags, /export const UI_V22_P8 = process\.env\.EXPO_PUBLIC_UI_V22_P8 === 'true';/);
});

test("Women's Shield: tools before rights with the flag on; old order with it off", () => {
  const onTools = shield.indexOf('{UI_V22_P8 && <>\n        {/* Safety tools */}');
  const rights = shield.indexOf('{/* Know your rights */}');
  const offTools = shield.indexOf('{!UI_V22_P8 && <>\n        {/* Safety tools */}');
  assert.ok(onTools > 0 && rights > onTools && offTools > rights, 'order must be: [P8 tools] rights [non-P8 tools]');
  // The two tool blocks are the same JSX apart from the check-in gate.
  assert.equal((shield.match(/\{\/\* Safety tools \*\/\}/g) || []).length, 2);
});

test('dead check-in row hidden with the flag on (storage functions untouched)', () => {
  const gated = shield.match(/\{!UI_V22_P8 && <>\s*\n\s*<View style=\{styles\.toolRow\}>[\s\S]*?testID="ws-checkin-switch"/g) || [];
  assert.equal(gated.length, 2, 'both copies of the check-in row must be inside !UI_V22_P8');
  assert.ok(read('src', 'women', 'api.ts').includes("const CHECKIN_KEY = 'ws_checkin_enabled';"));
});

test('Discreet mode announces its real state with a neutral name', () => {
  assert.match(shield, /accessibilityLabel=\{tr\(UI_V22_P8 \? 'ws\.discreet\.off' : 'ws\.discreet', lang\)\}/);
  assert.match(shield, /accessibilityRole: 'switch' as const, accessibilityState: \{ checked: discreet \}/);
  assert.match(i18n, /'ws\.discreet\.off':\s+\{ en: 'Discreet mode',/);
});

test('one name: "Head out safely" on Home and in the profile card', () => {
  assert.match(home, /\{UI_V22_P8 \? 'Head out safely' : 'Heading out\?'\}/);
  assert.match(home, /UI_V22_P8 \? 'Set a check-in timer before you leave\.'/);
  assert.match(profile, /UI_V22_P8 \? 'Head out safely, evidence locker & trusted circle\.'/);
  // Women's Shield already uses the name.
  assert.ok(shield.includes('title="Head out safely" sub="Set a check-in timer before you leave"'));
});

test('FIR Domestic Violence tile: no 498A with the flag on; BNS line unchanged', () => {
  assert.match(fir, /sublabel: UI_V22_P8 \? 'Dowry · Cruelty by husband or in-laws · DV Act' : 'Dowry · 498A · DV Act',/);
  assert.ok(fir.includes("bns: 'BNS 85 · DV Act',"));
});

test('All help: Police & FIR has its own description', () => {
  assert.match(allHelp, /sub: tr\(UI_V22_P8 \? 'all\.police\.sub' : 'all\.shield\.sub', lang\), route: '\/fir-draft'/);
  assert.match(i18n, /'all\.police\.sub':\s+\{ en: 'File an FIR, your rights at the police station',/);
  // Women's Shield keeps its own line.
  assert.match(allHelp, /sub: tr\('all\.shield\.sub', lang\), route: '\/women-shield'/);
});

test('Head Out screens are not touched by this phase (phase 9 is the Head Out chat)', () => {
  const diff = execSync('git diff --name-only origin/emergent-workspace-9/11 -- . || true', {
    cwd: root, encoding: 'utf8', shell: '/bin/bash',
  });
  assert.ok(!/app\/women\/head-out\//.test(diff), 'no head-out file may change in phase 8');
});
