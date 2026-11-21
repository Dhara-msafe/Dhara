// A10b: a location reading still waiting on the phone when the check-in time
// passes must still reach the circle that was just alerted.
// Run: node --test src/__tests__/a10b_hold_through_missed_checkin.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeHarness, hookSource } from './helpers/gpsHookHarness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ok = async () => ({ status: 200, json: async () => ({ ok: true }) });
const offline = async () => { throw new Error('Network request failed'); };

/** Journey running, one reading held because the phone was offline. */
async function withHeldReading(fetchAfter) {
  const h = makeHarness({ os: 'android', fetchImpl: offline });
  h.render('J1', true, true);
  await h.settle();
  assert.equal(h.store.queue.length, 1, 'setup: reading was not held');
  if (fetchAfter) h.setNet(fetchAfter);
  return h;
}

test('check-in missed: the held reading is still sent, with its true age', async () => {
  const h = await withHeldReading();
  // The check-in time passes: tracking stops, the journey stays open.
  h.clock.t += 600_000;
  h.render('J1', false, true);
  await h.settle();
  assert.equal(h.counts.removed, 1, 'GPS watcher should stop at the missed check-in');
  assert.equal(h.counts.watch, 1, 'no new watcher after the check-in was missed');

  h.setNet(ok);
  const before = h.sent.length;
  await h.tick();
  assert.equal(h.sent.length, before + 1, 'the held reading was never retried');
  assert.equal(h.store.queue.length, 0, 'held reading not cleared after delivery');
  const body = h.sent.at(-1).body;
  assert.equal(body.source, 'gps');
  assert.ok(body.age_seconds >= 599 && body.age_seconds <= 601, `age_seconds was ${body.age_seconds}`);
});

test('check-in missed: the retry keeps running round after round', async () => {
  const h = await withHeldReading();
  h.render('J1', false, true);
  await h.settle();
  assert.equal(h.liveTimers(), 1, 'retry timer stopped at the missed check-in');
  for (const _ of [1, 2, 3]) { h.clock.t += 30_000; await h.tick(); }
  assert.equal(h.store.queue.length, 1, 'reading lost while still offline');
  h.setNet(ok);
  await h.tick();
  assert.equal(h.store.queue.length, 0);
});

test('"I\'m safe" or journey closed: no more retries', async () => {
  for (const [label, token, enabled, keep] of [
    ['tapped I am safe', 'J1', false, false],
    ['journey cleared', null, false, false],
  ]) {
    const h = await withHeldReading();
    h.render(token, enabled, keep);
    await h.settle();
    assert.equal(h.liveTimers(), 0, label);
    const before = h.sent.length;
    h.setNet(ok);
    await h.tick();
    assert.equal(h.sent.length, before, `${label}: a reading was sent after she was done`);
  }
});

test('no new readings are taken after the check-in is missed', async () => {
  const h = await withHeldReading(ok);
  h.render('J1', false, true);
  await h.settle();
  for (let n = 0; n < 10; n++) { h.render('J1', false, true); h.clock.t += 30_000; await h.tick(); }
  assert.equal(h.counts.watch, 1, 'GPS was restarted after the check-in was missed');
  assert.equal(h.counts.current, 1, 'a new position was requested after the check-in was missed');
  assert.equal(h.liveTimers(), 1, 'more than one retry timer');
});

test('re-renders while waiting do not pile up timers or restart GPS', async () => {
  const h = await withHeldReading();
  for (let n = 0; n < 20; n++) h.render('J1', true, true);
  await h.settle();
  assert.equal(h.liveTimers(), 1);
  assert.equal(h.counts.watch, 1);
  assert.equal(h.counts.perm, 1);
});

test('source: the screen keeps retrying through a missed check-in', () => {
  const screen = readFileSync(join(root, 'app/women/head-out/index.tsx'), 'utf8');
  const call = screen.slice(screen.indexOf('const realGps = useJourneyGPS'), screen.indexOf('const realGps = useJourneyGPS') + 900);
  assert.match(call, /keepRetryingHeld:/);
  const keepLine = call.slice(call.indexOf('keepRetryingHeld:'), call.indexOf('}', call.indexOf('keepRetryingHeld:')));
  assert.doesNotMatch(keepLine, /!expired/, 'the retry must not stop when the check-in time passes');
  assert.match(keepLine, /!session\.pendingSafe/, 'the retry must stop once she has tapped I am safe');
  // A41 must stay fixed: the watcher effect still depends on two values only.
  assert.match(hookSource, /\}, \[enabled, journeyToken\]\);/);
});
