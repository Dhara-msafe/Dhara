/**
 * BATCH A1 — Evidence Locker audio-session fix.
 * Unit tests for withMicLease() / isMicHeldByEvidenceLocker() in
 * ../../micArbiterGuard.ts.
 *
 * Run with:  node --experimental-strip-types --test src/voice/core/__tests__/
 * (Node 22.6+). No Expo, React or device needed — micArbiterGuard.ts only
 * imports the pure-TypeScript audioResourceArbiter, never expo-audio.
 *
 * Requires EXPO_PUBLIC_AUDIO_ARBITER_ENABLED=true in the environment (the
 * repo's .env already sets this) — withMicLease delegates to claimMic(),
 * which is a granting no-op when the arbiter flag is off.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { micArbiter } from '../audioResourceArbiter';
import {
  withMicLease,
  isMicHeldByEvidenceLocker,
  claimMic,
} from '../../micArbiterGuard';

/** Each test may leave a stale claim on the shared singleton; clear it first. */
function resetArbiter() {
  const owner = micArbiter.currentOwner;
  if (owner) {
    const c = micArbiter.claim(owner); // re-claim to get a live MicClaim handle
    if (c.ok) micArbiter.release(c.claim);
  }
}

test('withMicLease: grants lease and runs fn when the mic is free', async () => {
  resetArbiter();
  let fnRan = false;
  const res = await withMicLease('chat_mic', undefined, async () => {
    fnRan = true;
    return 'done';
  });
  assert.equal(fnRan, true);
  assert.ok(res.ok);
  if (res.ok) {
    assert.equal(res.result, 'done');
    res.lease.release();
  }
});

test('withMicLease: fn never runs when the lease is denied (Evidence Locker holds it)', async () => {
  resetArbiter();
  const lockerClaim = micArbiter.claim('evidence_locker');
  assert.ok(lockerClaim.ok);

  let fnRan = false;
  const res = await withMicLease('chat_mic', undefined, async () => {
    fnRan = true; // this is the setAudioModeAsync call site in production code
  });

  // Core BATCH A1 regression: the global-audio-session work must never run
  // when another owner — especially the Evidence Locker — already holds the mic.
  assert.equal(fnRan, false);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.blockedByEvidenceLocker, true);

  if (lockerClaim.ok) micArbiter.release(lockerClaim.claim);
});

test('withMicLease: denied when another (non-Locker) owner holds the mic', async () => {
  resetArbiter();
  const other = micArbiter.claim('lookup_mic');
  assert.ok(other.ok);

  const res = await withMicLease('chat_mic', undefined, async () => {});
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.blockedByEvidenceLocker, false);
    assert.equal(res.heldBy, 'lookup_mic');
  }

  if (other.ok) micArbiter.release(other.claim);
});

test('withMicLease: releases the lease automatically if fn throws', async () => {
  resetArbiter();
  await assert.rejects(
    withMicLease('fir_draft_mic', undefined, async () => {
      throw new Error('prepareToRecordAsync failed');
    }),
    /prepareToRecordAsync failed/,
  );
  // The lease must have been released by the throw path, not left dangling —
  // otherwise every mic in the app would stay "busy" forever after one error.
  assert.equal(micArbiter.currentOwner, null);
});

test('withMicLease: onPreempt still fires if the Evidence Locker takes over mid-session', async () => {
  resetArbiter();
  let preempted = false;
  const res = await withMicLease('interpreter_mic', () => { preempted = true; }, async () => 'ok');
  assert.ok(res.ok);

  const lockerClaim = micArbiter.claim('evidence_locker');
  assert.ok(lockerClaim.ok);
  assert.equal(preempted, true);

  if (lockerClaim.ok) micArbiter.release(lockerClaim.claim);
});

test('isMicHeldByEvidenceLocker: true only while the Locker holds the mic', async () => {
  resetArbiter();
  assert.equal(isMicHeldByEvidenceLocker(), false);

  const lockerClaim = micArbiter.claim('evidence_locker');
  assert.ok(lockerClaim.ok);
  assert.equal(isMicHeldByEvidenceLocker(), true);

  if (lockerClaim.ok) micArbiter.release(lockerClaim.claim);
  assert.equal(isMicHeldByEvidenceLocker(), false);
});

test('isMicHeldByEvidenceLocker: false when any other owner (not the Locker) holds the mic', async () => {
  resetArbiter();
  const other = micArbiter.claim('chat_mic');
  assert.ok(other.ok);
  assert.equal(isMicHeldByEvidenceLocker(), false);
  if (other.ok) micArbiter.release(other.claim);
});

test('claimMic sanity: plain claim/release still works alongside withMicLease (web call sites use it directly)', () => {
  resetArbiter();
  const lease = claimMic('lookup_mic');
  assert.ok(lease.ok);
  lease.release();
  assert.equal(micArbiter.currentOwner, null);
});
