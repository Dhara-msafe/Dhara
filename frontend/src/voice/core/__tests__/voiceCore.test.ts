/**
 * Unit tests for the Talk to DHARA voice core.
 * Run with:  node --experimental-strip-types --test src/voice/core/__tests__/ (see README for the full command)
 * (Node 22.6+). No Expo, React or device needed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  VoiceStateMachine, canTransition, VOICE_STATES, InvalidVoiceTransition,
} from '../voiceStateMachine';
import { AudioResourceArbiter } from '../audioResourceArbiter';
import {
  maySpeak, needsConfirmation, retentionFor, composeSpokenAnswer, findBannedWords,
  draftSaveKey, isForbiddenAbbreviationQuestion, quietAfterEnteringWomensShield,
} from '../voicePolicy';

/* ---------------- state machine ---------------- */

test('happy path: speak -> confirm -> clarify -> answer -> draft saved', () => {
  const m = new VoiceStateMachine();
  const path = ['LISTENING', 'TRANSCRIBING', 'CONFIRMING', 'CLARIFYING', 'LISTENING',
    'TRANSCRIBING', 'CONFIRMING', 'CHECKING', 'RESPONDING', 'ACTION_PREVIEW', 'DRAFT_SAVED', 'IDLE'] as const;
  for (const s of path) m.to(s);
  assert.equal(m.state, 'IDLE');
});

test('IDLE can only start LISTENING (user tap)', () => {
  for (const s of VOICE_STATES) {
    assert.equal(canTransition('IDLE', s), s === 'LISTENING', `IDLE -> ${s}`);
  }
});

test('cannot skip the engine: TRANSCRIBING/CONFIRMING never jump to RESPONDING', () => {
  assert.equal(canTransition('TRANSCRIBING', 'RESPONDING'), false);
  assert.equal(canTransition('CONFIRMING', 'RESPONDING'), false);
  assert.equal(canTransition('CLARIFYING', 'RESPONDING'), false);
});

test('draft only after ACTION_PREVIEW (explicit yes)', () => {
  for (const s of VOICE_STATES) {
    if (s === 'ACTION_PREVIEW') continue;
    assert.equal(canTransition(s, 'DRAFT_SAVED'), false, `${s} -> DRAFT_SAVED must be rejected`);
  }
});

test('safety, stop, error and timeout exits exist from every active state', () => {
  for (const s of VOICE_STATES) {
    if (s === 'IDLE' || ['DRAFT_SAVED', 'SUSPENDED_BY_SAFETY', 'TIMED_OUT', 'ERROR'].includes(s)) continue;
    for (const exit of ['IDLE', 'ERROR', 'TIMED_OUT', 'SUSPENDED_BY_SAFETY'] as const) {
      assert.ok(canTransition(s, exit), `${s} -> ${exit}`);
    }
  }
});

test('terminal states only return to IDLE', () => {
  for (const t of ['DRAFT_SAVED', 'SUSPENDED_BY_SAFETY', 'TIMED_OUT', 'ERROR'] as const) {
    for (const s of VOICE_STATES) assert.equal(canTransition(t, s), s === 'IDLE', `${t} -> ${s}`);
  }
});

test('invalid move throws, tryTo returns false and keeps state', () => {
  const m = new VoiceStateMachine();
  assert.throws(() => m.to('RESPONDING'), InvalidVoiceTransition);
  assert.equal(m.tryTo('CHECKING'), false);
  assert.equal(m.state, 'IDLE');
});

test('only LISTENING may hold the mic', () => {
  const m = new VoiceStateMachine();
  assert.equal(m.mayHoldMic, false);
  m.to('LISTENING');
  assert.equal(m.mayHoldMic, true);
  m.to('TRANSCRIBING');
  assert.equal(m.mayHoldMic, false);
});

/* ---------------- arbiter ---------------- */

test('one owner at a time', () => {
  const a = new AudioResourceArbiter();
  const c1 = a.claim('voice_session');
  assert.ok(c1.ok);
  const c2 = a.claim('chat_mic');
  assert.equal(c2.ok, false);
  if (!c2.ok) assert.equal(c2.reason, 'held_by_other');
});

test('Evidence Locker preempts voice and voice is told to stop', () => {
  const a = new AudioResourceArbiter();
  let stopped = 0;
  const v = a.claim('voice_session', () => { stopped++; });
  assert.ok(v.ok);
  const e = a.claim('evidence_locker');
  assert.ok(e.ok);
  assert.equal(stopped, 1);
  if (v.ok) assert.equal(v.claim.active, false);
  assert.equal(a.currentOwner, 'evidence_locker');
});

