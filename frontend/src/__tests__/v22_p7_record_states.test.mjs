/**
 * v2.2 rollout — phase 7 (Record: distinct mic-denied and save-failed states).
 *
 * REGRESSION_ACCEPTANCE T16 (microphone denied: state with next step) and
 * T17 (save failure: failure state, data not lost) — the screen already had
 * both conditions, but showed them as the same plain status line as every
 * other message. Behind EXPO_PUBLIC_UI_V22_P7 (default OFF) each gets its own
 * alert-role notice card with a next step. Recording / saving / pending
 * recovery logic is unchanged. T16/T17 remain PHYSICAL ANDROID checks.
 *
 * Source-level tests, qaModeBanner.test.mjs convention.
 * Run with: node --experimental-strip-types --test src/__tests__/v22_p7_record_states.test.mjs
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
const screen = read('app', 'women', 'evidence-locker.tsx');
const { RECORD_NOTICES } = await import(join(root, 'src', 'recordCopy.ts'));

test('flag defaults OFF', () => {
  assert.match(flags, /export const UI_V22_P7 = process\.env\.EXPO_PUBLIC_UI_V22_P7 === 'true';/);
});

test('mic denied sets its notice, and only with the flag on', () => {
  assert.match(screen, /if \(!permission\.granted\) \{\s*\n\s*if \(UI_V22_P7\) setNotice\('micDenied'\);\s*\n\s*throw new Error\('Microphone permission is needed\./);
});

test('save failure sets its notice, and only with the flag on', () => {
  assert.match(screen, /setStatus\(error\.message \|\| 'Recording could not be saved\.'\);\s*\n\s*if \(UI_V22_P7\) setNotice\('saveFailed'\);/);
});

test('notice is cleared when a new recording or capture starts', () => {
  assert.match(screen, /setBusy\(true\); setStatus\(''\); setNotice\(null\); stopPlayer\(\);/);
  assert.match(screen, /setBusy\(true\); setStatus\(''\); setNotice\(null\);\s*\n\s*\/\/ EL-057/);
});

test('notice card: alert role, title + next step, flag OFF renders the old line', () => {
  assert.match(screen, /\{UI_V22_P7 && notice \? \(/);
  assert.match(screen, /accessibilityRole="alert" accessibilityLiveRegion="assertive"/);
  assert.match(screen, /: \(\s*\n\s*!!status && <Text testID="evidence-status" accessibilityLiveRegion="polite" style=\{styles\.note\}>\{status\}<\/Text>/);
});

test('copy follows the content rules: no promises, says what to do', () => {
  const { micDenied, saveFailed } = RECORD_NOTICES;
  assert.match(micDenied.body, /tap Record again/);
  assert.match(micDenied.body, /Nothing is being recorded/);
  assert.match(saveFailed.body, /not guaranteed/);
  for (const n of [micDenied, saveFailed]) {
    const all = `${n.title} ${n.body}`;
    for (const banned of [/background/i, /\bsafe\b/i, /guaranteed(?! )/, /encrypt/i, /police/i, /uploaded/i]) {
      assert.ok(!banned.test(all.replace('not guaranteed', '')), `"${all}" must not match ${banned}`);
    }
  }
});

test('no recording logic changed: no pause, no dark screen, storage calls intact', () => {
  assert.ok(!/pause/i.test(read('src', 'recordCopy.ts')));
  assert.ok(!/Make the screen dark/i.test(screen));
  for (const call of ['markPendingTemp(AsyncStorage, scope, tempUri)', 'saveRecording(scope, tempUri)', 'listPendingTemps(AsyncStorage, scope)']) {
    assert.ok(screen.includes(call), `${call} must still be there`);
  }
});
