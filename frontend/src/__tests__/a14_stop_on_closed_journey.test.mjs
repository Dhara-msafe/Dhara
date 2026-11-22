// A14: when the server has closed a journey, the phone stops uploading to it,
// lets go of what it was holding, and tells the screen once.
// Run: node --experimental-strip-types --test src/__tests__/a14_stop_on_closed_journey.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeHarness } from './helpers/gpsHookHarness.mjs';
import { journeyIsClosed, uploadOutcome } from '../safety/locationUploadRetry.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const reply = (status, body = {}) => async () => ({ status, json: async () => body });
const ok = reply(200, { ok: true });

// ── reading the server's answer ──────────────────────────────────────────────

test('gone or expired means closed', () => {
  assert.equal(journeyIsClosed(404), true);
  assert.equal(journeyIsClosed(410), true);
});

test('the server\'s own words for a finished journey mean closed', () => {
  for (const skipped of [
    'journey already completed or sharing withdrawn',
    'journey_completed',
    'sharing_withdrawn',
    'Journey Already Completed',
  ]) {
    assert.equal(journeyIsClosed(200, { ok: true, skipped }), true, skipped);
  }
});

test('an ordinary skip is not a closed journey', () => {
  for (const skipped of ['throttled', 'not_a_device_fix', 'older_than_current']) {
    assert.equal(journeyIsClosed(200, { ok: true, skipped }), false, skipped);
  }
  assert.equal(journeyIsClosed(200, { ok: true }), false);
});

test('a stored reading is not a closed journey', () => {
  assert.equal(journeyIsClosed(200, null), false);
  assert.equal(journeyIsClosed(204), false);
});

test('no answer, a server error or a sign-in problem is never read as closed', () => {
  // These are retried, not treated as the end of the journey.
  for (const s of [null, 500, 502, 401, 429, 408]) {
    assert.equal(journeyIsClosed(s), false, String(s));
    assert.equal(uploadOutcome(s), 'retry', String(s));
  }
});

test('403 stops the uploads but does not end her journey', () => {
  // "Not your journey" can also be a mismatched sign-in; clearing her
  // journey over that would be worse than simply not uploading.
  assert.equal(journeyIsClosed(403), false);
  assert.equal(uploadOutcome(403), 'drop');
});

// ── the hook ─────────────────────────────────────────────────────────────────

function harness(fetchImpl) {
  const closed = [];
  const h = makeHarness({ os: 'android', fetchImpl });
  h.closed = closed;
  h.onClosed = () => closed.push(Date.now());
  return h;
}

test('a closed journey tells the screen once, however many rounds run', async () => {
  const h = harness(reply(410, {}));
  h.render('J1', true, true, h.onClosed);
  await h.settle();
  assert.equal(h.closed.length, 1, 'the screen was not told');
  for (let n = 0; n < 5; n++) { h.clock.t += 30_000; await h.tick(); }
  assert.equal(h.closed.length, 1, 'the screen was told more than once');
});

test('held readings for that journey are let go, not retried forever', async () => {
  let net = async () => { throw new Error('offline'); };
  const h = harness((c) => net(c));
  h.render('J1', true, true, h.onClosed);
  await h.settle();
  assert.equal(h.store.queue.length, 1, 'setup: nothing was held');
  net = reply(404, {});
  h.clock.t += 30_000;
  await h.tick();
  assert.equal(h.store.queue.length, 0, 'held readings outlived the journey');
  assert.equal(h.closed.length, 1);
});

test('a live journey is never reported as closed', async () => {
  const h = harness(ok);
  h.render('J1', true, true, h.onClosed);
  await h.settle();
  for (let n = 0; n < 3; n++) { h.clock.t += 40_000; await h.emit(13.1 + n / 10, 77.1); }
  assert.equal(h.closed.length, 0);
});

test('a throttled reply keeps the journey alive', async () => {
  const h = harness(reply(200, { ok: true, skipped: 'throttled' }));
  h.render('J1', true, true, h.onClosed);
  await h.settle();
  assert.equal(h.closed.length, 0);
  assert.equal(h.store.queue.length, 1, 'a throttled reading should still be held');
});

test('a new journey can be reported closed in its turn', async () => {
  const h = harness(reply(404, {}));
  h.render('J1', true, true, h.onClosed);
  await h.settle();
  h.render('J2', true, true, h.onClosed);
  await h.settle();
  assert.equal(h.closed.length, 2);
});

// ── wiring ───────────────────────────────────────────────────────────────────

const screen = readFileSync(join(root, 'app/women/head-out/index.tsx'), 'utf8');

test('the screen clears the journey without claiming she is safe', () => {
  const handler = screen.slice(
    screen.indexOf('const handleJourneyClosedByServer'),
    screen.indexOf('const handleJourneyClosedByServer') + 900,
  );
  assert.match(handler, /setSession\(null\)/);
  assert.match(handler, /removeItem\(SESSION_KEY\)/);
  assert.match(handler, /clearAll\(\)/);
  assert.doesNotMatch(handler, /setSafeConfirmed\(true\)/, 'the server ended it, she did not say she was safe');
});

test('the screen tells her why the journey ended, and the notice clears on a new one', () => {
  assert.match(screen, /testID="headout-journey-closed"/);
  assert.match(screen, /onJourneyClosed: handleJourneyClosedByServer/);
  assert.match(screen, /if \(session\) setClosedByServer\(false\)/);
});
