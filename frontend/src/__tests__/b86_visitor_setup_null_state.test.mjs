/** B-86 (21 Nov web retest): 'VisitorSetup: Cannot read properties of null
 * (reading name)' crashed /visitor, the Home tile and All help — the earlier
 * B-86 change made selectedState start as null, but the state picker's
 * accessibilityLabel still read selectedState.name unguarded on first render. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const src = readFileSync(join(import.meta.dirname, '..', '..', 'app/visitor/index.tsx'), 'utf8');

test('selectedState starts null (no silent Maharashtra default)', () => {
  assert.match(src, /useState<typeof INDIAN_STATES\[number\] \| null>\(null\)/);
});

test('no unguarded selectedState.name / .code read anywhere in the render', () => {
  // Every `selectedState.<prop>` must be optional-chained or sit inside a
  // `selectedState ? ... :` guard or after the `if (!selectedState) return` in proceed().
  const lines = src.split('\n');
  const proceedStart = lines.findIndex(l => l.includes('const proceed = useCallback'));
  const proceedEnd = lines.findIndex((l, i) => i > proceedStart && l.includes('}, [selectedLang, selectedState, router]);'));
  lines.forEach((l, i) => {
    if (!/selectedState\.(name|code)/.test(l)) return;
    if (i > proceedStart && i < proceedEnd) return; // guarded by the early return in proceed()
    assert.match(l, /selectedState \?/, `line ${i + 1} reads selectedState unguarded: ${l.trim()}`);
  });
});

test('picker label has a not-selected wording', () => {
  assert.match(src, /'State: not selected yet'/);
});
