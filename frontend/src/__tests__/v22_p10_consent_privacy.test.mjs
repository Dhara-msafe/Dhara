/**
 * v2.2 rollout — phase 10 (Consent settings and privacy, look only, flag OFF).
 *
 * Behind EXPO_PUBLIC_UI_V22_P10 (default OFF), Settings > Data & privacy:
 * - optional choices (Analytics, Service updates) get an "Optional" badge and
 *   an Agreed / Not given chip in theme.consentState colours (P1 tokens)
 * - consent history chips say the state in words ("Analytics: agreed") in
 *   the same colours, instead of ✓/✗ alone; off = neutral, never 'withdrawn'
 * - section headers become small-caps labels; accordion headers and
 *   "View all" reach 48 px
 * Presentation only: toggles, handlers, API calls and notice text unchanged.
 *
 * Run with: node --test src/__tests__/v22_p10_consent_privacy.test.mjs
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
const dp = read('app', 'settings', 'data-privacy.tsx');
const theme = read('src', 'theme.ts');

test('flag defaults OFF, declared above P8 (clean merges with flags appended at the end)', () => {
  assert.match(flags, /export const UI_V22_P10 = process\.env\.EXPO_PUBLIC_UI_V22_P10 === 'true';/);
  assert.ok(flags.indexOf('UI_V22_P10 =') < flags.indexOf('UI_V22_P8 ='));
});

test('optional choices: badge + state chip only with the flag on, from existing state', () => {
  assert.equal((dp.match(/\{UI_V22_P10 && <View style=\{styles\.p10OptionalBadge\}>/g) || []).length, 2);
  assert.match(dp, /\{UI_V22_P10 && <P10OptionalStatus on=\{analytics\} testID="consent-analytics-state" \/>\}/);
  assert.match(dp, /\{UI_V22_P10 && <P10OptionalStatus on=\{updates\} testID="consent-updates-state" \/>\}/);
  assert.match(dp, /\{on \? 'Agreed' : 'Not given'\}/);
});

test('uses the P1 consentState tokens; off never shown as withdrawn', () => {
  assert.match(theme, /consentState: \{/);
  assert.match(dp, /const CS = theme\.consentState;/);
  assert.match(dp, /return on \? CS\.agreed : CS\.notGiven;/);
  assert.doesNotMatch(dp, /return on \? CS\.agreed : CS\.withdrawn;/);
});

test('history chips say the state in words under the flag; old chips kept for flag off', () => {
  assert.match(dp, /\{name\}: \{on \? 'agreed' : 'not given'\}/);
  assert.match(dp, /Analytics \{entry\.purposes\?\.analytics \? '✓' : '✗'\}/); // flag-off branch intact
  assert.match(dp, /\{UI_V22_P10 \? 'Core: agreed' : 'Core ✓'\}/);
});

test('48 px targets and small-caps headers under the flag', () => {
  assert.match(dp, /accordionHeader: \{\s*\n\s*minHeight: UI_V22_P10 \? 48 : undefined,/);
  assert.match(dp, /viewAllBtn: \{\s*\n\s*minHeight: UI_V22_P10 \? 48 : undefined,/);
  assert.match(dp, /UI_V22_P10 \? \{ textTransform: 'uppercase' as const/);
});

test('presentation only: toggles, handlers and API calls unchanged', () => {
  assert.match(dp, /onValueChange=\{v => handlePurposeToggle\('analytics', v\)\}/);
  assert.match(dp, /onValueChange=\{v => handlePurposeToggle\('updates', v\)\}/);
  assert.equal((dp.match(/UI_V22_P10[\s\S]{0,300}?fetch\(/g) || []).length, 0, 'no fetch inside a P10 block');
});
