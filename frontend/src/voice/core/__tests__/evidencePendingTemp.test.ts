/**
 * BATCH A2 Step 1 — Evidence Locker must not discard a recording on navigation.
 * Unit tests for ../../../women/evidencePendingTemp.ts (real repo file).
 *
 * Run with:  yarn test:voice
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  listPendingTemps,
  markPendingTemp,
  clearPendingTemp,
  pendingTempKey,
  decideOnExit,
  type PendingTempStore,
} from '../../../women/evidencePendingTemp';

function fakeStore(): PendingTempStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    async getItem(k) { return map.has(k) ? map.get(k)! : null; },
    async setItem(k, v) { map.set(k, v); },
  };
}

test('A2: a stopped temp file is registered as pending', async () => {
  const store = fakeStore();
  await markPendingTemp(store, 'u1', 'file:///tmp/a.m4a');
  const list = await listPendingTemps(store, 'u1');
  assert.equal(list.length, 1);
  assert.equal(list[0].uri, 'file:///tmp/a.m4a');
  assert.ok(store.map.has(pendingTempKey('u1')));
});

test('A2: marking the same uri twice does not duplicate it', async () => {
  const store = fakeStore();
  await markPendingTemp(store, 'u1', 'file:///tmp/a.m4a');
  await markPendingTemp(store, 'u1', 'file:///tmp/a.m4a');
  assert.equal((await listPendingTemps(store, 'u1')).length, 1);
});

test('A2: clearing only removes the proven-saved uri', async () => {
  const store = fakeStore();
  await markPendingTemp(store, 'u1', 'file:///tmp/a.m4a');
  await markPendingTemp(store, 'u1', 'file:///tmp/b.m4a');
  await clearPendingTemp(store, 'u1', 'file:///tmp/a.m4a');
  const list = await listPendingTemps(store, 'u1');
  assert.deepEqual(list.map(e => e.uri), ['file:///tmp/b.m4a']);
});

test('A2: pending temps are scoped per user', async () => {
  const store = fakeStore();
  await markPendingTemp(store, 'u1', 'file:///tmp/a.m4a');
  assert.equal((await listPendingTemps(store, 'u2')).length, 0);
});

test('A2: corrupt storage never throws and never reports false recoveries', async () => {
  const store = fakeStore();
  store.map.set(pendingTempKey('u1'), '{not json');
  assert.deepEqual(await listPendingTemps(store, 'u1'), []);
});

test('A2: a leftover temp survives for next-launch recovery', async () => {
  const store = fakeStore();
  await markPendingTemp(store, 'u1', 'file:///tmp/crash.m4a');
  // Simulated crash: nothing cleared it, so a fresh read still finds it.
  const onNextLaunch = await listPendingTemps(store, 'u1');
  assert.deepEqual(onNextLaunch.map(e => e.uri), ['file:///tmp/crash.m4a']);
});

test('A2: navigation/background while the locker records = stop-and-save, never discard', () => {
  assert.equal(decideOnExit({ lockerRecording: true, owner: 'locker' }), 'stop-and-save');
  assert.equal(decideOnExit({ lockerRecording: false, owner: 'locker' }), 'stop-and-save');
});

test('A2: a trigger-owned recording is left running, not discarded', () => {
  assert.equal(decideOnExit({ lockerRecording: false, owner: 'trigger' }), 'leave-running');
});

test('A2: idle screen exit does nothing', () => {
  assert.equal(decideOnExit({ lockerRecording: false, owner: null }), 'noop');
});
