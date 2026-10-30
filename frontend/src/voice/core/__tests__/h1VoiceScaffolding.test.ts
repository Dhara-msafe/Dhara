/**
 * H1 — voice scaffolding hardening (TESTS ONLY, no behaviour change).
 *
 * Adds the gaps that voiceCore.test.ts / micArbiterGuard.test.ts do not cover:
 *   - state machine: SUSPENDED_BY_SAFETY entry/exit, DRAFT_SAVED reachability,
 *     "no state implies a completed action without a receipt";
 *   - arbiter: audio mode untouched on a rejected lease, release semantics,
 *     unknown ownership;
 *   - quiet / safe-to-speak gate: decline while the Locker holds the mic,
 *     decline under the privacy cover, exact approved decline wording;
 *   - flag contracts (missing / misspelt / "false" / "true");
 *   - ordering contracts in the chat send() path and import-time safety.
 *
 * Run with:  yarn test:voice
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  VoiceStateMachine, canTransition, VOICE_STATES, MIC_STATES, type VoiceState,
} from '../voiceStateMachine';
import { AudioResourceArbiter, micArbiter, type MicOwner } from '../audioResourceArbiter';
import { maySpeak } from '../voicePolicy';
import { maySpeakOn } from '../voicePlatform';
import {
  isMicHeldByEvidenceLocker, withMicLease, MIC_BUSY_MESSAGE,
  TTS_BLOCKED_BY_LOCKER_MESSAGE, MIC_ARBITER_ENABLED, MIC_LEASE_GUARD_ENABLED,
} from '../../micArbiterGuard';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../..');            // frontend/src
const APP = path.resolve(SRC, '../app');               // frontend/app
const read = (p: string) => readFileSync(p, 'utf8');

const ACTIVE_STATES: readonly VoiceState[] = VOICE_STATES.filter(
  (s) => !['IDLE', 'DRAFT_SAVED', 'SUSPENDED_BY_SAFETY', 'TIMED_OUT', 'ERROR'].includes(s),
);

/* ---------------- 2. voice state machine ---------------- */

test('H1/state: every declared state is reachable from IDLE through legal moves only', () => {
  const seen = new Set<VoiceState>(['IDLE']);
  const queue: VoiceState[] = ['IDLE'];
  while (queue.length) {
    const from = queue.shift()!;
    for (const to of VOICE_STATES) {
      if (canTransition(from, to) && !seen.has(to)) { seen.add(to); queue.push(to); }
    }
  }
  for (const s of VOICE_STATES) assert.ok(seen.has(s), `${s} is unreachable from IDLE`);
});

test('H1/state: SUSPENDED_BY_SAFETY can be entered from every active state', () => {
  for (const s of ACTIVE_STATES) {
    assert.ok(canTransition(s, 'SUSPENDED_BY_SAFETY'), `${s} -> SUSPENDED_BY_SAFETY`);
  }
});

test('H1/state: SUSPENDED_BY_SAFETY is never left except by an explicit resume to IDLE', () => {
  for (const s of VOICE_STATES) {
    assert.equal(canTransition('SUSPENDED_BY_SAFETY', s), s === 'IDLE', `SUSPENDED -> ${s}`);
  }
  const m = new VoiceStateMachine();
  m.to('LISTENING');
  m.to('SUSPENDED_BY_SAFETY');
  assert.equal(m.tryTo('LISTENING'), false);   // cannot resume listening directly
  assert.equal(m.tryTo('RESPONDING'), false);
  assert.equal(m.state, 'SUSPENDED_BY_SAFETY');
  assert.equal(m.mayHoldMic, false);           // suspended sessions hold no mic
  assert.ok(m.tryTo('IDLE'));                  // explicit resume lands on IDLE
  assert.equal(m.state, 'IDLE');
});

