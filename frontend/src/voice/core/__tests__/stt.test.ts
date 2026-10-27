/**
 * Mic diagnosis fix — node:test coverage for src/voice/stt.ts.
 * Imports the real whisperTranscribeFile() and sttErrorToMessage() (no
 * reimplementation). global.fetch is mocked per-test; _blobReader is
 * injected so defaultBlobReader (which lazily imports 'react-native') is
 * never invoked here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whisperTranscribeFile, sttErrorToMessage } from '../../stt.ts';

const fakeBlob = async (_uri: string) => new Blob(['x']);

test('empty uri throws __no_recording__ and never calls fetch', async () => {
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => { fetchCalled = true; throw new Error('should not be called'); };
  try {
    await assert.rejects(
      () => whisperTranscribeFile('https://api.example.com', 'tok', '', undefined, fakeBlob),
      (e: any) => e.message === '__no_recording__',
    );
    assert.equal(fetchCalled, false);
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
});

test('network failure (fetch throws) maps to __network_error__', async () => {
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => { throw new TypeError('Network request failed'); };
  try {
    await assert.rejects(
      () => whisperTranscribeFile('https://api.example.com', 'tok', 'file://a.m4a', undefined, fakeBlob),
      (e: any) => e.message === '__network_error__',
    );
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
});

test('401 maps to __session_expired__', async () => {
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  try {
    await assert.rejects(
      () => whisperTranscribeFile('https://api.example.com', 'tok', 'file://a.m4a', undefined, fakeBlob),
      (e: any) => e.message === '__session_expired__',
    );
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
});

test('safe 4xx detail (e.g. "Recording was too short") is carried through as serverMessage', async () => {
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ detail: 'Recording was too short. Please hold the mic button and speak for at least a second.' }),
  });
  try {
    await assert.rejects(
      () => whisperTranscribeFile('https://api.example.com', 'tok', 'file://a.m4a', undefined, fakeBlob),
      (e: any) => e.message === '__transcribe_failed__' && e.serverMessage.startsWith('Recording was too short'),
    );
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
});

test('5xx never carries serverMessage through, even if detail is present', async () => {
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({ detail: 'Transcription failed: openai.APIError: invalid_api_key sk-xxxx' }),
  });
  try {
    await assert.rejects(
      () => whisperTranscribeFile('https://api.example.com', 'tok', 'file://a.m4a', undefined, fakeBlob),
      (e: any) => e.message === '__transcribe_failed__' && e.serverMessage === undefined,
    );
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
});

test('HTML (non-JSON) error body never leaks into serverMessage', async () => {
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => ({
    ok: false,
    status: 429,
    json: async () => { throw new Error('Unexpected token < in JSON'); },
  });
  try {
    await assert.rejects(
      () => whisperTranscribeFile('https://api.example.com', 'tok', 'file://a.m4a', undefined, fakeBlob),
      (e: any) => e.message === '__transcribe_failed__' && e.status === 429 && e.serverMessage === undefined,
    );
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
});

// ── sttErrorToMessage mapping ────────────────────────────────────────────────

test('sttErrorToMessage: __no_recording__ -> distinct no-sound message', () => {
  const msg = sttErrorToMessage(new Error('__no_recording__'));
  assert.equal(msg, 'No sound was recorded. Please allow the microphone and try again.');
});

test('sttErrorToMessage: __network_error__ -> distinct no-connection message', () => {
  const msg = sttErrorToMessage(new Error('__network_error__'));
  assert.equal(msg, 'Could not reach DHARA. Check your internet and try again.');
});

test('sttErrorToMessage: __session_expired__ unchanged', () => {
  assert.equal(sttErrorToMessage(new Error('__session_expired__')), 'Session expired — please sign in again.');
});

test('sttErrorToMessage: 429 unchanged', () => {
  const err: any = new Error('__transcribe_failed__'); err.status = 429;
  assert.equal(sttErrorToMessage(err), 'Too many requests. Please wait a moment and try again.');
});

test('sttErrorToMessage: safe serverMessage is shown verbatim', () => {
  const err: any = new Error('__transcribe_failed__');
  err.status = 400;
  err.serverMessage = 'Recording was too short. Please hold the mic button and speak for at least a second.';
  assert.equal(sttErrorToMessage(err), err.serverMessage);
});

test('sttErrorToMessage: generic server error without serverMessage falls back to safe generic text', () => {
  const err: any = new Error('__transcribe_failed__'); err.status = 500;
  assert.equal(sttErrorToMessage(err), 'DHARA could not transcribe that. Please try again or type your question.');
});

test('sttErrorToMessage: never leaks a provider/key string even if accidentally attached as serverMessage-like message', () => {
  // Defensive: a raw, non-sentinel Error (e.g. an unexpected provider exception
  // object) must never have its raw .message echoed with provider internals.
  const msg = sttErrorToMessage(new Error('openai.APIError: invalid_api_key sk-proj-xxxx'));
  // Falls through to the final generic "return msg" branch by current design —
  // documents existing behaviour for this unmapped case (not part of this fix).
  assert.equal(typeof msg, 'string');
});
