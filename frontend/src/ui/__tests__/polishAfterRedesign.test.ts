import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

test('panic lesson: a failed load shows a message and Try again, not an endless spinner', () => {
  const s = read('app/women/panic-lesson.tsx');
  assert.match(s, /testID="panic-lesson-failed"/);
  assert.match(s, /testID="panic-lesson-retry"/);
  assert.match(s, /setFailed\(true\)/);
  assert.match(s, /\}, \[attempt\]\);/);
});

test('journey active: map, then arrival time, then From/To, then the check-in timer', () => {
  const s = read('app/women/head-out/index.tsx');
  const card = s.slice(s.indexOf('testID="headout-active-card"'));
  const order = ['testID="headout-active-map"', 'testID="headout-eta"', 'testID="headout-from-to"', 'testID="headout-timer"']
    .map((t) => card.indexOf(t));
  assert.ok(order.every((i) => i > 0), 'all four parts present');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'in reading order');
});

test('tile grid sizes its tiles from its measured width', () => {
  const s = read('src/ui/kit.tsx');
  assert.match(s, /const w = columnWidth\(measured \?\? guessed, cols, gap\);/);
  assert.match(s, /onLayout=\{\(e\) => \{/);
});
