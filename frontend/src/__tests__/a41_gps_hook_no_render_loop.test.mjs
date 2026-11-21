// A41: useJourneyGPS must start GPS watching once, not on every render.
// Runs the real hook against a tiny stand-in for React and expo-location.
// Run: node --test src/__tests__/a41_gps_hook_no_render_loop.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, hookSource as src } from './helpers/gpsHookHarness.mjs';

test('web: enabling GPS settles instead of looping, and reports web as unavailable', () => {
  const h = makeHarness({ os: 'web' });
  const s = h.render('tok', true);
  assert.equal(s.error, 'GPS not available in web preview');
  assert.equal(s.tracking, false);
  assert.equal(h.counts.effectRuns, 1);
  for (let n = 0; n < 30; n++) h.render('tok', true);
  assert.equal(h.counts.effectRuns, 1, 'effect ran again on a plain re-render');
});

test('android: 30 re-renders start permission + watcher exactly once', async () => {
  const h = makeHarness({ os: 'android' });
  h.render('tok', true);
  await h.settle();
  for (let n = 0; n < 30; n++) { h.render('tok', true); await Promise.resolve(); }
  await h.settle();
  assert.equal(h.counts.effectRuns, 1);
  assert.equal(h.counts.perm, 1);
  assert.equal(h.counts.current, 1);
  assert.equal(h.counts.watch, 1);
  assert.equal(h.counts.removed, 0, 'watcher was stopped while the journey was still on');
});

test('android: watcher still stops when the journey ends, and restarts for a new journey', async () => {
  const h = makeHarness({ os: 'android' });
  h.render('tok', true); await h.settle();
  h.render('tok', false); await h.settle();
  assert.equal(h.counts.removed, 1);
  h.render('tok2', true); await h.settle();
  assert.equal(h.counts.watch, 2);
  assert.equal(h.counts.effectRuns, 3);
});

test('source: the start/stop effect depends only on enabled and journeyToken', () => {
  assert.match(src, /\}, \[enabled, journeyToken\]\);/);
  assert.doesNotMatch(src, /\[enabled, journeyToken, requestPermission, handlePosition\]/);
});