test('H1/state: every path from IDLE to DRAFT_SAVED passes CHECKING and ACTION_PREVIEW', () => {
  // Breadth-first over the real transition table: prove the engine check and
  // the explicit preview cannot be skipped on ANY route to a saved draft.
  const paths: VoiceState[][] = [['IDLE']];
  const found: VoiceState[][] = [];
  while (paths.length) {
    const p = paths.shift()!;
    const last = p[p.length - 1];
    if (last === 'DRAFT_SAVED') { found.push(p); continue; }
    if (p.length > 14) continue;
    for (const to of VOICE_STATES) {
      if (canTransition(last, to) && !p.includes(to)) paths.push([...p, to]);
    }
  }
  assert.ok(found.length > 0, 'DRAFT_SAVED must be reachable at all');
  for (const p of found) {
    assert.ok(p.includes('CHECKING'), `path skipped CHECKING: ${p.join('>')}`);
    assert.ok(p.includes('ACTION_PREVIEW'), `path skipped ACTION_PREVIEW: ${p.join('>')}`);
  }
});

test('H1/state: no state other than DRAFT_SAVED implies a completed action, and it is receipted', () => {
  const COMPLETION: readonly VoiceState[] = ['DRAFT_SAVED'];
  for (const s of VOICE_STATES) {
    if (COMPLETION.includes(s)) continue;
    assert.equal(canTransition(s, 'DRAFT_SAVED'), s === 'ACTION_PREVIEW', `${s} -> DRAFT_SAVED`);
  }
  // Receipt: the only completion state must emit a transition event a caller
  // can record. A machine with no listener still transitions, but the event
  // must be observable — otherwise "saved" could be claimed with no record.
  const receipts: string[] = [];
  const m = new VoiceStateMachine();
  m.onTransition((from, to) => receipts.push(`${from}>${to}`));
  for (const s of ['LISTENING', 'TRANSCRIBING', 'CONFIRMING', 'CHECKING', 'RESPONDING',
    'ACTION_PREVIEW', 'DRAFT_SAVED'] as const) m.to(s);
  assert.ok(receipts.includes('ACTION_PREVIEW>DRAFT_SAVED'));
  assert.equal(receipts.length, 7);
});

test('H1/state: only LISTENING is a mic-holding state', () => {
  assert.deepEqual([...MIC_STATES], ['LISTENING']);
  for (const s of VOICE_STATES) {
    const m = new VoiceStateMachine();
    if (s !== 'IDLE' && !canTransition('IDLE', s)) continue;
    if (s !== 'IDLE') m.to(s);
    assert.equal(m.mayHoldMic, s === 'LISTENING', `${s}.mayHoldMic`);
  }
});

/* ---------------- 3. audio arbiter ---------------- */

test('H1/arbiter: a rejected claim leaves the holder and the audio mode untouched', async () => {
  const a = new AudioResourceArbiter();
  const locker = a.claim('evidence_locker');
  assert.ok(locker.ok);
  const before = a.currentOwner;
  const denied = a.claim('chat_mic');
  assert.equal(denied.ok, false);
  assert.equal(a.currentOwner, before, 'denied claim must not change the owner');

  // And through the guard (which uses the shared singleton): the fn containing
  // setAudioModeAsync never runs while the Locker holds the real mic.
  const owner = micArbiter.currentOwner;
  if (owner) { const r = micArbiter.claim(owner); if (r.ok) micArbiter.release(r.claim); }
  const sharedLocker = micArbiter.claim('evidence_locker');
  assert.ok(sharedLocker.ok);
  let audioModeTouched = false;
  const res = await withMicLease('chat_mic', undefined, async () => { audioModeTouched = true; });
  assert.equal(res.ok, false);
  assert.equal(audioModeTouched, false);
  if (sharedLocker.ok) micArbiter.release(sharedLocker.claim);
});

test('H1/arbiter: release does NOT restore a previously preempted owner (documented behaviour)', () => {
  const a = new AudioResourceArbiter();
  const chat = a.claim('chat_mic');
  assert.ok(chat.ok);
  const locker = a.claim('evidence_locker');
  assert.ok(locker.ok);
  if (!locker.ok || !chat.ok) return;
  a.release(locker.claim);
  // DEFECT PIN (reported, not fixed): the arbiter has no owner stack, so the
  // mic becomes free rather than returning to chat_mic. Callers must re-claim.
  assert.equal(a.currentOwner, null);
  assert.equal(a.isActive(chat.claim), false, 'a preempted claim must never silently revive');
});

