// B-64 (24 Nov 2026): consent switches must announce on/off exactly once.
// On web react-native-web's Switch is already <input role="switch"> with its
// checked state; the v2.2 P4 role/state props wrapped it in a second,
// stateless "switch". They now apply on phones only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(path.join(root, 'app/consent.tsx'), 'utf8');

test('explicit switch role/state is not added on web', () => {
  assert.match(src, /const SWITCH_A11Y_PROPS = Platform\.OS !== 'web';/);
  const gated = src.match(/\{\.\.\.\(UI_V22_P4 \? \(SWITCH_A11Y_PROPS \? \{ accessibilityRole: 'switch' as const/g) || [];
  assert.equal(gated.length, 2, 'both optional switches gated');
  assert.doesNotMatch(src, /\{\.\.\.\(UI_V22_P4 \? \{ accessibilityRole: 'switch'/, 'no ungated switch role left');
});
