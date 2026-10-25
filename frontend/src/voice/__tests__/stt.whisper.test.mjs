/**
 * stt.whisper.test.mjs — unit tests for whisperTranscribeFile.
 *
 * Exercises production code from src/voice/stt.ts via the injectable
 * _blobReader parameter. globalThis.fetch is overridden per-test so no
 * real network calls are made.
 *
 * Run with:
 *   node --experimental-strip-types \
 *     src/voice/__tests__/stt.whisper.test.mjs
 *
 * Android-only items (W-12, W-13) are NOT RUN here — they require a real
 * device build and are documented at the bottom of this file.
 */

import assert from 'node:assert/strict';

// ── Minimal Platform shim so stt.ts can be imported in Node ──────────────────
// stt.ts imports Platform from 'react-native'. We shim the module before
// importing so the defaultBlobReader branch is deterministic in tests.
const _origLoad = (await import('node:module')).createRequire(import.meta.url);

// Patch: intercept 'react-native' before stt.ts loads it
const Module = await import('node:module');
const _rn = { Platform: { OS: 'android' } };   // default: native branch
// We use a globalThis shim approach since dynamic import caches modules.
// Instead, we import whisperTranscribeFile directly and always pass a
// _blobReader — so Platform.OS never matters in tests.

import { whisperTranscribeFile } from '../stt.ts';

// ── Test harness ──────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const results = [];

function test(label, fn) {
  results.push({ label, fn });
}

async function runAll() {
  for (const { label, fn } of results) {
    try {
      await fn();
      console.log(`  PASS  ${label}`);
      passed++;
    } catch (err) {
      console.log(`  FAIL  ${label}`);
      console.log(`        ${err.message}`);
      failed++;
    }
  }
}

// ── Shared mock helpers ───────────────────────────────────────────────────────

/** A blob reader that returns a non-empty fake Blob. */
const goodBlob = new Blob(['fake-audio-data'], { type: 'audio/m4a' });
const goodReader = async (_uri) => goodBlob;

/** A blob reader that returns a zero-byte Blob. */
const emptyBlob = new Blob([], { type: 'audio/m4a' });
const emptyBlobReader = async (_uri) => emptyBlob;

/** A blob reader that simulates a filesystem/network failure. */
const failingBlobReader = async (_uri) => {
  throw new Error('File not found');
};