test('H1/arbiter: a preempted owner cannot keep recording and must re-claim', () => {
  const a = new AudioResourceArbiter();
  const v = a.claim('voice_session');
  assert.ok(v.ok);
  if (!v.ok) return;
  a.claim('evidence_locker');
  assert.equal(a.isActive(v.claim), false);
  a.release(v.claim);                               // stale release is harmless
  assert.equal(a.currentOwner, 'evidence_locker');  // and must not free the Locker
});

test('H1/arbiter: an unknown owner cannot displace the Evidence Locker (fails closed)', () => {
  const a = new AudioResourceArbiter();
  a.claim('evidence_locker');
  const rogue = a.claim('definitely_not_a_known_owner' as MicOwner);
  assert.equal(rogue.ok, false);
  if (!rogue.ok) assert.equal(rogue.reason, 'held_by_evidence_locker');
  assert.equal(a.currentOwner, 'evidence_locker');
});

test('H1/arbiter: isActive is false for a forged claim handle', () => {
  const a = new AudioResourceArbiter();
  const c = a.claim('lookup_mic');
  assert.ok(c.ok);
  assert.equal(a.isActive({ id: 9999, owner: 'lookup_mic', active: true }), false);
});

/* ---------------- 4. quiet / safe-to-speak gate ---------------- */

test('H1/speech: DHARA declines to speak while the Evidence Locker holds the mic', () => {
  const owner = micArbiter.currentOwner;
  if (owner) { const r = micArbiter.claim(owner); if (r.ok) micArbiter.release(r.claim); }
  assert.equal(isMicHeldByEvidenceLocker(), false);
  const locker = micArbiter.claim('evidence_locker');
  assert.ok(locker.ok);
  assert.equal(isMicHeldByEvidenceLocker(), true, 'TTS must see the Locker and skip audio-mode changes');
  if (locker.ok) micArbiter.release(locker.claim);
});


test('H2b/Fix2: isMicHeldByEvidenceLocker fails closed when guard is on but arbiter is off', () => {
  // Fix 2 reorders the guards so:
  //   guard disabled               → return false  (opt-out respected)
  //   guard on + arbiter off       → return true   (cannot verify = fail closed)
  //   guard on + arbiter on        → check owner   (normal live path)
  //
  // Env: EXPO_PUBLIC_AUDIO_ARBITER_ENABLED=true, so MIC_ARBITER_ENABLED=true here.
  // We cannot re-import with different env values under --experimental-strip-types,
  // so we verify the source logic as a predicate (matching H1 flag-contract style)
  // and exercise the live path (both flags on) functionally.
  const src = read(path.join(SRC, 'voice', 'micArbiterGuard.ts'));
  // Guard must be checked FIRST
  assert.match(src, /if \(!MIC_LEASE_GUARD_ENABLED\) return false/,
    'guard-disabled path must come before arbiter check');
  // Arbiter-off path must return true (fail closed), not false
  assert.match(src, /if \(!MIC_ARBITER_ENABLED\) return true/,
    'arbiter-off path must fail closed');
  // Live env: both flags on → functional detection still works
  assert.equal(MIC_ARBITER_ENABLED, true);
  assert.equal(MIC_LEASE_GUARD_ENABLED, true);
  // With no owner: false
  const prevOwner = micArbiter.currentOwner;
  if (prevOwner) {
    const tmp = micArbiter.claim(prevOwner);
    if (tmp.ok) micArbiter.release(tmp.claim);
  }
  assert.equal(isMicHeldByEvidenceLocker(), false,
    'no owner → not held by locker in live env');
  // With locker owner: true
  const lease = micArbiter.claim('evidence_locker');
  assert.ok(lease.ok);
  assert.equal(isMicHeldByEvidenceLocker(), true,
    'locker owner → held by locker in live env');
  if (lease.ok) micArbiter.release(lease.claim);
});


