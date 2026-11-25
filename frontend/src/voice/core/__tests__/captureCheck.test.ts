/**
 * Silent-capture guard — node:test coverage for src/voice/core/captureCheck.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCapture, createPeakTracker, SILENCE_FLOOR_DB } from '../captureCheck.ts';

test('dead microphone (every sample at the -160 dB floor) is silent', () => {
  assert.equal(classifyCapture({ elapsedMs: 5000, peakDb: SILENCE_FLOOR_DB, samples: 25 }), 'silent');
});

test('normal speech is ok', () => {
  assert.equal(classifyCapture({ elapsedMs: 5000, peakDb: -12, samples: 25 }), 'ok');
});

test('quiet speech / room noise is never blocked', () => {
  assert.equal(classifyCapture({ elapsedMs: 3000, peakDb: -48, samples: 15 }), 'ok');
});

test('instant tap-and-release is too short, whatever the level', () => {
  assert.equal(classifyCapture({ elapsedMs: 200, peakDb: -10, samples: 1 }), 'too_short');
});

test('no metering data never blocks the upload', () => {
  assert.equal(classifyCapture({ elapsedMs: 4000, peakDb: null, samples: 0 }), 'ok');
});

test('too few samples to judge silence does not block', () => {
  assert.equal(classifyCapture({ elapsedMs: 900, peakDb: SILENCE_FLOOR_DB, samples: 2 }), 'ok');
});

test('non-finite elapsed time is treated as too short', () => {
  assert.equal(classifyCapture({ elapsedMs: NaN, peakDb: -10, samples: 9 }), 'too_short');
});

test('peak tracker keeps the loudest finite reading and ignores junk', () => {
  const t = createPeakTracker();
  t.add(-160); t.add(undefined); t.add(-30); t.add(NaN); t.add(-45);
  assert.deepEqual(t.read(), { peakDb: -30, samples: 3 });
});

test('peak tracker with no readings reports null', () => {
  assert.deepEqual(createPeakTracker().read(), { peakDb: null, samples: 0 });
});