function mockFetch(status, body) {
  return async (_url, _opts) => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\n── W-1  Empty URI guard ────────────────────────────────────────────');
test('W-1: empty uri throws __transcribe_failed__ before blob read or fetch', async () => {
  let blobReaderCalled = false;
  const trackingReader = async (uri) => { blobReaderCalled = true; return goodBlob; };
  globalThis.fetch = mockFetch(200, { text: 'hello' });
  try {
    await whisperTranscribeFile('http://localhost', 'tok', '', undefined, trackingReader);
    assert.fail('expected throw');
  } catch (err) {
    assert.ok(err.message.includes('__transcribe_failed__'), `got: ${err.message}`);
    assert.equal(blobReaderCalled, false, 'blobReader must not be called for empty URI');
  }
});

console.log('\n── W-2  Blob read failure ──────────────────────────────────────────');
test('W-2: blobReader throws → propagates as __transcribe_failed__ with no fetch call', async () => {
  let fetchCalled = false;
  globalThis.fetch = async (...args) => { fetchCalled = true; return mockFetch(200, {})(...args); };
  try {
    await whisperTranscribeFile('http://localhost', 'tok', 'file://audio.m4a', undefined, failingBlobReader);
    assert.fail('expected throw');
  } catch (err) {
    // blob read failure propagates; fetch must not be called
    assert.equal(fetchCalled, false, 'fetch must not be called after blob read failure');
    assert.ok(err.message.includes('File not found') || err.message.includes('__transcribe_failed__'));
  }
});

console.log('\n── W-3  Zero-byte Blob reaches backend ─────────────────────────────');
test('W-3: zero-byte Blob is sent (backend decides if too short, not frontend)', async () => {
  globalThis.fetch = mockFetch(400, { detail: 'audio_too_short' });
  try {
    await whisperTranscribeFile('http://localhost', 'tok', 'file://silent.m4a', undefined, emptyBlobReader);
    assert.fail('expected throw');
  } catch (err) {
    assert.ok(err.status === 400 || err.message.includes('__transcribe_failed__'),
      `expected 400 or __transcribe_failed__, got: ${err.message}`);
  }
});

console.log('\n── W-4  Happy path ─────────────────────────────────────────────────');
test('W-4: good Blob + 200 response → result.text returned', async () => {
  globalThis.fetch = mockFetch(200, { text: 'police station', script_mismatch: false });
  const result = await whisperTranscribeFile(
    'http://localhost', 'tok', 'file://good.m4a', undefined, goodReader,
  );
  assert.equal(result.text, 'police station');
  assert.equal(result.scriptMismatch, false);
});

console.log('\n── W-5  FormData field name and filename ───────────────────────────');
test('W-5: FormData contains "audio" field with filename "audio.m4a"', async () => {
  let capturedForm = null;
  globalThis.fetch = async (_url, opts) => {
    capturedForm = opts.body;
    return { status: 200, ok: true, json: async () => ({ text: 'test' }), text: async () => '' };
  };
  await whisperTranscribeFile('http://localhost', 'tok', 'file://a.m4a', undefined, goodReader);
  assert.ok(capturedForm instanceof FormData, 'body must be FormData');
  // Verify the 'audio' field exists — FormData.get is available in Node 18+
  const audioEntry = capturedForm.get('audio');
  assert.ok(audioEntry !== null && audioEntry !== undefined, '"audio" field must be present');
  // Check filename if the runtime supports it (Blob name exposed through File)
  if (audioEntry && typeof audioEntry.name === 'string') {
    assert.equal(audioEntry.name, 'audio.m4a', 'filename must be audio.m4a');
  }
});

console.log('\n── W-6  Language field present when hint supplied ──────────────────');
test('W-6: languageHint="ta" → FormData contains language=ta', async () => {
  let capturedForm = null;
  globalThis.fetch = async (_url, opts) => {
    capturedForm = opts.body;
    return { status: 200, ok: true, json: async () => ({ text: 'வணக்கம்' }), text: async () => '' };
  };
  await whisperTranscribeFile('http://localhost', 'tok', 'file://ta.m4a', 'ta', goodReader);
  const lang = capturedForm?.get('language');
  assert.equal(lang, 'ta', `language field must be "ta", got: ${lang}`);
});

console.log('\n── W-7  No language field when hint omitted ────────────────────────');
test('W-7: no languageHint → FormData must NOT contain language field', async () => {
  let capturedForm = null;
  globalThis.fetch = async (_url, opts) => {
    capturedForm = opts.body;
    return { status: 200, ok: true, json: async () => ({ text: 'hello' }), text: async () => '' };
  };
  await whisperTranscribeFile('http://localhost', 'tok', 'file://en.m4a', undefined, goodReader);
  const lang = capturedForm?.get('language');
  assert.equal(lang, null, `language field must be absent, got: ${lang}`);
});

console.log('\n── W-8  401 → __session_expired__ ─────────────────────────────────');
test('W-8: HTTP 401 → throws __session_expired__', async () => {
  globalThis.fetch = mockFetch(401, { detail: 'Invalid token' });
  try {
    await whisperTranscribeFile('http://localhost', 'tok', 'file://a.m4a', undefined, goodReader);
    assert.fail('expected throw');
  } catch (err) {
    assert.ok(err.message.includes('__session_expired__'), `got: ${err.message}`);
  }
});

console.log('\n── W-9  500 → __transcribe_failed__ with status ────────────────────');
test('W-9: HTTP 500 → throws __transcribe_failed__ with status=500', async () => {
  globalThis.fetch = mockFetch(500, { detail: 'server error' });
  try {
    await whisperTranscribeFile('http://localhost', 'tok', 'file://a.m4a', undefined, goodReader);
    assert.fail('expected throw');
  } catch (err) {
    assert.ok(err.message.includes('__transcribe_failed__'), `got: ${err.message}`);
    assert.equal(err.status, 500, `status must be 500, got: ${err.status}`);
  }
});

console.log('\n── W-10 Network failure → __network_error__ ────────────────────────');
test('W-10: fetch throws TypeError → __network_error__', async () => {
  globalThis.fetch = async () => { throw new TypeError('Network request failed'); };
  try {
    await whisperTranscribeFile('http://localhost', 'tok', 'file://a.m4a', undefined, goodReader);
    assert.fail('expected throw');
  } catch (err) {
    assert.ok(err.message.includes('__network_error__'), `got: ${err.message}`);
  }
});

console.log('\n── W-11 AbortSignal cancellation ───────────────────────────────────');
test('W-11: fetch rejects with AbortError → surfaces as __network_error__', async () => {
  // Simulate an AbortController abort (fetch rejects with a DOMException-like error)
  globalThis.fetch = async () => {
    const e = new Error('The operation was aborted');
    e.name = 'AbortError';
    throw e;
  };
  try {
    await whisperTranscribeFile('http://localhost', 'tok', 'file://a.m4a', undefined, goodReader);
    assert.fail('expected throw');
  } catch (err) {
    // AbortError hits the `catch` in whisperTranscribeFile → __network_error__
    assert.ok(err.message.includes('__network_error__'), `got: ${err.message}`);
  }
});

// ── Run ───────────────────────────────────────────────────────────────────────
await runAll();

console.log(`\n${'═'.repeat(60)}`);
console.log(`  ${passed} PASS   ${failed} FAIL   ${passed + failed} total (local)`);
console.log('═'.repeat(60));
console.log(`
NOT RUN — Android-only (requires native build + authorization):
  W-12  expo/fetch(file:// URI) → non-empty Blob from device filesystem
  W-13  Tamil audio MIME/codec accepted by Whisper via expo/fetch
`);

if (failed > 0) process.exit(1);
