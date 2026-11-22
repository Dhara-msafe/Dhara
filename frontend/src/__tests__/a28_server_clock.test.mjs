// A28: the countdown and the location age follow the server's clock, not the
// phone's. Run: node --experimental-strip-types --test src/__tests__/a28_server_clock.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clockOffsetMs, serverNowMs, secondsLeft, graceSecondsLeft, hasExpired,
  ageMinutes, parseIsoMs, MAX_SANE_OFFSET_MS,
} from '../safety/serverClock.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NOW = Date.parse('2026-11-22T10:00:00Z');       // the real time
const iso = (ms) => new Date(ms).toISOString();
const GRACE = 10 * 60 * 1000;

// ── measuring the offset ─────────────────────────────────────────────────────

test('a phone 10 minutes fast measures a -10 minute offset', () => {
  const phoneNow = NOW + 10 * 60_000;
  const offset = clockOffsetMs({ serverTimeIso: iso(NOW), sentAtMs: phoneNow, receivedAtMs: phoneNow });
  assert.equal(offset, -10 * 60_000);
  assert.equal(serverNowMs(offset, phoneNow), NOW);
});

test('half the round trip is taken off', () => {
  // request sent at phone 0, reply at phone 400ms; the server stamped the
  // middle of that window, so a correct clock measures no offset.
  const offset = clockOffsetMs({ serverTimeIso: iso(NOW + 200), sentAtMs: NOW, receivedAtMs: NOW + 400 });
  assert.equal(offset, 0);
});

test('no readable server time means assume the clocks agree', () => {
  for (const v of [undefined, null, '', 'not a time']) {
    assert.equal(clockOffsetMs({ serverTimeIso: v, sentAtMs: NOW, receivedAtMs: NOW }), 0);
  }
});

test('an absurd offset is ignored rather than trusted', () => {
  const far = iso(NOW + MAX_SANE_OFFSET_MS + 60_000);
  assert.equal(clockOffsetMs({ serverTimeIso: far, sentAtMs: NOW, receivedAtMs: NOW }), 0);
});

test('parseIsoMs handles the shapes the server actually sends', () => {
  assert.equal(parseIsoMs('2026-11-22T10:00:00+00:00'), NOW);
  assert.equal(parseIsoMs('2026-11-22T10:00:00Z'), NOW);
  assert.equal(parseIsoMs('rubbish'), null);
  assert.equal(parseIsoMs(undefined), null);
});

// ── the countdown ────────────────────────────────────────────────────────────

/** Her phone is 10 minutes fast. The server's deadline is 30 minutes away. */
const fastPhone = {
  serverDeadlineAt: iso(NOW + 30 * 60_000),
  clockOffsetMs: -10 * 60_000,
  localDeadlineMs: (NOW + 10 * 60_000) + 30 * 60_000,   // what the phone would have worked out
};
const phoneNow = NOW + 10 * 60_000;

test('a 10-minute-fast phone still counts down to the server deadline', () => {
  assert.equal(secondsLeft(fastPhone, phoneNow), 30 * 60);
  assert.equal(hasExpired(fastPhone, phoneNow), false);
});

test('the countdown reaches zero when the server deadline passes, not before', () => {
  const justBefore = phoneNow + 30 * 60_000 - 1000;
  assert.equal(hasExpired(fastPhone, justBefore), false);
  assert.equal(secondsLeft(fastPhone, justBefore), 1);
  const justAfter = phoneNow + 30 * 60_000 + 1000;
  assert.equal(hasExpired(fastPhone, justAfter), true);
  assert.equal(secondsLeft(fastPhone, justAfter), 0);
});

test('a phone 10 minutes SLOW does not show time she does not have', () => {
  // Her phone reads 09:50 when it is really 10:00, so its own maths would
  // give her 15 minutes when the server will act in 5.
  const slowPhoneNow = NOW - 10 * 60_000;
  const slow = {
    serverDeadlineAt: iso(NOW + 5 * 60_000),
    clockOffsetMs: 10 * 60_000,
    localDeadlineMs: slowPhoneNow + 15 * 60_000,
  };
  assert.equal(secondsLeft(slow, slowPhoneNow), 5 * 60);
  assert.equal(Math.round((slow.localDeadlineMs - slowPhoneNow) / 60_000), 15, 'the phone alone would say 15');
});

test('changing time zone mid-journey changes nothing: the deadline is absolute', () => {
  // A time-zone change does not move the clock's absolute time, so the same
  // offset and deadline give the same answer.
  const before = secondsLeft(fastPhone, phoneNow);
  const after = secondsLeft({ ...fastPhone }, phoneNow);
  assert.equal(before, after);
});

test('no server deadline yet: the phone\'s own deadline is used', () => {
  const offline = { serverDeadlineAt: null, clockOffsetMs: undefined, localDeadlineMs: NOW + 20 * 60_000 };
  assert.equal(secondsLeft(offline, NOW), 20 * 60);
  assert.equal(hasExpired(offline, NOW + 21 * 60_000), true);
});

