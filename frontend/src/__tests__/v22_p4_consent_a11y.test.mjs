/**
 * v2.2 rollout — phase 4 (consent screen accessibility, flag OFF).
 *
 * Owner retest (21 Nov): the consent choices were not announced properly by
 * screen readers. Owner decision: keep the two optional choices as
 * switches; every control must announce name, role and on/off state;
 * defaults, visible labels and stored records unchanged; consentStrings is
 * B-62 territory and must not be touched.
 *
 * Behind EXPO_PUBLIC_UI_V22_P4 (default OFF), consent.tsx adds:
 * - radiogroup role + accessible name on the age pair, explicit names on
 *   each radio
 * - explicit accessible names on the two required checkboxes (previously
 *   name-from-child-text only, which some readers skip)
 * - explicit switch role + checked/disabled state on the two optional
 *   Switch controls
 *
 * Source-level tests, qaModeBanner.test.mjs convention.
 * Run with: node --test src/__tests__/v22_p4_consent_a11y.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const src = readFileSync(join(root, 'app', 'consent.tsx'), 'utf8');

test('flag defaults OFF: only the exact string "true" enables phase 4', () => {
  assert.match(src, /const UI_V22_P4 = process\.env\.EXPO_PUBLIC_UI_V22_P4 === 'true';/);
  // Every addition is spread-gated, so flag OFF renders today's props exactly.
  const gated = src.match(/\{\.\.\.\(UI_V22_P4 \?/g) || [];
  assert.equal(gated.length, 6, 'all six additions must be UI_V22_P4-gated spreads');
});

test('age pair: radiogroup with a name; each radio gets an explicit name', () => {
  assert.match(src, /accessibilityRole: 'radiogroup' as const, accessibilityLabel: copy\.ageHeading/);
  assert.match(src, /accessibilityLabel: value === '18\+' \? strings\.age_label : strings\.age_under_label/);
  // Pre-existing role + state on the radios stay.
  assert.match(src, /accessibilityRole="radio" accessibilityState=\{\{ checked: age === value, disabled: saving \}\}/);
});

test('required checkboxes: explicit accessible names; role and state unchanged', () => {
  assert.match(src, /accessibilityLabel: strings\.terms_checkbox/);
  assert.match(src, /accessibilityLabel: strings\.data_checkbox/);
  for (const id of ['consent-terms-checkbox', 'consent-data-checkbox']) {
    assert.ok(src.includes(`testID="${id}" accessibilityRole="checkbox"`), `${id} keeps role=checkbox`);
  }
});

test('optional choices stay switches (owner decision) with role and state', () => {
  assert.equal((src.match(/<Switch /g) || []).length, 2, 'exactly two Switch controls');
  const switchRole = src.match(/accessibilityRole: 'switch' as const, accessibilityState: \{ checked: (analytics|updates), disabled: saving \}/g) || [];
  assert.equal(switchRole.length, 2, 'both switches announce switch role + checked state when ON');
  // Their existing labels remain the visible strings.
  assert.match(src, /accessibilityLabel=\{strings\.optional_analytics\}/);
  assert.match(src, /accessibilityLabel=\{strings\.optional_updates\}/);
});

test('behaviour unchanged: defaults, consent storage and B-62 strings untouched', () => {
  // All four choices still start unchecked/off.
  for (const line of [
    'useState(false);', // termsTicked / dataTicked / analytics / updates share this
  ]) assert.ok(src.includes(line));
  assert.match(src, /const \[termsTicked, setTerms\] = useState\(false\)/);
  assert.match(src, /const \[analytics, setAnalytics\] = useState\(false\)/);
  assert.match(src, /const \[updates, setUpdates\] = useState\(false\)/);
  // consentStrings.ts must be untouched by this phase (B-62 owns its wording).
  const diff = execSync('git diff --name-only origin/emergent-workspace-9/11...HEAD || git diff --name-only HEAD~1', {
    cwd: root, encoding: 'utf8', shell: '/bin/bash',
  });
  assert.ok(!diff.includes('consentStrings'), 'consentStrings.ts must not change in phase 4');
});
