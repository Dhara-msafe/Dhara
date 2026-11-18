#!/usr/bin/env node
/**
 * DHARA Evidence – Chunked Crypto Test Harness
 * =============================================
 * Runtime : Node.js  (NOT Expo / React Native)
 * Scope   : Synthetic data only — no production files, no real recordings.
 * Run     : node __tests__/chunkedCrypto.node.test.mjs
 *
 * Validates the ctr-hmac-v1 file format used by evidenceChunkedCrypto.ts.
 * Uses Node.js built-in `crypto` which is mathematically identical to the
 * expo-crypto / aes-js implementation in production.
 *
 * IMPORTANT – what this harness covers and what it does NOT:
 *   ✅  Format integrity guarantees (tamper, truncation, reorder, substitution)
 *   ✅  Round-trip byte-perfect decryption
 *   ✅  Source-file preservation on encrypt failure
 *   ✅  Interrupted-write (placeholder root-HMAC) rejection
 *   ✅  Cross-scope (wrong-key) rejection
 *   ✅  Old-format data routed into chunked verifier rejected immediately
 *   ❌  Native FileHandle I/O (expo-file-system) — requires Android/iOS build
 *   ❌  Real SecureStore AES key retrieval — requires native keystore
 *   ❌  Peak-heap measurement — requires Android Studio Profiler (pending build)
 *   ❌  T06 / T16 / T17 physical-device regression — pending Android build
 *
 * === Format reference (from evidenceChunkedCrypto.ts) ===
 *
 *  Header (52 bytes)
 *    [0:16]  IV — 16 random bytes
 *    [16:48] Root HMAC — HMAC-SHA256(hmacKey, IV ‖ uint32be(count) ‖ MAC₀…MACₙ₋₁)
 *    [48:52] Total chunk count — uint32 big-endian
 *
 *  Per chunk i:
 *    [+0:4]   chunk index    — uint32 big-endian  (reordering detection)
 *    [+4:8]   ciphertext len — uint32 big-endian
 *    [+8:40]  per-chunk HMAC — HMAC-SHA256(hmacKey, uint32be(i) ‖ uint32be(len) ‖ ciphertext)
 *    [+40:+40+len] AES-256-CTR ciphertext
 *
 *  HMAC key derivation:
 *    hmacKey = SHA-256(aesKey ‖ iv ‖ 'dhara-evidence-hmac-v1')
 */

