/**
 * v2.2 rollout — phase 5a (Ask/FIR banner wording). NEEDS LEGAL OK.
 *
 * The scrolling banner (MarqueeBanner, shown on the Ask tab and the FIR
 * draft screen) said "Dhara answers drawn exclusively from official
 * sources" and "Your data is encrypted and never shared with police or
 * courts". Both break the v2.2 content rules. Behind
 * EXPO_PUBLIC_UI_V22_P5_BANNER (default OFF) they are replaced by the two
 * owner-approved lines; every other item is unchanged.
 *
 * Regression row S16 in memory/dhara_redesign/handoff/REGRESSION_ACCEPTANCE.csv.
 * Source-level tests (MarqueeBanner imports react-native, so it is not
 * imported here), qaModeBanner.test.mjs convention.
 *
 * Run with: node --test src/__tests__/v22_p5a_banner_wording.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const src = readFileSync(join(root, 'src', 'components', 'MarqueeBanner.tsx'), 'utf8');
const consentStrings = readFileSync(join(root, 'src', 'consentStrings.ts'), 'utf8');

const SOURCES = 'Answers draw on Indian law (BNS 2023, BNSS, Constitution). Not legal advice.';
const PRIVACY = 'We never share your complaint with the police or anyone else. Only you decide whether to file it.';

test('flag defaults OFF: only the exact string "true" switches the wording', () => {
  assert.match(src, /export const UI_V22_P5_BANNER = process\.env\.EXPO_PUBLIC_UI_V22_P5_BANNER === 'true';/);
  assert.match(src, /export const ITEMS = UI_V22_P5_BANNER\s*\n\s*\? LEGACY_ITEMS\.map/);
  assert.match(src, /: LEGACY_ITEMS;/);
});

test('the two approved replacement lines are exact', () => {
  assert.ok(src.includes(`'${SOURCES}'`), 'sources line must be exactly the approved text');
  assert.ok(src.includes(`'${PRIVACY}'`), 'privacy line must be exactly the approved text');
});

test('privacy line is the approved consent-notice wording, word for word', () => {
  assert.ok(consentStrings.includes(PRIVACY), 'must match the consent notice (no new promise)');
});

test('replacement lines carry none of the banned claims', () => {
  for (const line of [SOURCES, PRIVACY]) {
    for (const banned of [/exclusive/i, /encrypt/i, /court/i, /verified/i, /official sources/i, /guarantee/i]) {
      assert.ok(!banned.test(line), `"${line}" must not match ${banned}`);
    }
  }
});

test('only the first and last items are replaced; the rest are untouched', () => {
  assert.match(src, /i === 0 \? BANNER_SOURCES_LINE/);
  assert.match(src, /i === LEGACY_ITEMS\.length - 1 \? BANNER_PRIVACY_LINE/);
  // Legacy list order pins the indexes the mapping relies on.
  const legacy = src.slice(src.indexOf('const LEGACY_ITEMS'), src.indexOf('];', src.indexOf('const LEGACY_ITEMS')));
  const items = [...legacy.matchAll(/^\s+'([^']+)',$/gm)].map((m) => m[1]);
  assert.equal(items.length, 8);
  assert.equal(items[0], 'Dhara answers drawn exclusively from official sources');
  assert.equal(items[7], 'Your data is encrypted and never shared with police or courts');
});

test('regression guard: the old claims exist nowhere else in app/ or src/', () => {
  const hits = execSync(
    `grep -rlE "drawn exclusively from official|encrypted and never shared" app src --include=*.tsx --include=*.ts | grep -v __tests__ || true`,
    { cwd: root, encoding: 'utf8', shell: '/bin/bash' },
  ).trim().split('\n').filter(Boolean);
  assert.deepEqual(hits, ['src/components/MarqueeBanner.tsx'],
    'old wording may only survive in LEGACY_ITEMS (shown with the flag OFF)');
});

test('regression row S16 is registered as NOT RUN', () => {
  const csv = readFileSync(join(root, '..', 'memory', 'dhara_redesign', 'handoff', 'REGRESSION_ACCEPTANCE.csv'), 'utf8');
  const row = csv.split('\n').find((l) => l.startsWith('S16,'));
  assert.ok(row, 'S16 row must exist');
  assert.ok(row.includes('NOT RUN'), 'S16 must start as NOT RUN');
});
