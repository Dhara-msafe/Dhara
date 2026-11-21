// A10: a location reading the server did not take is kept on the phone and
// retried, and arrives with its true age.
// Run: node --experimental-strip-types --test src/__tests__/a10_failed_uploads_kept_and_retried.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeHarness, hookSource } from './helpers/gpsHookHarness.mjs';
import {
  uploadOutcome, newestFor, afterSettled, usableFor, MAX_HELD_AGE_MS, RETRY_INTERVAL_MS,
} from '../safety/locationUploadRetry.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NOW = 1_800_000_000_000;
const iso = (agoMs) => new Date(NOW - agoMs).toISOString();
const held = (id, token, agoMs) => ({ id, journeyToken: token, lat: 1, lng: 2, accuracy: 5, area: 'A', capturedAt: iso(agoMs) });

// ── verdict on a server reply ────────────────────────────────────────────────
test('no answer, server error, sign-in refresh, too-many-requests: keep and retry', () => {
  for (const s of [null, 500, 502, 503, 401, 429, 408]) assert.equal(uploadOutcome(s), 'retry', String(s));
});
test('stored reply: done', () => {
  assert.equal(uploadOutcome(200, { ok: true }), 'stored');
  assert.equal(uploadOutcome(200, null), 'stored');
});
test('server throttle reply is NOT treated as delivered', () => {
  assert.equal(uploadOutcome(200, { ok: true, skipped: 'throttled' }), 'retry');
});
test('server will never want it: do not resend', () => {
  for (const sk of ['older_than_current', 'not_a_device_fix', 'journey already completed or sharing withdrawn']) {
    assert.equal(uploadOutcome(200, { ok: true, skipped: sk }), 'superseded', sk);
  }
  for (const s of [400, 403, 404, 410, 422]) assert.equal(uploadOutcome(s), 'drop', String(s));
});

// ── which held reading to send ───────────────────────────────────────────────
test('newest held reading for this journey is chosen', () => {
  const q = [held('a', 'J1', 90_000), held('b', 'J1', 30_000), held('c', 'J1', 60_000), held('x', 'J2', 1_000)];
  assert.equal(newestFor(q, 'J1', NOW).id, 'b');
  assert.equal(newestFor(q, 'J3', NOW), null);
});
test('too old, unreadable or future-dated readings are never sent', () => {
  const q = [held('old', 'J1', MAX_HELD_AGE_MS + 1000), { ...held('bad', 'J1', 0), capturedAt: 'nonsense' }, held('future', 'J1', -120_000)];
  assert.equal(newestFor(q, 'J1', NOW), null);
  assert.deepEqual(usableFor(q, 'J1', NOW), []);
});
test('after a reading settles, older ones and other journeys are dropped, newer kept', () => {
  const q = [held('a', 'J1', 90_000), held('b', 'J1', 30_000), held('n', 'J1', 5_000), held('x', 'J2', 1_000)];
  assert.deepEqual(afterSettled(q, 'J1', NOW - 30_000, NOW).map((e) => e.id), ['n']);
});
test('retry interval is 30 seconds', () => assert.equal(RETRY_INTERVAL_MS, 30_000));

// ── the real hook ────────────────────────────────────────────────────────────
const ok = async () => ({ status: 200, json: async () => ({ ok: true }) });
const offline = async () => { throw new Error('Network request failed'); };

test('hook: offline reading is held, then sent by the retry with its true age', async () => {
  let net = offline;
  const h = makeHarness({ os: 'android', fetchImpl: (c) => net(c) });
  h.render('J1', true); await h.settle();          // first reading fails (offline)
  assert.equal(h.store.queue.length, 1, 'failed reading was not kept');
  assert.equal(h.store.queue[0].journeyToken, 'J1');
  const before = h.sent.length;

  h.clock.t += 120_000;                             // two minutes later, still offline
  await h.tick();
  assert.equal(h.store.queue.length, 1, 'reading lost while still offline');
  assert.equal(h.sent.length, before + 1, 'retry did not try');

  h.clock.t += 30_000; net = ok;                    // network back
  await h.tick();
  assert.equal(h.store.queue.length, 0, 'held reading not cleared after delivery');
  const last = h.sent.at(-1).body;
  assert.equal(last.source, 'gps');
  assert.ok(last.age_seconds >= 149 && last.age_seconds <= 151, `age_seconds was ${last.age_seconds}`);
});

