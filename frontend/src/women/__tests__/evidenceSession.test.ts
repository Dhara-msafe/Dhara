import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSessionElapsedMs } from '../evidenceSession';

// Fix B: the on-screen recording timer must never read `startMs` before
// start() has set it (screen remount while a session from an earlier mount
// keeps running), and must never show a runaway value over 24h.

test('Fix B: first-render / remount case — startMs is still 0 — returns 0, not Date.now()', () => {
  assert.equal(computeSessionElapsedMs(Date.now(), 0), 0);
});

test('Fix B: negative startMs (defensive) — returns 0', () => {
  assert.equal(computeSessionElapsedMs(Date.now(), -5), 0);
});

test('Fix B: a runaway value over 24 hours is clamped back to 0', () => {
  const now = Date.now();
  assert.equal(computeSessionElapsedMs(now, now - 25 * 60 * 60 * 1000), 0);
});

test('Fix B: exactly 24 hours is NOT clamped — "over 24 hours" is exclusive, matching the spec wording', () => {
  const now = Date.now();
  assert.equal(computeSessionElapsedMs(now, now - 24 * 60 * 60 * 1000), 24 * 60 * 60 * 1000);
});

test('Fix B: 24 hours + 1ms IS clamped to 0', () => {
  const now = Date.now();
  assert.equal(computeSessionElapsedMs(now, now - (24 * 60 * 60 * 1000 + 1)), 0);
});

test('Fix B: a normal in-progress recording returns the real elapsed ms', () => {
  const now = Date.now();
  const start = now - 5000;
  assert.equal(computeSessionElapsedMs(now, start), 5000);
});

test('Fix B: startMs slightly in the future (clock skew) — returns 0, not negative', () => {
  const now = Date.now();
  assert.equal(computeSessionElapsedMs(now, now + 1000), 0);
});
