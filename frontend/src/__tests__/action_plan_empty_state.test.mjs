/**
 * Action plan: a missing rights card must not be a dead end.
 *
 * From the Drive issues folder, 23 Nov (Nithish): the action plan for
 * "If a woman is arrested" showed, under YOUR RIGHT, only
 *
 *   "No released rights card is available yet."
 *
 * and nothing else. Try again was rendered only when `cardError` was set,
 * so when the card was simply absent the user had no way forward on a
 * safety screen.
 *
 * This only ever renders when there is no card, so it cannot touch the
 * normal path.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', '..', 'app', 'action-plan.tsx'), 'utf8');

test('the dead-end sentence is gone', () => {
  assert.ok(
    !src.includes('No released rights card is available yet'),
    'the bare "no released rights card" sentence should no longer be shown',
  );
});

test('a missing card explains itself and offers a way on', () => {
  assert.match(src, /action-plan-empty-help/);
  assert.match(src, /\{!card && !loading && !cardError && \(/);
  assert.match(src, /All help/);
});

test('Try again is offered when the card is absent, not only when it errored', () => {
  assert.match(src, /\{\(!!cardError \|\| \(!card && !loading\)\) && <Pressable testID="action-plan-retry"/);
});

test('the normal path is untouched', () => {
  // the card, its reasons, its law badges and Listen all still key off `card`
  assert.match(src, /\{card\?\.verdict \|\|/);
  assert.match(src, /\{!!card\?\.why &&/);
  assert.match(src, /\{!!card && <View style=\{styles\.badgeRow\}>/);
  assert.match(src, /testID="action-plan-listen" disabled=\{!card\}/);
});
