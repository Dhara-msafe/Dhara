/**
 * Home simplification — client feedback, 24 Nov: "lot of things on screen",
 * and the cut-off card in the "For you right now" shelf.
 *
 * Home rendered nine blocks plus four tabs, a mic, All help, the bug button
 * and SOS — roughly fifteen choices on a screen people open when something
 * has gone wrong. Behind EXPO_PUBLIC_UI_V22_HOME_SIMPLE (default OFF) it
 * shows four: header, Ask, one card to resume, Help journeys.
 *
 * Source-level tests, qaModeBanner.test.mjs convention.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');

const home = read('app', '(tabs)', 'home.tsx');
const flags = read('src', 'uiV22Flags.ts');
const i18n = read('src', 'ui18n.ts');

test('flag defaults OFF', () => {
  assert.match(
    flags,
    /export const UI_V22_HOME_SIMPLE = process\.env\.EXPO_PUBLIC_UI_V22_HOME_SIMPLE === 'true';/,
  );
});

test('"For you right now" is one full-width card, not a clipped shelf', () => {
  // 280px cards in a 390px viewport left 76px of the next one showing.
  assert.match(home, /\{UI_V22_HOME_SIMPLE \? \(\s*\n\s*<View style=\{styles\.shelfSingle\}>\{forYouPrimaryCard\}<\/View>/);
  assert.match(home, /forYouCardFull: \{ width: '100%' \}/);
});

test('nothing auto-scrolls', () => {
  for (const banned of ['setInterval', 'scrollTo(', 'autoScroll', 'autoplay', 'Animated.loop']) {
    assert.ok(!home.includes(banned), `Home should not ${banned} — a task card must not slide away while it is read`);
  }
});

test('the card is defined once and shared by both branches', () => {
  assert.match(home, /const forYouPrimaryCard = primaryCase && primaryProgress \? \(/);
  // the flag-off branch renders the same const, so the old layout is untouched
  assert.match(home, /contentContainerStyle=\{styles\.shelf\}>\s*\n\s*\{forYouPrimaryCard\}/);
});

const HIDDEN = [
  ['the interests nudge', /\{!UI_V22_HOME_SIMPLE && loaded && interests\.length === 0 && \(/],
  ['the rights banner', /\{!UI_V22_HOME_SIMPLE && \(\s*\n\s*<Pressable style=\{styles\.verified\}/],
  ['the My files preview', /\{!UI_V22_HOME_SIMPLE && \(!UI_V22_P5_HOME \|\| \(primaryCase && primaryProgress\)\) && \(/],
];

for (const [what, re] of HIDDEN) {
  test(`${what} is hidden by the flag, not deleted`, () => {
    assert.match(home, re);
  });
}

test('nothing becomes unreachable: Head out and Family Journey become tiles', () => {
  assert.match(home, /UI_V22_HOME_SIMPLE && HEAD_OUT_ENABLED/);
  assert.match(home, /route: '\/women\/head-out'/);
  assert.match(home, /UI_V22_HOME_SIMPLE && familyJourneyEnabled/);
  assert.match(home, /route: '\/family-journey'/);
  // and they keep their own gates, so a switched-off feature gains no entry
  assert.ok(
    !/UI_V22_HOME_SIMPLE\s*\?\s*\[\{ key: 'j\.headout'/.test(home),
    'the Head out tile must stay behind HEAD_OUT_ENABLED',
  );
});

test('the new tile labels exist, English-only on purpose', () => {
  assert.match(i18n, /'j\.headout':\s*\{ en: 'Head out safely' \}/);
  assert.match(i18n, /'j\.family':\s*\{ en: 'Family Journey' \}/);
  // tr() falls back to en, so these render in English rather than as raw keys
  assert.match(i18n, /return \(m as any\)\[lang\] \?\? m\.en \?\? key;/);
});

test('the Ask card and Help journeys are untouched', () => {
  assert.match(home, /testID="home-mic"/);
  assert.match(home, /testID="home-type-button"/);
  assert.match(home, /testID=\{`journey-\$\{j\.key\}`\}/);
});
