/** Phone size classes — node:test coverage for src/ui/sizeClass.ts. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { widthClassFor, sizeClassFor, columnWidth, FONT_SCALE_CAP } from '../sizeClass.ts';

test('width classes at the boundaries', () => {
  assert.equal(widthClassFor(320), 'small');
  assert.equal(widthClassFor(359), 'small');
  assert.equal(widthClassFor(360), 'regular');
  assert.equal(widthClassFor(411), 'regular');
  assert.equal(widthClassFor(412), 'large');
  assert.equal(widthClassFor(599), 'large');
  assert.equal(widthClassFor(600), 'tablet');
});

test('a missing or zero width falls back to regular, never crashes', () => {
  for (const w of [0, -1, NaN]) assert.equal(widthClassFor(w), 'regular');
});

test('small phones get tighter margins and two choice columns', () => {
  const s = sizeClassFor(320, 640);
  assert.equal(s.margin, 12);
  assert.equal(s.choiceColumns, 2);
  assert.equal(s.short, true);
});

test('a 360 x 800 phone is regular and not short', () => {
  const s = sizeClassFor(360, 800);
  assert.deepEqual([s.width, s.short, s.margin, s.title, s.tileColumns], ['regular', false, 16, 24, 2]);
});

test('every class keeps the main button at or above the 48 tap target', () => {
  for (const w of [320, 360, 412, 700]) assert.ok(sizeClassFor(w, 800).button >= 48);
});

test('tablet content is centred within a maximum width', () => {
  assert.equal(sizeClassFor(820, 1180).maxContentWidth, 640);
});

test('column width divides the space left after gaps', () => {
  assert.equal(columnWidth(328, 2, 10), 159);
  assert.equal(columnWidth(328, 3, 8), 104);
  assert.equal(columnWidth(100, 0, 8), 100);
  assert.equal(columnWidth(10, 3, 20), 0);
});

test('font scale caps: body may grow more than titles and buttons', () => {
  assert.ok(FONT_SCALE_CAP.body > FONT_SCALE_CAP.chrome && FONT_SCALE_CAP.chrome > 1);
});
