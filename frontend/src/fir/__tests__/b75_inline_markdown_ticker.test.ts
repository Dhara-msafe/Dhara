/** B-75 (21 Nov web retest): raw ** in FIR chat; legal ticker text x3. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { splitInlineBold, stripInlineMarkdown } from '../inlineMarkdown';

const ROOT = join(import.meta.dirname, '..', '..', '..');

test('**x** becomes a bold segment, no asterisks survive', () => {
  const segs = splitInlineBold('I calculated the incident happened on **yesterday, 15/11/2026**.\nIs that correct?');
  assert.deepEqual(segs.map(s => s.bold), [false, true, false]);
  assert.equal(segs[1].text, 'yesterday, 15/11/2026');
  assert.ok(segs.every(s => !s.text.includes('**')));
});

test('unpaired ** is dropped, plain text untouched', () => {
  assert.deepEqual(splitInlineBold('a ** b'), [{ text: 'a  b', bold: false }]);
  assert.deepEqual(splitInlineBold('no markers'), [{ text: 'no markers', bold: false }]);
});

test('read-aloud text has no asterisks', () => {
  assert.equal(stripInlineMarkdown('the **location** of the incident'), 'the location of the incident');
});

test('FIR bubble renders bot text through the bold renderer and speaks stripped text', () => {
  const src = readFileSync(join(ROOT, 'app/fir-draft/index.tsx'), 'utf8');
  assert.match(src, /isBot \? renderInlineBold\(text\)/);
  assert.match(src, /onSpeak\(msgId, stripInlineMarkdown\(text\)\)/);
});

test('ticker: measurer unmounts after measuring, loop duplicate hidden from assistive tech', () => {
  const src = readFileSync(join(ROOT, 'src/components/MarqueeBanner.tsx'), 'utf8');
  assert.match(src, /\{singleWidth === 0 && \(\s*\n\s*<ScrollView/);
  // Exactly one of the two loop copies is hidden.
  const loop = src.slice(src.indexOf('<Animated.View'), src.indexOf('</Animated.View>'));
  assert.equal((loop.match(/\{SINGLE\}/g) ?? []).length, 2);
  assert.equal((loop.match(/aria-hidden/g) ?? []).length, 1);
});
