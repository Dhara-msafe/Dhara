/**
 * B-95 — "Speaker (listen) icon on chat answers has no accessible label."
 *
 * Before this fix, the listen/speaker Pressable on both chat-answer
 * screens had no accessibilityRole or accessibilityLabel at all -- a
 * screen-reader user focusing the control heard nothing identifying what
 * it was or what tapping it would do, and no visible text label exists on
 * the icon-only button either way.
 *
 * Scope: the two screens that actually show "chat answers" with a listen
 * icon per message -- the live chat screen (app/(tabs)/index.tsx) and the
 * saved-session replay screen (app/session/[id].tsx). Other speaker icons
 * elsewhere in the app (officer card, panic lesson, settings, visitor
 * flows, FIR draft) are different UI contexts, not "chat answers", and are
 * out of scope for this item.
 *
 * Fix: both Pressables now set accessibilityRole="button" and an
 * accessibilityLabel that reflects the current speaking state, so a
 * screen reader announces both what the control is and what tapping it
 * will do next ("Listen to this answer" vs. "Stop reading answer aloud").
 *
 * Source-level wiring test (same convention as qaModeBanner.test.mjs /
 * nearestHelp.logic.test.mjs) -- no RN renderer in this plain-Node test
 * setup.
 *
 * Run with: node --experimental-strip-types src/__tests__/b95_speaker_icon_a11y_label.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHAT = join(__dirname, '..', '..', 'app', '(tabs)', 'index.tsx');
const SESSION = join(__dirname, '..', '..', 'app', 'session', '[id].tsx');

const chatSrc = readFileSync(CHAT, 'utf8');
const sessionSrc = readFileSync(SESSION, 'utf8');

function assertSpeakButtonHasLabel(src, label) {
  // Isolate a window around the `speak-${m.id}` Pressable's own opening
  // tag, so the assertion can't accidentally match some other, unrelated
  // accessibilityLabel elsewhere in the same file. A fixed-size window
  // (rather than scanning for the tag's closing `>`) avoids false matches
  // on the `>` inside an arrow function prop like `onPress={() => ...}`.
  const idx = src.indexOf('testID={`speak-${m.id}`}');
  assert.ok(idx > -1, `${label}: speak-\${m.id} Pressable not found`);
  const tagStart = src.lastIndexOf('<Pressable', idx);
  const tag = src.slice(tagStart, idx + 400);
  assert.ok(tag.includes('accessibilityRole="button"'), `${label}: missing accessibilityRole="button"`);
  assert.ok(/accessibilityLabel=\{speakingId === m\.id \? '[^']+' : '[^']+'\}/.test(tag), `${label}: missing a state-reflecting accessibilityLabel`);
}

test('live chat screen: the listen/stop speaker icon has an accessible label', () => {
  assertSpeakButtonHasLabel(chatSrc, '(tabs)/index.tsx');
});

test('saved-session replay screen: the listen/stop speaker icon has an accessible label', () => {
  assertSpeakButtonHasLabel(sessionSrc, 'session/[id].tsx');
});

test('the label text itself distinguishes "listen" from "stop" rather than repeating one generic label', () => {
  for (const [src, label] of [[chatSrc, '(tabs)/index.tsx'], [sessionSrc, 'session/[id].tsx']]) {
    assert.ok(src.includes("'Listen to this answer'"), `${label}: missing the "listen" state label`);
    assert.ok(src.includes("'Stop reading answer aloud'"), `${label}: missing the "stop" state label`);
  }
});
