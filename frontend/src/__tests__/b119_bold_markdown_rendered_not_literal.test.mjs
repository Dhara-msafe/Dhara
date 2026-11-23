/**
 * B-119 — the FIR chat showed raw "**" markdown characters on screen.
 *
 * Root cause: bot messages throughout fir_engine.py use **bold** markdown
 * to emphasize key words (e.g. "I calculated the incident happened on
 * **15 November 2026**."), but app/fir-draft/index.tsx's MessageBubble
 * rendered bot text as a single plain <Text>{text}</Text> with no markdown
 * parsing at all, and its "Listen" button passed that same raw text
 * (asterisks included) straight to text-to-speech.
 *
 * Fix verified here (source-level, no RN renderer in this plain-Node test
 * setup -- same convention as b122/b118's tests): a new
 * src/chat/boldMarkdown.ts exports splitBold() (plain/bold segments for the
 * on-screen bubble) and stripBold() (markers removed, for TTS); both the
 * logic itself and index.tsx's use of them are checked here.
 *
 * Run with:
 *   node --experimental-strip-types --test src/__tests__/b119_bold_markdown_rendered_not_literal.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { splitBold, stripBold } from '../chat/boldMarkdown.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIR_DRAFT_INDEX = join(__dirname, '..', '..', 'app', 'fir-draft', 'index.tsx');
const indexSrc = readFileSync(FIR_DRAFT_INDEX, 'utf8');

test('splitBold turns a **bold** message into plain/bold segments, markers removed', () => {
  const segs = splitBold('I calculated the incident happened on **15 November 2026**.\nIs that correct?');
  // No segment should still carry a literal "**".
  assert.ok(segs.every((s) => !s.text.includes('**')));
  const bold = segs.find((s) => s.bold && s.text === '15 November 2026');
  assert.ok(bold, `expected a bold "15 November 2026" segment, got ${JSON.stringify(segs)}`);
});

test('splitBold handles multiple bold spans and plain text with no markers at all', () => {
  const segs = splitBold('did this happen on **15 November 2026** (today) or was it **14 November 2026**?');
  const boldTexts = segs.filter((s) => s.bold).map((s) => s.text);
  assert.deepEqual(boldTexts, ['15 November 2026', '14 November 2026']);

  const plain = splitBold('Could you confirm the date of the incident?');
  assert.equal(plain.length, 1);
  assert.equal(plain[0].bold, false);
});

test('stripBold removes the markers but keeps the emphasized text, for TTS', () => {
  const spoken = stripBold('I calculated the incident happened on **15 November 2026**.\nIs that correct?');
  assert.ok(!spoken.includes('*'));
  assert.ok(spoken.includes('15 November 2026'));
});

test('the chat bubble renders bot text through splitBold instead of showing the raw string', () => {
  assert.match(indexSrc, /import\s*{\s*splitBold,\s*stripBold\s*}\s*from\s*['"]@\/src\/chat\/boldMarkdown['"]/);
  assert.match(indexSrc, /splitBold\(text\)\.map/);
  // Regression guard: the old bare `{isBot ? text : ...}` rendering (no
  // markdown handling at all) must be gone from the bot branch.
  assert.doesNotMatch(indexSrc, /\{isBot \? text : `\$\{text\} `\}/);
});

test('the TTS "speak" path strips bold markers before handing text to the speaker', () => {
  assert.match(indexSrc, /const text = stripBold\(rawText\)/);
});
