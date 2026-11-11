/**
 * Mic diagnosis fix — node:test coverage for src/voice/stt.ts.
 * Imports the real whisperTranscribeFile() and sttErrorToMessage() (no
 * reimplementation). global.fetch is mocked per-test; _blobReader is
 * injected so defaultBlobReader (which lazily imports 'react-native') is
 * never invoked here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whisperTranscribeFile, sttErrorToMessage, audioFileDescriptorFromUri } from '../../stt.ts';

const fakeBlob = async (_uri: string) => new Blob(['x']);

/** Minimal FormData mock so tests can inspect exactly what whisperTranscribeFile()
 * appended, without depending on Node's real FormData's stringification of
 * non-Blob/non-string values. Swapped onto globalThis for the duration of a
 * test only, then restored — the real function under test is unmodified. */
class _MockFormData {
  appended: Array<[string, any, any?]> = [];
  append(...args: any[]) { this.appended.push(args as any); }
}

function withMockFormDataAndFetch<T>(fetchImpl: (...a: any[]) => Promise<any>, fn: (mock: _MockFormData) => Promise<T>): Promise<T> {
  const mock = new _MockFormData();
  const originalFormData = (globalThis as any).FormData;
  const originalFetch = globalThis.fetch;
  (globalThis as any).FormData = function () { return mock; } as any;
  (globalThis as any).fetch = fetchImpl as any;
  return fn(mock).finally(() => {
    (globalThis as any).FormData = originalFormData;
    (globalThis as any).fetch = originalFetch;
  });
}

// ── Native audio upload fix: native path never constructs a Blob ───────────

test('native path appends a {uri,name,type} descriptor, never constructs a Blob', async () => {
  let blobReaderCalled = false;
  await withMockFormDataAndFetch(
    async () => ({ ok: true, status: 200, json: async () => ({ text: 'hello' }) }),
    async (mock) => {
      const result = await whisperTranscribeFile(
        'https://api.example.com', 'tok', 'file:///data/recording-123.m4a', undefined,
        async () => { blobReaderCalled = true; return new Blob(['x']); },
        'android',
      );
      assert.equal(blobReaderCalled, false, '_blobReader must never be called on native');
      const audioAppend = mock.appended.find(a => a[0] === 'audio');
      assert.ok(audioAppend, 'audio field was appended');
      const value = audioAppend![1];
      assert.equal(value instanceof Blob, false, 'native must not append a Blob instance');
      assert.equal(value.uri, 'file:///data/recording-123.m4a');
      assert.equal(value.name, 'recording-123.m4a');
      assert.equal(value.type, 'audio/m4a');
      assert.equal(result.text, 'hello');
    },
  );
});

test('native path works on ios too (platform-agnostic, not android-specific)', async () => {
  await withMockFormDataAndFetch(
    async () => ({ ok: true, status: 200, json: async () => ({ text: 'ok' }) }),
    async (mock) => {
      await whisperTranscribeFile('https://api.example.com', 'tok', 'file:///var/rec.m4a', undefined, fakeBlob, 'ios');
      const audioAppend = mock.appended.find(a => a[0] === 'audio');
      assert.equal(audioAppend![1].uri, 'file:///var/rec.m4a');
    },
  );
});

// ── Web path — existing Blob behaviour unchanged ────────────────────────────

test('web path still builds a real Blob via _blobReader (unchanged)', async () => {
  const fakeBlobInstance = new Blob(['y']);
  await withMockFormDataAndFetch(
    async () => ({ ok: true, status: 200, json: async () => ({ text: 'hi' }) }),
    async (mock) => {
      const result = await whisperTranscribeFile(
        'https://api.example.com', 'tok', 'blob:abc', undefined,
        async () => fakeBlobInstance,
        'web',
      );
      const audioAppend = mock.appended.find(a => a[0] === 'audio');
      assert.ok(audioAppend);
      assert.equal(audioAppend![1], fakeBlobInstance);
      assert.equal(audioAppend![2], 'audio.m4a');
      assert.equal(result.text, 'hi');
    },
  );
});

// ── audioFileDescriptorFromUri — real-extension derivation ──────────────────

test('audioFileDescriptorFromUri derives name/type from the real extension', () => {
  assert.deepEqual(audioFileDescriptorFromUri('file:///data/rec.m4a'), { name: 'rec.m4a', type: 'audio/m4a' });
  assert.deepEqual(audioFileDescriptorFromUri('file:///data/rec.3gp'), { name: 'rec.3gp', type: 'audio/3gpp' });
  assert.deepEqual(audioFileDescriptorFromUri('file:///data/rec.caf'), { name: 'rec.caf', type: 'audio/x-caf' });
  assert.deepEqual(audioFileDescriptorFromUri('file:///data/rec.wav'), { name: 'rec.wav', type: 'audio/wav' });
});