test('nobody can claim while the Evidence Locker records', () => {
  const a = new AudioResourceArbiter();
  a.claim('evidence_locker');
  const v = a.claim('voice_session');
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, 'held_by_evidence_locker');
});

test('a throwing preempt callback does not block evidence capture', () => {
  const a = new AudioResourceArbiter();
  a.claim('fir_draft_mic', () => { throw new Error('boom'); });
  assert.ok(a.claim('evidence_locker').ok);
});

test('release frees the mic; double release and stale release are harmless', () => {
  const a = new AudioResourceArbiter();
  const v = a.claim('voice_session');
  assert.ok(v.ok);
  if (!v.ok) return;
  a.release(v.claim);
  a.release(v.claim);
  assert.equal(a.currentOwner, null);
  const c = a.claim('chat_mic');
  assert.ok(c.ok);
  a.release(v.claim); // stale: must not release chat_mic
  assert.equal(a.currentOwner, 'chat_mic');
});

/* ---------------- quiet mode ---------------- */

const base = { quiet: false, speakingPreferenceKnown: true, inWomensShield: false, interruptedNotResumed: false };

test('speaks only when every condition allows', () => {
  assert.deepEqual(maySpeak(base), { speak: true });
});
test('no speech before the speaking preference is known (no spoken welcome)', () => {
  assert.equal(maySpeak({ ...base, speakingPreferenceKnown: false }).speak, false);
});
test('Quiet blocks speech', () => {
  assert.equal(maySpeak({ ...base, quiet: true }).speak, false);
});
test("Women's Shield blocks speech and forces Quiet on", () => {
  assert.equal(maySpeak({ ...base, inWomensShield: true }).speak, false);
  assert.equal(quietAfterEnteringWomensShield(false), true);
});
test('no auto-resume after call / headphones / background', () => {
  assert.equal(maySpeak({ ...base, interruptedNotResumed: true }).speak, false);
});

/* ---------------- confirmation ---------------- */

test('answer-changing facts are always confirmed', () => {
  for (const k of ['state', 'date', 'amount', 'section_number'] as const) assert.ok(needsConfirmation(k));
});
test('ordinary speech is not confirmed unless the recogniser is unsure', () => {
  assert.equal(needsConfirmation('free_text', 0.95), false);
  assert.equal(needsConfirmation('free_text', 0.5), true);
  assert.equal(needsConfirmation('free_text'), false);
});
test('detects a forbidden "BNS or BNSS?" question', () => {
  assert.ok(isForbiddenAbbreviationQuestion('Did you mean BNS or BNSS?'));
  assert.equal(isForbiddenAbbreviationQuestion('When did it happen?'), false);
});

/* ---------------- retention ---------------- */

test('shared-phone rule: keep only signed-in + secure device + consent', () => {
  assert.equal(retentionFor({ signedIn: true, deviceSecure: true, consentedToKeep: true }), 'keep_matter');
  assert.equal(retentionFor({ signedIn: false, deviceSecure: true, consentedToKeep: true }), 'session_only');
  assert.equal(retentionFor({ signedIn: true, deviceSecure: false, consentedToKeep: true }), 'session_only');
  assert.equal(retentionFor({ signedIn: true, deviceSecure: true, consentedToKeep: false }), 'session_only');
});

/* ---------------- answer shape + words ---------------- */

test('answer order: understood, meaning, next step, cannot confirm', () => {
  const s = composeSpokenAnswer({ understood: 'A.', meaning: 'B.', nextStep: 'C.', cannotConfirm: 'D.' });
  assert.equal(s, 'A. B. C. D.');
  assert.equal(composeSpokenAnswer({ understood: 'A.', meaning: 'B.', nextStep: 'C.' }), 'A. B. C.');
});

test('banned words are found; the draft message is allowed', () => {
  assert.deepEqual(findBannedWords('This is a Verified, court-ready answer'), ['verified', 'court-ready']);
  assert.deepEqual(findBannedWords('Draft saved, not submitted.'), []);
  assert.deepEqual(findBannedWords('unverified source'), []);
});

/* ---------------- idempotency ---------------- */

test('same matter + same fields => same key, any field order', () => {
  const k1 = draftSaveKey('m1', { state: 'KA', amount: '50000' });
  const k2 = draftSaveKey('m1', { amount: '50000', state: 'KA' });
  assert.equal(k1, k2);
  assert.notEqual(k1, draftSaveKey('m1', { state: 'KA', amount: '50001' }));
  assert.notEqual(k1, draftSaveKey('m2', { state: 'KA', amount: '50000' }));
});