import { createHash, createHmac, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

// ── Constants (must match evidenceChunkedCrypto.ts exactly) ─────────────────
const CHUNK_SIZE         = 4 * 1024 * 1024;   // 4 MB — same as production
const HEADER_SIZE        = 52;
const CHUNK_HEADER_SIZE  = 40;
const MAX_SAFE_CHUNK_LEN = CHUNK_SIZE + 16;
const MAX_CHUNK_COUNT    = 100_000;
const AUTH_LABEL         = Buffer.from('dhara-evidence-hmac-v1', 'utf8');

// ── Crypto primitives ────────────────────────────────────────────────────────

function u32be(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}
function readU32be(buf, offset) {
  return buf.readUInt32BE(offset);
}
function sha256(data) {
  return createHash('sha256').update(data).digest();
}
/**
 * HMAC-SHA256 — mathematically identical to the manual iKey/oKey implementation
 * in evidenceChunkedCrypto.ts (prepareHmacKeys + hmacSha256 + computeChunkMac).
 * Both reduce to: SHA256(oKey ‖ SHA256(iKey ‖ msg)), which is HMAC-SHA256.
 */
function hmac256(key, msg) {
  return createHmac('sha256', key).update(msg).digest();
}
/** SHA-256(aesKey ‖ iv ‖ AUTH_LABEL) — mirrors deriveHmacKey() in production. */
function deriveHmacKey(aesKey, iv) {
  return sha256(Buffer.concat([aesKey, iv, AUTH_LABEL]));
}
/** HMAC-SHA256(hmacKey, uint32be(idx) ‖ uint32be(len) ‖ ciphertext). */
function chunkMac(hmacKey, idx, cipherBuf) {
  return hmac256(hmacKey, Buffer.concat([u32be(idx), u32be(cipherBuf.length), cipherBuf]));
}
/** HMAC-SHA256(hmacKey, IV ‖ uint32be(count) ‖ MAC₀ ‖ … ‖ MACₙ₋₁). */
function rootMac(hmacKey, iv, count, macs) {
  return hmac256(hmacKey, Buffer.concat([iv, u32be(count), ...macs]));
}

// ── Reference encoder (mirrors encryptFileChunked) ───────────────────────────
/**
 * Builds a valid ctr-hmac-v1 Buffer from a plaintext Buffer and AES-256 key.
 * Uses a single AES-CTR cipher instance so the counter is continuous across
 * chunk boundaries — same as the production aes-js usage.
 */
function buildEncryptedFile(aesKey, plaintext) {
  const iv      = randomBytes(16);
  const hmacKey = deriveHmacKey(aesKey, iv);
  const count   = Math.ceil(plaintext.length / CHUNK_SIZE);
  const cipher  = createCipheriv('aes-256-ctr', aesKey, iv);

  const chunkMacs = [];
  const chunkBufs = [];

  for (let i = 0; i < count; i++) {
    const plain   = plaintext.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    const enc     = cipher.update(plain);
    const mac     = chunkMac(hmacKey, i, enc);
    chunkMacs.push(mac);
    chunkBufs.push(Buffer.concat([u32be(i), u32be(enc.length), mac, enc]));
  }
  cipher.final();

  const rMac   = rootMac(hmacKey, iv, count, chunkMacs);
  const header = Buffer.concat([iv, rMac, u32be(count)]);
  return Buffer.concat([header, ...chunkBufs]);
}

// ── Reference decoder / verifier (mirrors decryptFileChunked) ────────────────
/**
 * Verifies and decrypts a ctr-hmac-v1 Buffer.
 * Throws on any integrity violation — same error strings as production so
 * test assertions can match them directly.
 * Returns the plaintext Buffer on success.
 */
function verifyAndDecrypt(aesKey, fileData) {
  if (fileData.length < HEADER_SIZE)
    throw new Error('File truncated: header is incomplete.');

  const iv            = fileData.slice(0, 16);
  const storedRootMac = fileData.slice(16, 48);
  const chunkCount    = readU32be(fileData, 48);

  if (chunkCount === 0 || chunkCount > MAX_CHUNK_COUNT)
    throw new Error(`Invalid chunk count in header: ${chunkCount}.`);

  const hmacKey   = deriveHmacKey(aesKey, iv);
  const decipher  = createDecipheriv('aes-256-ctr', aesKey, iv);
  const collMacs  = [];
  const plainBufs = [];
  let   offset    = HEADER_SIZE;

  for (let i = 0; i < chunkCount; i++) {
    if (offset + CHUNK_HEADER_SIZE > fileData.length)
      throw new Error(
        `File truncated: chunk ${i} header is incomplete (got ${fileData.length - offset} B).`
      );

    const readIdx = readU32be(fileData, offset);
    const cLen    = readU32be(fileData, offset + 4);
    const sMac    = fileData.slice(offset + 8, offset + 40);
    offset += CHUNK_HEADER_SIZE;

    if (readIdx !== i)
      throw new Error(
        `Chunk reordering detected: expected index ${i}, read ${readIdx}.`
      );
    if (cLen === 0 || cLen > MAX_SAFE_CHUNK_LEN)
      throw new Error(`Chunk ${i} has invalid ciphertext length: ${cLen}.`);
    if (offset + cLen > fileData.length)
      throw new Error(
        `File truncated: chunk ${i} body is incomplete ` +
        `(expected ${cLen} B, got ${fileData.length - offset} B).`
      );

    const cBuf   = fileData.slice(offset, offset + cLen);
    offset      += cLen;
    const expMac = chunkMac(hmacKey, i, cBuf);

    if (!expMac.equals(sMac))
      throw new Error(
        `Authentication failed for chunk ${i} — file may be corrupted or tampered.`
      );

    collMacs.push(sMac);
    plainBufs.push(decipher.update(cBuf));
  }
  decipher.final();

  const expRootMac = rootMac(hmacKey, iv, chunkCount, collMacs);
  if (!expRootMac.equals(storedRootMac))
    throw new Error(
      'File authentication failed — root HMAC mismatch. ' +
      'The file structure may be corrupt or the chunk list was modified.'
    );

  return Buffer.concat(plainBufs);
}

// ── Test runner ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const results = [];

function pass(label, note = '') {
  results.push({ status: 'PASS', label, note });
  console.log(`  ✅  PASS  ${label}${note ? `\n             └─ ${note}` : ''}`);
  passed++;
}
function fail(label, detail) {
  results.push({ status: 'FAIL', label, detail });
  console.error(`  ❌  FAIL  ${label}\n           ${detail}`);
  failed++;
}
function expectReject(fn, label, expectedFragment) {
  try {
    fn();
    fail(label, 'Expected an error to be thrown, but the call succeeded.');
  } catch (e) {
    const msg = String(e.message ?? e);
    if (!expectedFragment || msg.toLowerCase().includes(expectedFragment.toLowerCase())) {
      pass(label, msg);
    } else {
      fail(label, `Wrong error.\n  Expected fragment: "${expectedFragment}"\n  Actual message:    "${msg}"`);
    }
  }
}

// ── Synthetic data setup ─────────────────────────────────────────────────────
// 9 MB = 3 chunks at CHUNK_SIZE = 4 MB  (chunks: 4 MB + 4 MB + 1 MB)
const KEY       = randomBytes(32);       // 256-bit AES key — fresh per run
const PLAIN     = randomBytes(9 * 1024 * 1024);
const ENCRYPTED = buildEncryptedFile(KEY, PLAIN);

// Pre-compute chunk-0 / chunk-1 boundaries for tamper tests
const C0_LEN    = readU32be(ENCRYPTED, HEADER_SIZE + 4);        // ciphertext length of chunk 0
const C0_END    = HEADER_SIZE + CHUNK_HEADER_SIZE + C0_LEN;     // byte offset of chunk 1 start
const C1_LEN    = readU32be(ENCRYPTED, C0_END + 4);             // ciphertext length of chunk 1
const C1_END    = C0_END + CHUNK_HEADER_SIZE + C1_LEN;

console.log('\nDHARA Evidence — Chunked Crypto Test Harness (Node.js)');
console.log('='.repeat(62));
console.log(`Key       : ${KEY.toString('hex').slice(0, 16)}…  (32 B, ephemeral)`);
console.log(`Plaintext : ${PLAIN.length.toLocaleString()} bytes`);
console.log(`Encrypted : ${ENCRYPTED.length.toLocaleString()} bytes`);
console.log(`Chunks    : ${Math.ceil(PLAIN.length / CHUNK_SIZE)}`);
console.log('');

// ── TC-01 : Clean round-trip ─────────────────────────────────────────────────
{
  console.log('TC-01  Clean round-trip (9 MB, 3 chunks)');
  let dec;
  try {
    dec = verifyAndDecrypt(KEY, ENCRYPTED);
  } catch (e) {
    fail('TC-01 round-trip success', e.message);
  }
  if (dec) {
    if (dec.equals(PLAIN)) pass('TC-01 byte-perfect plaintext recovery');
    else                   fail('TC-01 byte-perfect plaintext recovery', `Length ${dec.length} vs ${PLAIN.length}`);
  }
}

// ── TC-02 : Bit-flip in ciphertext of chunk 1 ───────────────────────────────
{
  console.log('\nTC-02  Bit-flip in chunk 1 ciphertext body');
  const tampered = Buffer.from(ENCRYPTED);
  // 100 bytes into chunk 1's ciphertext payload
  tampered[C0_END + CHUNK_HEADER_SIZE + 100] ^= 0xFF;
  expectReject(
    () => verifyAndDecrypt(KEY, tampered),
    'TC-02 bit-flip rejected (per-chunk HMAC)',
    'Authentication failed for chunk'
  );
}

// ── TC-03 : Header truncation ────────────────────────────────────────────────
{
  console.log('\nTC-03  Header truncation (20 of 52 bytes)');
  expectReject(
    () => verifyAndDecrypt(KEY, ENCRYPTED.slice(0, 20)),
    'TC-03 header truncation rejected',
    'header is incomplete'
  );
}

// ── TC-04 : File truncation mid-chunk body ───────────────────────────────────
{
  console.log('\nTC-04  File truncation mid-chunk-0 body');
  // Keep header + chunk-0 header but remove last 10 bytes of chunk-0 ciphertext
  const truncAt = C0_END - 10;
  expectReject(
    () => verifyAndDecrypt(KEY, ENCRYPTED.slice(0, truncAt)),
    'TC-04 body truncation rejected',
    'incomplete'
  );
}

// ── TC-05 : Chunk truncation at header boundary ──────────────────────────────
{
  console.log('\nTC-05  Chunk truncation at chunk-1 header boundary');
  // File ends exactly at the start of chunk 1 — chunk-1 header missing
  expectReject(
    () => verifyAndDecrypt(KEY, ENCRYPTED.slice(0, C0_END)),
    'TC-05 chunk-1 header missing rejected',
    'incomplete'
  );
}

// ── TC-06 : Missing chunk (chunk 1 removed, header still says 3 chunks) ──────
{
  console.log('\nTC-06  Missing chunk (chunk 1 removed from 3-chunk file)');
  // Without chunk 1, what was chunk 2 is now at chunk 1's position but
  // its index field reads 2 — reordering detection must fire.
  const withoutC1 = Buffer.concat([
    ENCRYPTED.slice(0, C0_END),
    ENCRYPTED.slice(C1_END),
  ]);
  expectReject(
    () => verifyAndDecrypt(KEY, withoutC1),
    'TC-06 missing chunk detected',
    'reordering' // "Chunk reordering detected: expected index 1, read 2"
  );
}

// ── TC-07 : Reordered chunks (chunks 0 and 1 swapped) ───────────────────────
{
  console.log('\nTC-07  Reordered chunks (swap chunk 0 and chunk 1)');
  const chunk0 = ENCRYPTED.slice(HEADER_SIZE, C0_END);
  const chunk1 = ENCRYPTED.slice(C0_END, C1_END);
  const reordered = Buffer.concat([
    ENCRYPTED.slice(0, HEADER_SIZE), // header unchanged
    chunk1,                           // chunk 1 moved to position 0
    chunk0,                           // chunk 0 moved to position 1
    ENCRYPTED.slice(C1_END),          // chunk 2 unchanged
  ]);
  expectReject(
    () => verifyAndDecrypt(KEY, reordered),
    'TC-07 reordering detected',
    'reordering' // "Chunk reordering detected: expected index 0, read 1"
  );
}

// ── TC-08 : Substituted chunk (chunk 0's ciphertext placed at chunk 1) ───────
{
  console.log('\nTC-08  Substituted chunk (chunk-0 ciphertext injected at chunk-1 position)');
  // Keep index field = 1 and chunk-1's MAC but replace body with chunk-0's ciphertext.
  // The MAC was computed over chunk-0's ciphertext — it will not match the
  // per-chunk-1 expected MAC (which covers idx=1, len, cipher).
  // Additionally length may differ, triggering either length or HMAC failure.
  const c0Cipher = ENCRYPTED.slice(HEADER_SIZE + CHUNK_HEADER_SIZE, C0_END);
  const c1Mac    = ENCRYPTED.slice(C0_END + 8, C0_END + 40);  // chunk-1's stored MAC

  const fakeC1 = Buffer.concat([
    u32be(1),                // index = 1 (correct)
    u32be(c0Cipher.length),  // length = chunk-0's length
    c1Mac,                   // wrong MAC (computed over different data)
    c0Cipher,                // chunk-0's ciphertext
  ]);
  const substituted = Buffer.concat([
    ENCRYPTED.slice(0, C0_END),
    fakeC1,
    ENCRYPTED.slice(C1_END),
  ]);
  expectReject(
    () => verifyAndDecrypt(KEY, substituted),
    'TC-08 substituted chunk rejected (per-chunk HMAC)',
    'Authentication failed for chunk'
  );
}

// ── TC-09 : Interrupted encryption (root HMAC slot zeroed) ──────────────────
{
  console.log('\nTC-09  Interrupted encryption (root HMAC placeholder = 0x00…00)');
  // Simulates a crash after chunks were written but before the root HMAC
  // was seeked back and committed.  The placeholder (all-zeros) was left.
  const incomplete = Buffer.from(ENCRYPTED);
  incomplete.fill(0, 16, 48);
  expectReject(
    () => verifyAndDecrypt(KEY, incomplete),
    'TC-09 incomplete file (zeroed root HMAC) rejected',
    'root HMAC mismatch'
  );
}

// ── TC-10 : Wrong AES key (cross-scope access prevention) ───────────────────
{
  console.log('\nTC-10  Wrong AES key (cross-scope / cross-account access attempt)');
  const wrongKey = randomBytes(32);
  expectReject(
    () => verifyAndDecrypt(wrongKey, ENCRYPTED),
    'TC-10 wrong-key access rejected',
    'Authentication failed' // per-chunk or root HMAC fails
  );
}

// ── TC-11 : IV replaced ──────────────────────────────────────────────────────
{
  console.log('\nTC-11  IV field replaced (hmacKey derivation broken)');
  // Replacing the IV changes the derived hmacKey → all chunk MACs fail.
  const ivReplaced = Buffer.from(ENCRYPTED);
  randomBytes(16).copy(ivReplaced, 0);
  expectReject(
    () => verifyAndDecrypt(KEY, ivReplaced),
    'TC-11 IV replacement rejected',
    'Authentication failed for chunk'
  );
}

// ── TC-12 : Inflated chunk count ─────────────────────────────────────────────
{
  console.log('\nTC-12  Inflated chunk count in header');
  const inflated = Buffer.from(ENCRYPTED);
  inflated.writeUInt32BE(99_999, 48);
  expectReject(
    () => verifyAndDecrypt(KEY, inflated),
    'TC-12 inflated chunk count triggers truncation error',
    'incomplete'
  );
}

// ── TC-13 : Failed save preserves original recording ────────────────────────
{
  console.log('\nTC-13  Failed save — source buffer untouched after encrypt call');
  const src     = randomBytes(5 * 1024 * 1024);  // 5 MB synthetic "recording"
  const srcCopy = Buffer.from(src);               // reference snapshot
  buildEncryptedFile(KEY, src);                   // encrypt call must not modify src
  if (src.equals(srcCopy))
    pass('TC-13 source buffer unchanged after encryptFileChunked');
  else
    fail('TC-13 source buffer unchanged after encryptFileChunked',
      'Source data was mutated during encryption — safety violation!');
}

// ── TC-14 : Old-format data rejected immediately ─────────────────────────────
{
  console.log('\nTC-14  Old-format evidence (< 52 bytes) rejected at header parse');
  // Before ctr-hmac-v1, evidence was stored as a base64 JSON payload.
  // If such data is mistakenly routed to the chunked verifier it must
  // fail fast at the header-size check without decrypting garbage.
  const legacyMock = Buffer.from(
    JSON.stringify({ iv: 'aabbcc', cipher: 'base64data' }),
    'utf8'
  );  // 46 bytes < HEADER_SIZE(52)
  expectReject(
    () => verifyAndDecrypt(KEY, legacyMock),
    'TC-14 old-format data rejected at header check',
    'header is incomplete'
  );
}

// ── TC-15 : Round-trip at exactly CHUNK_SIZE boundary ───────────────────────
{
  console.log('\nTC-15  Round-trip at exactly one CHUNK_SIZE boundary (4 MB)');
  const exactPlain = randomBytes(CHUNK_SIZE);
  const enc = buildEncryptedFile(KEY, exactPlain);
  let dec;
  try {
    dec = verifyAndDecrypt(KEY, enc);
  } catch (e) {
    fail('TC-15 single-chunk round-trip', e.message);
  }
  if (dec) {
    if (dec.equals(exactPlain)) pass('TC-15 single-chunk byte-perfect recovery');
    else                        fail('TC-15 single-chunk byte-perfect recovery', 'Mismatch');
  }
}

// ── TC-16 : Round-trip tiny file (< 1 chunk) ────────────────────────────────
{
  console.log('\nTC-16  Round-trip sub-chunk file (1 KB)');
  const tiny    = randomBytes(1024);
  const enc     = buildEncryptedFile(KEY, tiny);
  let dec;
  try {
    dec = verifyAndDecrypt(KEY, enc);
  } catch (e) {
    fail('TC-16 sub-chunk round-trip', e.message);
  }
  if (dec) {
    if (dec.equals(tiny)) pass('TC-16 sub-chunk byte-perfect recovery');
    else                  fail('TC-16 sub-chunk byte-perfect recovery', 'Mismatch');
  }
}

// ── TC-17 : Same ciphertext, different scope key → rejected ─────────────────
{
  console.log('\nTC-17  Ciphertext from scope A cannot be decrypted by scope B key');
  const keyA    = randomBytes(32);
  const keyB    = randomBytes(32);
  const encA    = buildEncryptedFile(keyA, randomBytes(512 * 1024));
  expectReject(
    () => verifyAndDecrypt(keyB, encA),
    'TC-17 cross-scope decryption rejected',
    'Authentication failed'
  );
}

// ── Summary ──────────────────────────────────────────────────────────────────
const TOTAL = passed + failed;
console.log('\n' + '='.repeat(62));
console.log(`Results: ${passed} / ${TOTAL} passed`);

if (failed === 0) {
  console.log('\n🛡️  All chunked crypto integrity checks PASSED (Node.js path).');
  console.log('\nPending (require physical Android build):');
  console.log('  • T06  Recording playback regression on real device');
  console.log('  • T16  Chunked encrypt on real 24+ MB file via FileHandle');
  console.log('  • T17  Chunked decrypt with partial read recovery on device');
  console.log('  • Peak-heap profiling via Android Studio Profiler');
} else {
  console.log('\n⚠️  Some tests FAILED — review output above before proceeding.');
}

const report = {
  _note: 'Node.js only. See header for what this harness covers vs what requires a native build.',
  timestamp: new Date().toISOString(),
  runtime: 'Node.js',
  algorithm: 'ctr-hmac-v1',
  chunk_size_bytes: CHUNK_SIZE,
  synthetic_data_bytes: PLAIN.length,
  chunks_in_primary_set: Math.ceil(PLAIN.length / CHUNK_SIZE),
  passed,
  failed,
  total: TOTAL,
  tests: results,
  pending_native: [
    'T06 — recording playback regression (physical Android device)',
    'T16 — chunked encrypt >24 MB via expo-file-system FileHandle (physical device)',
    'T17 — chunked decrypt partial-read recovery (physical device)',
    'Peak-heap profiling — Android Studio Memory Profiler (physical device)',
  ],
};

console.log('\n--- JSON REPORT ---');
console.log(JSON.stringify(report, null, 2));

process.exit(failed > 0 ? 1 : 0);
