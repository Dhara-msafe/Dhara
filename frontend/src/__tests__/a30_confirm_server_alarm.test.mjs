/**
 * A30 — tell her whether the server-held check-in alarm is armed.
 *
 * Reported in the location code review (19 Nov 2026). Head Out promises that
 * if she misses her check-in, DHARA's server alerts the people she chose,
 * even with her phone off. That only holds once the server has accepted the
 * journey. app/women/head-out/index.tsx used to send the journey to the
 * server ONCE, silently (`.catch(() => {})`, no retry, no message). If that
 * request failed, no server alarm existed, yet the screen still showed a
 * running timer.
 *
 * After this change:
 *   - the request is retried until it works (2 s, 5 s, 10 s, then every 30 s);
 *   - every attempt carries one client_ref, so the server returns the same
 *     journey if an earlier attempt got through but its reply was lost;
 *   - the screen says "connecting", then a plain warning after 3 failures,
 *     and confirms once the server holds the deadline;
 *   - if the timer runs out and the server never had the journey, the screen
 *     says her circle has NOT been alerted.
 *
 * Two layers: pure-logic tests of src/safety/journeyAlarm.ts, and source-level
 * wiring checks on index.tsx (which imports react-native and cannot run in
 * plain Node; same convention as the A09 and B-96 tests).
 *
 * Run: node --experimental-strip-types src/__tests__/a30_confirm_server_alarm.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  alarmStatus, needsServerJourney, retryDelayMs, journeyClientRef, ALARM_COPY,
  QUICK_RETRY_DELAYS_MS, SLOW_RETRY_MS, FAILURES_BEFORE_WARNING,
} from '../safety/journeyAlarm.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); console.log(`  ✅  ${label}`); passed++; }
  catch (e) { console.log(`  ❌  ${label}\n      ${e.message}`); failed++; }
}

console.log('\n── A30 — when a server journey is needed ───────────────────────');

test('needed when location sharing is on', () => {
  assert.equal(needsServerJourney(true, 0), true);
});
test('needed when anyone was selected, even with location sharing off', () => {
  assert.equal(needsServerJourney(false, 1), true);
});
test('not needed with location sharing off and no one selected', () => {
  assert.equal(needsServerJourney(false, 0), false);
});

console.log('\n── A30 — what the screen should say ────────────────────────────');

const st = (needs, token, fails) => alarmStatus({ needsServerJourney: needs, hasJourneyToken: token, failedAttempts: fails });

test('no server journey needed: nothing to show', () => {
  assert.equal(st(false, false, 0), 'not_needed');
  assert.equal(st(false, false, 9), 'not_needed');
});
test('before any reply: connecting', () => {
  assert.equal(st(true, false, 0), 'connecting');
});
test('one or two failures: still connecting, no alarming message yet', () => {
  assert.equal(st(true, false, 1), 'connecting');
  assert.equal(st(true, false, 2), 'connecting');
});
test('three failures: the plain warning', () => {
  assert.equal(FAILURES_BEFORE_WARNING, 3);
  assert.equal(st(true, false, 3), 'not_active');
  assert.equal(st(true, false, 40), 'not_active');
});
test('once the server returns a token: active, whatever failed before', () => {
  assert.equal(st(true, true, 0), 'active');
  assert.equal(st(true, true, 7), 'active');
});

console.log('\n── A30 — retry timing ──────────────────────────────────────────');

test('the first attempt is immediate', () => {
  assert.equal(retryDelayMs(0), 0);
});
test('quick retries are 2 s, 5 s and 10 s', () => {
  assert.deepEqual([...QUICK_RETRY_DELAYS_MS], [2000, 5000, 10000]);
  assert.equal(retryDelayMs(1), 2000);
  assert.equal(retryDelayMs(2), 5000);
  assert.equal(retryDelayMs(3), 10000);
});
test('after that it keeps trying every 30 s, never giving up', () => {
  assert.equal(SLOW_RETRY_MS, 30000);
  assert.equal(retryDelayMs(4), 30000);
  assert.equal(retryDelayMs(500), 30000);
});
test('the warning appears within about 20 s of starting', () => {
  // attempts at 0 s, +2 s, +5 s: the third failure lands 7 s plus request time in.
  const waited = retryDelayMs(1) + retryDelayMs(2);
  assert.ok(waited <= 20000, `waited ${waited} ms`);
});
test('bad input never produces a negative or NaN delay', () => {
  for (const v of [-1, NaN, undefined, null]) assert.equal(retryDelayMs(v), 0);
});

console.log('\n── A30 — the reference that makes a retry safe ─────────────────');

test('same user and same journey start give the same reference every time', () => {
  assert.equal(journeyClientRef('u-123', 1795000000000), journeyClientRef('u-123', 1795000000000));
});
test('a different journey start gives a different reference', () => {
  assert.notEqual(journeyClientRef('u-123', 1795000000000), journeyClientRef('u-123', 1795000060000));
});
test('a different user gives a different reference', () => {
  assert.notEqual(journeyClientRef('u-123', 1795000000000), journeyClientRef('u-456', 1795000000000));
});
test('the reference always fits the server rule (8 to 80 safe characters)', () => {
  const rule = /^[A-Za-z0-9_.-]{8,80}$/;
  const ids = ['u-123', '5f3c2e1a-9b7d-4c6e-8f10-aabbccddeeff', 'a b/c;d', '', null, undefined, 'x'.repeat(300)];
  for (const id of ids) assert.match(journeyClientRef(id, 1795000000000), rule, `failed for ${String(id).slice(0, 20)}`);
  assert.match(journeyClientRef('u-1', NaN), rule);
});

console.log('\n── A30 — wording ───────────────────────────────────────────────');

test('the warning says plainly that the circle will not be told', () => {
  assert.equal(ALARM_COPY.not_active.title, 'Automatic alerts are NOT active');
  assert.match(ALARM_COPY.not_active.body, /will not be told if you miss your check-in/);
  assert.match(ALARM_COPY.not_active.body, /contact them yourself/);
});
test('connecting says alerts are not active yet', () => {
  assert.match(ALARM_COPY.connecting.body, /not active until this finishes/);
});
test('the confirmation does not promise delivery to anyone', () => {
  // Whether an alert reaches a person depends on server settings the phone
  // cannot see. Only claim what is known: the server holds the deadline.
  assert.equal(ALARM_COPY.active.body, "Connected. DHARA's server is holding your check-in time.");
  assert.doesNotMatch(ALARM_COPY.active.body, /will be (alerted|notified|told)/i);
});
test('after a missed check-in with no server journey: the circle has NOT been alerted', () => {
  assert.equal(ALARM_COPY.expired_not_active.title, 'Your trusted circle has NOT been alerted');
  assert.match(ALARM_COPY.expired_not_active.body, /112/);
});
test('no banned reassurance words anywhere in the copy', () => {
  const all = JSON.stringify(ALARM_COPY).toLowerCase();
  for (const w of ['guaranteed', 'help is on the way', 'police notified', 'verified']) {
    assert.ok(!all.includes(w), `contains "${w}"`);
  }
});

console.log('\n── A30 — wiring in head-out/index.tsx ──────────────────────────');

const src = readFileSync(join(__dirname, '../../app/women/head-out/index.tsx'), 'utf8');
const createStart = src.indexOf('const createJourney = useCallback(async (): Promise<boolean> => {');
const createEnd = src.indexOf('}, [authToken, journeyToken]);', createStart);
const createBody = src.slice(createStart, createEnd);

test('the journey screen imports the alarm rules', () => {
  assert.match(src, /import \{ alarmStatus, needsServerJourney, retryDelayMs, journeyClientRef, ALARM_COPY \} from '@\/src\/safety\/journeyAlarm';/);
});
test('the old one-shot guard is gone', () => {
  assert.ok(!src.includes('journeyCreateAttemptedRef'));
});
test('createJourney exists and sends the client_ref', () => {
  assert.ok(createStart > -1 && createEnd > createStart, 'createJourney not found');
  assert.match(createBody, /client_ref: journeyClientRef\(userIdForRef\.current, session\.startTime\)/);
});
test('a failed attempt is counted, not swallowed', () => {
  assert.match(createBody, /if \(!r\.ok\) throw new Error/);
  assert.match(createBody, /setCreateFailures\(n => n \+ 1\);/);
  assert.ok(!createBody.includes('.catch(() => {});   // non-fatal — GPS tracking stays best-effort'));
});
test('success stores the token and resets the failure count', () => {
  assert.match(createBody, /setJourneyToken\(data\.token\);/);
  assert.match(createBody, /setCreateFailures\(0\);/);
});
test('two requests can never overlap', () => {
  assert.match(createBody, /createInFlightRef\.current\) return false;/);
  assert.match(createBody, /createInFlightRef\.current = true;/);
  assert.match(createBody, /createInFlightRef\.current = false;/);
});
test('a journey she already ended is closed on the server, not kept', () => {
  assert.match(createBody, /if \(!latest \|\| latest\.startTime !== session\.startTime\)/);
  assert.match(createBody, /\/api\/journey\/status\/\$\{data\.token\}\/safe/);
});
test('the retry effect uses the shared timing and cleans up its timer', () => {
  assert.match(src, /setTimeout\(\(\) => \{ void createJourney\(\); \}, retryDelayMs\(createFailures\)\);/);
  assert.match(src, /return \(\) => clearTimeout\(timer\);/);
  assert.match(src, /if \(!serverJourneyNeeded \|\| expired \|\| !authToken \|\| journeyToken\) return;/);
});
test('ending the journey resets the failure count', () => {
  const s = src.indexOf('const endSession = useCallback(async () => {');
  const e = src.indexOf('}, [authToken, journeyToken, user]);', s);
  assert.match(src.slice(s, e), /setCreateFailures\(0\);/);
});
test('all four on-screen states are rendered', () => {
  for (const id of ['headout-alarm-connecting', 'headout-alarm-not-active', 'headout-alarm-active', 'headout-alarm-not-active-expired']) {
    assert.ok(src.includes(`testID="${id}"`), `missing ${id}`);
  }
});
test('the warning has a working "try again" button', () => {
  assert.match(src, /testID="headout-alarm-retry"/);
  assert.match(src, /onPress=\{\(\) => \{ void createJourney\(\); \}\}/);
});
test('the warnings are announced to screen readers', () => {
  const a = src.indexOf('testID="headout-alarm-not-active"');
  assert.match(src.slice(a, a + 120), /accessibilityRole="alert"/);
  const b = src.indexOf('testID="headout-alarm-not-active-expired"');
  assert.match(src.slice(b, b + 120), /accessibilityRole="alert"/);
});
test('the missed-check-in "not alerted" card shows only when no server journey exists', () => {
  assert.match(src, /\{serverJourneyNeeded && !journeyToken && \(\s*<View style=\{\[styles\.statusCard, styles\.alarmOffCard\]\} testID="headout-alarm-not-active-expired"/);
});

console.log(`\n  ${passed} passed   ${failed} failed   ${passed + failed} total\n`);
if (failed > 0) process.exit(1);