test('H1/speech: the decline wording is exactly the existing approved text', () => {
  assert.equal(
    TTS_BLOCKED_BY_LOCKER_MESSAGE,
    'Voice playback is paused while Evidence Locker is recording.',
  );
  assert.equal(
    MIC_BUSY_MESSAGE,
    'The microphone is being used by another part of DHARA right now. Please finish that first, then try again.',
  );
  for (const w of ['verified', 'certified', 'approved', 'court-ready', 'guaranteed', 'verdict',
    'help is on the way', 'FIR has been filed', 'complaint registered', 'police notified']) {
    for (const m of [MIC_BUSY_MESSAGE, TTS_BLOCKED_BY_LOCKER_MESSAGE]) {
      assert.ok(!m.toLowerCase().includes(w.toLowerCase()), `banned word ${w} in "${m}"`);
    }
  }
});

test('H1/speech: speech is declined under the privacy cover (Women\'s Shield forces Quiet)', () => {
  const base = { quiet: false, speakingPreferenceKnown: true, inWomensShield: false, interruptedNotResumed: false };
  const d = maySpeak({ ...base, inWomensShield: true });
  assert.equal(d.speak, false);
  if (!d.speak) assert.equal(d.reason, 'womens_shield');
  // and on every platform via the platform-aware gate
  for (const p of ['ios', 'android', 'web'] as const) {
    assert.equal(
      maySpeakOn(p, { ...base, inWomensShield: true, userGestureThisPageLoad: true }).speak,
      false,
      `${p}: must stay silent under the cover`,
    );
  }
});

/* ---------------- 6. ordering contracts ---------------- */

test('H1/order: SOS phrase check runs before the privacy cover in the chat send() path', () => {
  const src = read(path.join(APP, '(tabs)', 'index.tsx'));
  const sos = src.indexOf('triggerSafetySequence(');
  const cover = src.indexOf('activateCover(');
  assert.ok(sos > 0, 'send() must call triggerSafetySequence');
  assert.ok(cover > 0, 'send() must call activateCover');
  assert.ok(sos < cover, 'the SOS / danger check must precede the privacy cover');
});

test('H1/order: no voice module starts a recorder at import time', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) { if (e !== '__tests__') walk(p); }
      else if (/\.tsx?$/.test(p)) files.push(p);
    }
  };
  walk(path.join(SRC, 'voice'));
  assert.ok(files.length > 0);
  for (const f of files) {
    const lines = read(f).split('\n');
    lines.forEach((line, i) => {
      if (/^\s{0,2}(await\s+)?[\w.]*(prepareToRecordAsync|\.record\(\)|startRecording\(\))/.test(line)) {
        assert.fail(`${path.basename(f)}:${i + 1} starts a recorder at module scope: ${line.trim()}`);
      }
    });
  }
});

/* ---------------- 7. flag contracts ---------------- */

const readsTrueOnly = (v: string | undefined) => v === 'true';
const failsClosedUnlessFalse = (v: string | undefined) => v !== 'false';

test('H1/flags: voice companion + arbiter flags are OFF unless exactly "true"', () => {
  for (const v of [undefined, '', 'False', 'TRUE', 'yes', '1', 'false']) {
    assert.equal(readsTrueOnly(v as any), false, `value ${String(v)} must not enable the flag`);
  }
  assert.equal(readsTrueOnly('true'), true);
  // the shipped source must use that exact comparison
  assert.match(read(path.join(SRC, 'voice', 'speechGate.ts')),
    /EXPO_PUBLIC_VOICE_COMPANION_ENABLED === 'true'/);
  assert.match(read(path.join(SRC, 'voice', 'micArbiterGuard.ts')),
    /EXPO_PUBLIC_AUDIO_ARBITER_ENABLED === 'true'/);
});

test('H1/flags: the mic lease guard fails CLOSED — ON unless exactly "false"', () => {
  for (const v of [undefined, '', 'False', 'FALSE', 'no', 'true']) {
    assert.equal(failsClosedUnlessFalse(v as any), true, `value ${String(v)} must keep the guard ON`);
  }
  assert.equal(failsClosedUnlessFalse('false'), false);
  assert.match(read(path.join(SRC, 'voice', 'micArbiterGuard.ts')),
    /EXPO_PUBLIC_MIC_LEASE_GUARD_ENABLED !== 'false'/);
});