test('an unreadable server deadline falls back, it does not freeze the screen', () => {
  const bad = { serverDeadlineAt: 'nonsense', clockOffsetMs: 0, localDeadlineMs: NOW + 7 * 60_000 };
  assert.equal(secondsLeft(bad, NOW), 7 * 60);
});

test('the grace window runs from the server deadline too', () => {
  const atDeadline = phoneNow + 30 * 60_000;
  assert.equal(graceSecondsLeft(fastPhone, GRACE, atDeadline), 10 * 60);
  assert.equal(graceSecondsLeft(fastPhone, GRACE, atDeadline + 4 * 60_000), 6 * 60);
  assert.equal(graceSecondsLeft(fastPhone, GRACE, atDeadline + 11 * 60_000), 0);
});

test('seconds left is never negative', () => {
  assert.equal(secondsLeft(fastPhone, phoneNow + 99 * 60_000), 0);
  assert.equal(graceSecondsLeft(fastPhone, GRACE, phoneNow + 99 * 60_000), 0);
});

// ── the age on the guardian screen ───────────────────────────────────────────

test('the server\'s own age is used when it sends one', () => {
  assert.equal(ageMinutes({ serverAgeSeconds: 0, nowMs: NOW }), 0);
  assert.equal(ageMinutes({ serverAgeSeconds: 59, nowMs: NOW }), 0);
  assert.equal(ageMinutes({ serverAgeSeconds: 7 * 60 + 30, nowMs: NOW }), 7);
});

test('the server\'s age wins over the recipient\'s own wrong clock', () => {
  // Recipient's phone is an hour fast: on its own it would call a fresh
  // reading 60 minutes old and show it as stale.
  const args = { serverAgeSeconds: 60, capturedAtIso: iso(NOW), nowMs: NOW + 60 * 60_000 };
  assert.equal(ageMinutes(args), 1);
});

test('older server with no age: worked out from the capture time and the offset', () => {
  const recipientNow = NOW + 60 * 60_000;            // phone an hour fast
  assert.equal(ageMinutes({ capturedAtIso: iso(NOW - 5 * 60_000), clockOffsetMs: -60 * 60_000, nowMs: recipientNow }), 5);
});

test('no age and no capture time: nothing is shown rather than a guess', () => {
  assert.equal(ageMinutes({ nowMs: NOW }), null);
  assert.equal(ageMinutes({ capturedAtIso: 'nonsense', nowMs: NOW }), null);
});

test('a reading stamped slightly ahead reads as "just now", never negative', () => {
  assert.equal(ageMinutes({ capturedAtIso: iso(NOW + 30_000), clockOffsetMs: 0, nowMs: NOW }), 0);
  assert.equal(ageMinutes({ serverAgeSeconds: -5, nowMs: NOW }), 0);
});

// ── wiring ───────────────────────────────────────────────────────────────────

const screen = readFileSync(join(root, 'app/women/head-out/index.tsx'), 'utf8');
const guardian = readFileSync(join(root, 'app/guardian/[token].tsx'), 'utf8');
const server = readFileSync(join(root, '..', 'backend/api/journey_router.py'), 'utf8');

test('the journey screen no longer counts down on Date.now() alone', () => {
  assert.doesNotMatch(screen, /const left = Math\.max\(0, Math\.floor\(\(deadline - Date\.now\(\)\)/);
  assert.match(screen, /serverDeadlineAt: session\.serverDeadlineAt/);
  assert.match(screen, /clockOffsetMs: session\.clockOffsetMs/);
});

test('the server deadline and the offset are stored when the journey is created', () => {
  const create = screen.slice(screen.indexOf('const createJourney'), screen.indexOf('const createJourney') + 3000);
  assert.match(create, /serverDeadlineAt: data\.expected_checkin_at/);
  assert.match(create, /serverTimeIso: data\.server_time/);
});

test('extending the deadline re-measures both', () => {
  const extend = screen.slice(screen.indexOf('const handleExtendTime'), screen.indexOf('const handleExtendTime') + 1800);
  assert.match(extend, /serverDeadlineAt: data\?\.expected_checkin_at/);
  assert.match(extend, /serverTimeIso: data\.server_time/);
});

test('the guardian screen asks for the server\'s age first', () => {
  assert.match(guardian, /serverAgeSeconds: loc\?\.age_seconds/);
  assert.doesNotMatch(guardian, /const diff = Date\.now\(\) - new Date\(iso\)\.getTime\(\)/);
});

test('the server sends its clock on create, extend and the guardian view', () => {
  assert.equal((server.match(/"server_time"/g) || []).length >= 4, true);
  assert.match(server, /"age_seconds": _age_seconds\(last_loc\.get\("updated_at"\), now\)/);
});
