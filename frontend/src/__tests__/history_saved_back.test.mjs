// 22 Nov 2026 (Vivek): Chat history and Saved answers had no back button.
// They are hidden tabs, and "back" inside tabs lands on Home, so the arrow
// navigates to the screen that opened them (?from=), Me by default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => readFileSync(path.join(root, p), 'utf8');

for (const [file, id] of [['app/(tabs)/history.tsx', 'history'], ['app/(tabs)/saved.tsx', 'saved']]) {
  test(`${id}: back arrow on the screen (signed in and guest views)`, () => {
    const src = read(file);
    assert.equal(src.split(`testID="${id}-back"`).length - 1, 2);
    assert.match(src, /router\.navigate\(tabBackTarget\(from\) as any\)/);
    assert.match(src, /accessibilityLabel="Go back"/);
  });
}

test('callers say where they opened it from', () => {
  const me = read('app/(tabs)/me.tsx'), settings = read('app/(tabs)/settings.tsx'), ask = read('app/(tabs)/index.tsx');
  assert.match(me, /'\/\(tabs\)\/history\?from=me'/);
  assert.match(me, /'\/\(tabs\)\/saved\?from=me'/);
  assert.match(settings, /'\/\(tabs\)\/history\?from=settings'/);
  assert.match(settings, /'\/\(tabs\)\/saved\?from=settings'/);
  assert.match(ask, /'\/\(tabs\)\/history\?from=ask'/);
});

test('tabBackTarget: settings, ask, otherwise Me', async () => {
  const src = read('src/tabBackTarget.ts')
    .replace('export function', 'function').replace(/: string \| string\[\]/, '').replace(/\): string/, ')')
    .replace(/\(from\?\)/, '(from)');
  const fn = new Function(`${src}; return tabBackTarget;`)();
  assert.equal(fn('settings'), '/(tabs)/settings');
  assert.equal(fn('ask'), '/(tabs)');
  assert.equal(fn('me'), '/(tabs)/me');
  assert.equal(fn(undefined), '/(tabs)/me');
  assert.equal(fn(['settings']), '/(tabs)/settings');
});
