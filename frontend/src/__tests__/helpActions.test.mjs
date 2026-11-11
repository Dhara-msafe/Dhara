/**
 * B-14 — "QA message mismatch in helpActions" (W2-J01).
 *
 * openPhone() used to pick its returned status text from OUTBOUND_LIVE
 * alone — the master outbound switch — rather than from what openExternal()
 * actually did. OUTBOUND_LIVE being "live" does not mean every channel
 * dispatches for real: the per-channel build profile (internal_qa /
 * closed_testing / production) can still simulate the dialler while the
 * master switch is live (see outbound.ts's shouldDispatch()/POLICY table —
 * dialler is 'simulate' under internal_qa regardless of the master switch).
 * In that combination, openExternal() would show its own "Simulated —
 * nothing sent" alert and silently skip opening anything (returning
 * 'blocked'), while the old openPhone(), having only checked OUTBOUND_LIVE,
 * took the "live" branch and returned "Continue in your phone's dialler…" —
 * two contradictory messages for one tap.
 *
 * composeAlert() never had this bug: it already branches on composeSms()'s
 * actual SmsResult ('composer' / 'blocked' / 'simulated'), never on
 * OUTBOUND_LIVE. The fix makes openPhone() do the same — branch on
 * openExternal()'s actual OpenResult ('opened' / 'blocked') — so the two
 * functions can no longer drift apart the way the register's re-check noted
 * ("helpActions.ts changed (SMS results) but calls still skip
 * shouldDispatch").
 *
 * Source-level wiring checks only (helpActions.ts transitively imports
 * react-native via outbound.ts, so it cannot be executed under plain
 * `node --test`; see nearestHelp.logic.test.mjs / qaModeBanner.test.mjs for
 * the same convention elsewhere in this repo).
 *
 * Run with: node --experimental-strip-types --test src/__tests__/helpActions.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HELP_ACTIONS = join(__dirname, '..', 'women', 'helpActions.ts');
const src = readFileSync(HELP_ACTIONS, 'utf8');

function fn(name) {
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start !== -1, `${name} not found`);
  // naive brace match from the first '{' after the signature
  const braceStart = src.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`could not find end of ${name}`);
}

test('openPhone no longer reads OUTBOUND_LIVE at all — the simulated/live message is picked from openExternal\'s own result', () => {
  const body = fn('openPhone');
  assert.ok(!/OUTBOUND_LIVE/.test(body), 'openPhone must not branch on OUTBOUND_LIVE');
});

test('openPhone branches on openExternal\'s actual OpenResult ("blocked" vs anything else)', () => {
  const body = fn('openPhone');
  assert.ok(/const result = await openExternal\(/.test(body), 'must capture openExternal\'s return value');
  assert.ok(/if \(result === 'blocked'\)/.test(body), 'must branch on the real dispatch outcome');
});

test('openPhone still returns the correct wording for each outcome', () => {
  const body = fn('openPhone');
  assert.match(body, /dialler was not opened and no call was placed/);
  assert.match(body, /Continue in your phone's dialler/);
  assert.match(body, /This device could not open a dialler/);
});

test('composeAlert already branches on composeSms\'s real SmsResult in its live-mode path (must not regress)', () => {
  const body = fn('composeAlert');
  // composeAlert's `if (!OUTBOUND_LIVE)` quick path is safe (unlike the old
  // openPhone's): shouldDispatch() is always false when OUTBOUND_LIVE is
  // false, for every profile, so that quick path can never disagree with
  // what composeSms actually does. The part that matters is the live-mode
  // path below it, which must consult composeSms's real result rather than
  // assuming success.
  assert.ok(/const result = await composeSms\(/.test(body));
  assert.ok(/result === 'composer'/.test(body));
  assert.ok(/result === 'blocked' \|\| result === 'simulated'/.test(body));
});
