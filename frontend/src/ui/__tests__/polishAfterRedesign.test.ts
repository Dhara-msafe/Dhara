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

test('head out: buttons fill the card and keep side padding, so labels stay inside', () => {
  const s = read('app/women/head-out/index.tsx');
  const btn = s.slice(s.indexOf('  button: {'), s.indexOf('  buttonText:'));
  assert.match(btn, /alignSelf: 'stretch'/);
  assert.match(btn, /paddingHorizontal: 16/);
  assert.match(s, /buttonText: \{[^}]*flexShrink: 1/);
  assert.match(s, /arrivedBtnRow: \{[^}]*alignSelf: 'stretch'/);
});

test('head out: the check-in timer stays on one line', () => {
  const s = read('app/women/head-out/index.tsx');
  assert.match(s, /testID="headout-timer"[^>]*numberOfLines=\{1\}[^>]*adjustsFontSizeToFit/);
});

test('head out screens cap how far the phone font setting enlarges text', () => {
  for (const f of ['index', 'destination', 'circle', 'radius']) {
    const s = read(`app/women/head-out/${f}.tsx`);
    const plain = s.match(/<Text(?=[\s>])(?! maxFontSizeMultiplier)/g) ?? [];
    assert.equal(plain.length, 0, `${f}.tsx: every Text is capped`);
  }
});

test('navy header stays fixed above the scroll on Head Out and both guardian screens', () => {
  for (const f of ['app/women/head-out/index.tsx', 'app/women/guardian-share.tsx', 'app/guardian/[token].tsx']) {
    const s = read(f);
    assert.ok(s.indexOf('<ScreenHeader') < s.indexOf('<ScrollView'), `${f}: header before scroll`);
  }
  const h = read('src/components/dhara/ScreenHeader.tsx');
  assert.match(h, /styles\.title\} numberOfLines=\{subtitle \? 1 : 2\}[^>]*maxFontSizeMultiplier=\{FONT_SCALE_CAP\.chrome\}/);
});

test('every Google map is the light map, never following the phone dark mode', () => {
  for (const f of ['src/components/dhara/AlertLocationMap.tsx', 'src/women/DestinationMapPicker.tsx', 'src/women/ActiveJourneyMap.tsx']) {
    assert.match(read(f), /provider=\{PROVIDER_GOOGLE\}[\s\S]{0,200}userInterfaceStyle="light"/, f);
  }
});
