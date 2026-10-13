/**
 * Platform rules for Android, iPhone and web.
 * Run: see README (needs --import ./src/voice/core/__tests__/ts-resolve.mjs)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  capabilitiesFor, toVoicePlatform, maySpeakOn, retentionOn, mustReleaseMic, type VoicePlatform,
} from '../voicePlatform';

const ALL: VoicePlatform[] = ['android', 'ios', 'web'];
const speakOk = { quiet: false, speakingPreferenceKnown: true, inWomensShield: false, interruptedNotResumed: false };
const keepAll = { signedIn: true, deviceSecure: true, consentedToKeep: true };

test('Platform.OS maps to the three voice platforms', () => {
  assert.equal(toVoicePlatform('android'), 'android');
  assert.equal(toVoicePlatform('ios'), 'ios');
  assert.equal(toVoicePlatform('web'), 'web');
  assert.equal(toVoicePlatform('windows'), 'android'); // unknown -> strictest native rules
});

test('tap-to-talk on all three; wake word and background listening on none', () => {
  for (const p of ALL) {
    const c = capabilitiesFor(p);
    assert.equal(c.tapToTalk, true, p);
    assert.equal(c.wakeWord, false, p);
    assert.equal(c.backgroundListening, false, p);
    assert.equal(c.releaseMicInBackground, true, p);
  }
});

test('web: no speech until the user taps on this page load', () => {
  assert.equal(maySpeakOn('web', { ...speakOk, userGestureThisPageLoad: false }).speak, false);
  assert.equal(maySpeakOn('web', { ...speakOk, userGestureThisPageLoad: true }).speak, true);
});

test('native apps do not need the web gesture rule, but keep every other rule', () => {
  for (const p of ['android', 'ios'] as const) {
    assert.equal(maySpeakOn(p, { ...speakOk, userGestureThisPageLoad: false }).speak, true);
    assert.equal(maySpeakOn(p, { ...speakOk, quiet: true, userGestureThisPageLoad: true }).speak, false);
    assert.equal(maySpeakOn(p, { ...speakOk, inWomensShield: true, userGestureThisPageLoad: true }).speak, false);
  }
});

test('web never keeps a matter between sessions', () => {
  assert.equal(retentionOn('web', keepAll), 'session_only');
});

test('Android and iPhone keep a matter only when signed in, locked and consented', () => {
  for (const p of ['android', 'ios'] as const) {
    assert.equal(retentionOn(p, keepAll), 'keep_matter');
    assert.equal(retentionOn(p, { ...keepAll, deviceSecure: false }), 'session_only');
  }
});

test('web Evidence Locker is never presented as native capture', () => {
  assert.equal(capabilitiesFor('web').evidenceLocker, 'limited_web');
  assert.equal(capabilitiesFor('android').evidenceLocker, 'native');
  assert.equal(capabilitiesFor('ios').evidenceLocker, 'native');
});

test('mic is released whenever the app or tab is not active', () => {
  assert.equal(mustReleaseMic('active'), false);
  for (const s of ['background', 'inactive', 'hidden'] as const) assert.equal(mustReleaseMic(s), true);
});