test('H1/flags: the repo environment under test has the voice companion OFF', () => {
  assert.notEqual(process.env.EXPO_PUBLIC_VOICE_COMPANION_ENABLED, 'true');
  assert.equal(MIC_ARBITER_ENABLED, true);      // .env: arbiter on
  assert.equal(MIC_LEASE_GUARD_ENABLED, true);  // .env: lease guard on
});

/* ---------------- 8. V1-B: AppState interruption → speech gate (unit) ------ */

// These tests verify the integration contract between the AppState 'change'
// event and the speechGateReducer (noteAudioInterruption → canSpeakNow=false).
// We test at the pure logic layer (reduceGate + maySpeakOn) because speechGate.ts
// imports react-native / AsyncStorage which cannot load in Node --test.
// The AppState listener wiring (index.tsx → noteAudioInterruption) is verified
// by source inspection below (no RN runtime required for that check).

import { reduceGate, INITIAL_GATE, type GateFlags } from '../speechGateReducer';

test('V1-B/gate: audio_interruption event sets interruptedNotResumed=true', () => {
  const after = reduceGate({ ...INITIAL_GATE }, { type: 'audio_interruption' });
  assert.equal(after.interruptedNotResumed, true,
    'audio_interruption must set interruptedNotResumed=true');
});

test('V1-B/gate: maySpeakOn blocks TTS when interruptedNotResumed=true', () => {
  const interruptedFlags = reduceGate({ ...INITIAL_GATE }, { type: 'audio_interruption' });
  const result = maySpeakOn('android', {
    quiet: false,
    speakingPreferenceKnown: true,
    inWomensShield: false,
    interruptedNotResumed: interruptedFlags.interruptedNotResumed,
    userGestureThisPageLoad: true,
  });
  assert.equal(result.speak, false,
    'maySpeakOn must return speak=false when interruption flag is set');
});

test('V1-B/gate: resume_requested clears the interrupted flag', () => {
  let flags: GateFlags = reduceGate({ ...INITIAL_GATE }, { type: 'audio_interruption' });
  assert.equal(flags.interruptedNotResumed, true);
  flags = reduceGate(flags, { type: 'resume_requested' });
  assert.equal(flags.interruptedNotResumed, false,
    'resume_requested must clear interruptedNotResumed');
});

test('V1-B/gate: multiple audio_interruption events do not toggle — stay blocked', () => {
  let flags: GateFlags = reduceGate({ ...INITIAL_GATE }, { type: 'audio_interruption' });
  flags = reduceGate(flags, { type: 'audio_interruption' });
  assert.equal(flags.interruptedNotResumed, true,
    'second interruption must not toggle back to false');
});

test('V1-B/source: index.tsx AppState listener calls noteAudioInterruption', () => {
  // Source-level contract check: the AppState handler that calls onLockedCancel
  // must also call noteAudioInterruption() so the speech gate records the event.
  const indexSrc = read(path.join(APP, '(tabs)', 'index.tsx'));
  // The call must be inside the AppState listener, near stopCloudTTS/stopNativeTTS.
  assert.match(indexSrc, /noteAudioInterruption\(\)/,
    'index.tsx must call noteAudioInterruption() — V1-B wiring check');
  // Also assert the import is present.
  assert.match(indexSrc, /noteAudioInterruption.*from.*speechGate/,
    'noteAudioInterruption must be imported from speechGate in index.tsx');
});

// NOT RUN — requires physical Android + iOS device build:
// AT40: headphone disconnect (ACTION_AUDIO_BECOMING_NOISY / AVAudioSession route change)
//   → not surfaced by current Expo audio JS layer; needs a dedicated RN module.
// AT45: incoming phone call on-device — AppState listener fires in a real build;
//   unit test above verifies the gate contract; end-to-end device test still open.