test('hook: only the newest held reading is sent; older ones are let go', async () => {
  let net = offline;
  const h = makeHarness({ os: 'android', fetchImpl: (c) => net(c) });
  h.render('J1', true); await h.settle();
  h.clock.t += 40_000; await h.emit(13.1, 77.1);    // second reading, also fails
  h.clock.t += 40_000; await h.emit(13.2, 77.2);    // third
  assert.equal(h.store.queue.length, 3);
  net = ok; const before = h.sent.length;
  h.clock.t += 5_000; await h.tick();
  assert.equal(h.sent.length, before + 1, 'more than one held reading was sent');
  assert.equal(h.sent.at(-1).body.lat, 13.2);
  assert.equal(h.store.queue.length, 0);
});

test('hook: server throttle reply keeps the reading for the next round', async () => {
  let reply = async () => ({ status: 200, json: async () => ({ ok: true, skipped: 'throttled' }) });
  const h = makeHarness({ os: 'android', fetchImpl: (c) => reply(c) });
  h.render('J1', true); await h.settle();
  assert.equal(h.store.queue.length, 1);
  reply = ok; h.clock.t += 30_000; await h.tick();
  assert.equal(h.store.queue.length, 0);
});

test('hook: a closed or missing journey does not pile up readings', async () => {
  for (const status of [404, 403, 410]) {
    const h = makeHarness({ os: 'android', fetchImpl: async () => ({ status, json: async () => ({}) }) });
    h.render('J1', true); await h.settle();
    assert.equal(h.store.queue.length, 0, String(status));
  }
});

test('hook: a live reading that gets through clears older held ones', async () => {
  let net = offline;
  const h = makeHarness({ os: 'android', fetchImpl: (c) => net(c) });
  h.render('J1', true); await h.settle();
  assert.equal(h.store.queue.length, 1);
  net = ok; h.clock.t += 40_000; await h.emit(13.5, 77.5);
  assert.equal(h.store.queue.length, 0);
});

test('hook: leftovers from another journey are cleared, never sent', async () => {
  const h = makeHarness({ os: 'android' });
  h.store.queue = [{ id: 'z', journeyToken: 'OLD', lat: 9, lng: 9, accuracy: 1, area: 'x', capturedAt: new Date(h.clock.t - 1000).toISOString() }];
  h.render('J1', true); await h.settle();
  assert.equal(h.store.queue.length, 0);
  assert.ok(h.sent.every((c) => !c.url.includes('/OLD/')));
});

test('hook: retry timer stops when the journey ends, and there is only ever one', async () => {
  const h = makeHarness({ os: 'android' });
  h.render('J1', true); await h.settle();
  for (let n = 0; n < 10; n++) h.render('J1', true);
  assert.equal(h.liveTimers(), 1);
  h.render('J1', false); await h.settle();
  assert.equal(h.liveTimers(), 0);
});

// ── wiring ───────────────────────────────────────────────────────────────────
test('source: the hook no longer swallows a failed upload', () => {
  assert.match(hookSource, /q\.enqueue\(/);
  assert.match(hookSource, /\}, \[enabled, journeyToken\]\);/, 'A41 dependency list must stay as it is');
});
test('source: held readings are cleared on "I\'m safe", "Stop sharing" and sign-out', () => {
  const screen = readFileSync(join(root, 'app/women/head-out/index.tsx'), 'utf8');
  const end = screen.slice(screen.indexOf('const endSession = useCallback'), screen.indexOf('const endSession = useCallback') + 900);
  const stop = screen.slice(screen.indexOf('const stopSharing = useCallback'), screen.indexOf('const stopSharing = useCallback') + 500);
  assert.match(end, /useLocationUploadQueue\.getState\(\)\.clearAll\(\)/);
  assert.match(stop, /useLocationUploadQueue\.getState\(\)\.clearAll\(\)/);
  assert.match(readFileSync(join(root, 'src/auth.tsx'), 'utf8'), /useLocationUploadQueue\.getState\(\)\.clearAll\(\)/);
});