test('audioFileDescriptorFromUri falls back to m4a for a missing or unknown extension', () => {
  assert.deepEqual(audioFileDescriptorFromUri('file:///data/rec'), { name: 'rec.m4a', type: 'audio/m4a' });
  assert.deepEqual(audioFileDescriptorFromUri('file:///data/rec.xyz'), { name: 'rec.xyz', type: 'audio/m4a' });
});

test('empty uri throws __no_recording__ and never calls fetch', async () => {
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => { fetchCalled = true; throw new Error('should not be called'); };
  try {
    await assert.rejects(
      () => whisperTranscribeFile('https://api.example.com', 'tok', '', undefined, fakeBlob, 'web'),
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
      () => whisperTranscribeFile('https://api.example.com', 'tok', 'file://a.m4a', undefined, fakeBlob, 'web'),
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
      () => whisperTranscribeFile('https://api.example.com', 'tok', 'file://a.m4a', undefined, fakeBlob, 'web'),
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
      () => whisperTranscribeFile('https://api.example.com', 'tok', 'file://a.m4a', undefined, fakeBlob, 'web'),
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
      () => whisperTranscribeFile('https://api.example.com', 'tok', 'file://a.m4a', undefined, fakeBlob, 'web'),
      (e: any) => e.message === '__transcribe_failed__' && e.serverMessage === undefined,
    );
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
});

test('B-38: daily-cap 429 (object detail with limit:true) is carried through as serverMessage', async () => {
  const originalFetch = globalThis.fetch;
  const dailyCapMessage = "You've used all 30 free questions for today. Upgrade to Pro for unlimited access, or come back tomorrow.\n\nIn an emergency, free help is available:\n• NALSA Legal Aid: 15100 (free)\n• Consumer Helpline: 1800-11-4000 (toll-free)";
  (globalThis as any).fetch = async () => ({
    ok: false,
    status: 429,
    json: async () => ({
      detail: {
        limit: true, scope: 'user', kind: 'query', used: 30, cap: 30, is_pro: false,
        message: dailyCapMessage,
        helplines: [{ name: 'NALSA Legal Aid', number: '15100' }],
      },
    }),
  });
  try {
    await assert.rejects(
      () => whisperTranscribeFile('https://api.example.com', 'tok', 'file://a.m4a', undefined, fakeBlob, 'web'),
      (e: any) => e.message === '__transcribe_failed__' && e.status === 429 && e.serverMessage === dailyCapMessage,
    );
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
});

test('429 with an object detail that is NOT our own daily-cap shape never leaks', async () => {
  // Guards the limit:true check itself: an upstream provider's own 429 body
  // could be any arbitrary JSON object. Without the explicit shape check,
  // such a body would wrongly be trusted as if it were our vetted message.
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => ({
    ok: false,
    status: 429,
    json: async () => ({ detail: { error: 'rate_limit_exceeded', provider: 'openai', retry_after: 2 } }),
  });
  try {
    await assert.rejects(
      () => whisperTranscribeFile('https://api.example.com', 'tok', 'file://a.m4a', undefined, fakeBlob, 'web'),
      (e: any) => e.message === '__transcribe_failed__' && e.status === 429 && e.serverMessage === undefined,
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
      () => whisperTranscribeFile('https://api.example.com', 'tok', 'file://a.m4a', undefined, fakeBlob, 'web'),
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

test('sttErrorToMessage: 429 with no vetted serverMessage falls back to the generic text', () => {
  const err: any = new Error('__transcribe_failed__'); err.status = 429;
  assert.equal(sttErrorToMessage(err), 'Too many requests. Please wait a moment and try again.');
});

test('B-38: sttErrorToMessage: 429 WITH a vetted daily-cap serverMessage shows it, not the generic text', () => {
  const err: any = new Error('__transcribe_failed__');
  err.status = 429;
  err.serverMessage = "You've used all 30 free questions for today. Upgrade to Pro for unlimited access, or come back tomorrow.";
  assert.equal(sttErrorToMessage(err), err.serverMessage);
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

test('sttErrorToMessage: never leaks a provider/key string or any other raw native exception text', () => {
  // Native audio upload fix regression guard: this is the exact bug — the
  // "Transcription failed" dialog was showing
  // "Creating blobs from 'ArrayBuffer' and 'ArrayBufferView' are not
  // supported" verbatim. Any unrecognised error must now always map to the
  // one safe generic string, never its own .message.
  const safe = 'Voice recognition failed. Please try again.';
  assert.equal(
    sttErrorToMessage(new Error("Creating blobs from 'ArrayBuffer' and 'ArrayBufferView' are not supported")),
    safe,
  );
  assert.equal(sttErrorToMessage(new Error('openai.APIError: invalid_api_key sk-proj-xxxx')), safe);
  assert.equal(sttErrorToMessage(new TypeError('undefined is not a function')), safe);
});
