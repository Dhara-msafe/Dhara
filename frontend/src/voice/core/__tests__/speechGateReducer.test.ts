/**
 * Tests for the speech-gate reducer. Run with the same command as the rest of
 * the voice core (see README / ts-resolve.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reduceGate, INITIAL_GATE, type GateFlags } from '../speechGateReducer';

const base: GateFlags = { ...INITIAL_GATE };

test('background interrupts; returning to active does NOT auto-resume', () => {
  const bg = reduceGate(base, { type: 'app_state', state: 'background' });
  assert.equal(bg.interruptedNotResumed, true);
  const active = reduceGate(bg, { type: 'app_state', state: 'active' });
  assert.equal(active.interruptedNotResumed, true); // stays interrupted
});

test('inactive and hidden app states also interrupt', () => {
  assert.equal(reduceGate(base, { type: 'app_state', state: 'inactive' }).interruptedNotResumed, true);
  assert.equal(reduceGate(base, { type: 'app_state', state: 'hidden' }).interruptedNotResumed, true);
});

test('a call / headphone unplug interrupts', () => {
  assert.equal(reduceGate(base, { type: 'audio_interruption' }).interruptedNotResumed, true);
});

test('a web tab switch interrupts', () => {
  assert.equal(reduceGate(base, { type: 'web_tab_hidden' }).interruptedNotResumed, true);
});

test('only an explicit resume request clears the interruption', () => {
  const interrupted = reduceGate(base, { type: 'audio_interruption' });
  const resumed = reduceGate(interrupted, { type: 'resume_requested' });
  assert.equal(resumed.interruptedNotResumed, false);
});

// 22 Nov (owner GO): the Shield blocks speech only WHILE the user is in it.
// The old rule ("forces Quiet on and never clears it") left voice off for
// good after one visit with no way back.
test("entering Women's Shield blocks speech while there and does not touch Quiet", () => {
  const s = reduceGate({ ...base, quiet: false }, { type: 'enter_womens_shield' });
  assert.equal(s.inWomensShield, true);
  assert.equal(s.quiet, false, 'Quiet is the user\'s choice only');
  // a resume request does not lift the Shield while still inside it
  const after = reduceGate(s, { type: 'resume_requested' });
  assert.equal(after.inWomensShield, true);
});

test("leaving Women's Shield restores the previous voice state exactly", () => {
  for (const quiet of [false, true]) {
    const before = { ...base, quiet };
    const inside = reduceGate(before, { type: 'enter_womens_shield' });
    const left = reduceGate(inside, { type: 'leave_womens_shield' });
    assert.deepEqual(left, before);
  }
});
