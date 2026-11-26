/** First-run permission setup — node:test coverage for src/permissions/core.ts. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSetupNext, toOutcome, PERMISSION_ITEMS } from '../core.ts';

test('granted responses map to granted', () => {
  assert.equal(toOutcome({ granted: true }), 'granted');
  assert.equal(toOutcome({ status: 'granted' }), 'granted');
});

test('a denial Android can still ask about again is "denied"', () => {
  assert.equal(toOutcome({ granted: false, canAskAgain: true }), 'denied');
});

test('a denial Android will not ask about again is "blocked"', () => {
  assert.equal(toOutcome({ granted: false, status: 'denied', canAskAgain: false }), 'blocked');
});

test('a missing response (module failed) is "unavailable"', () => {
  assert.equal(toOutcome(null), 'unavailable');
});

test('parseSetupNext keeps known destinations and falls back to login', () => {
  assert.equal(parseSetupNext('home'), 'home');
  assert.equal(parseSetupNext(['guest']), 'guest');
  assert.equal(parseSetupNext('signup'), 'signup');
  for (const junk of [undefined, '', 'admin', 3, null]) assert.equal(parseSetupNext(junk), 'login');
});

test('setup asks exactly microphone, location and notifications — not camera', () => {
  assert.deepEqual(PERMISSION_ITEMS.map((p) => p.key), ['microphone', 'location', 'notifications']);
});

import { pickEmergencyFix, LAST_KNOWN_MAX_AGE_MS } from '../core.ts';

test('emergency fix: a fresh fix always wins', () => {
  const fresh = { timestamp: 1000 }, last = { timestamp: 900 };
  assert.deepEqual(pickEmergencyFix(fresh, last, 2000), { point: fresh, stale: false });
});

test('emergency fix: falls back to a recent last-known position', () => {
  const last = { timestamp: 10_000 };
  assert.deepEqual(pickEmergencyFix(null, last, 10_000 + 60_000), { point: last, stale: true });
});

test('emergency fix: an old last-known position is not shared', () => {
  const last = { timestamp: 0 };
  assert.equal(pickEmergencyFix(null, last, LAST_KNOWN_MAX_AGE_MS + 1), null);
});

test('emergency fix: nothing at all gives null', () => {
  assert.equal(pickEmergencyFix(null, null, 5), null);
});
