/**
 * Chunked AES-256-CTR + HMAC-SHA256 encryption / decryption (native)
 * -------------------------------------------------------------------
 * Uses expo-file-system's `FileHandle` for bounded-memory I/O so files of
 * any size can be encrypted or decrypted without buffering the entire
 * content in a single Uint8Array.
 *
 * Peak RAM per operation: ~12 MB regardless of file size
 *   (cipher-chunk 4 MB + HMAC inner-input ~4 MB + plain-chunk 4 MB).
 * Compare with the in-memory path: 2 × file-size (e.g. 200 MB for a
 * 100 MB file on a 128 MB-heap Android).
 *
 * === File format (`auth_format: 'ctr-hmac-v1'`) ===
 *
 *  Header (52 bytes):
 *    [0:16]  IV — 16 random bytes; also an input to HMAC key derivation
 *    [16:48] Root HMAC — HMAC-SHA256(hmacKey, IV ‖ uint32be(count) ‖ MAC₀…MACₙ₋₁)
 *    [48:52] Total chunk count — uint32 big-endian
 *
 *  For each chunk i (0-indexed):
 *    [+0:4]   chunk index    — uint32 big-endian (reordering detection)
 *    [+4:8]   ciphertext len — uint32 big-endian
 *    [+8:40]  per-chunk HMAC — HMAC-SHA256(hmacKey, uint32be(i) ‖ uint32be(len) ‖ ciphertext)
 *    [+40:+40+len] AES-256-CTR ciphertext
 *
 * === HMAC key derivation ===
 *
 *   hmacKey = SHA-256(aesKey ‖ iv ‖ 'dhara-evidence-hmac-v1')
 *
 *   This binds the HMAC key to both the per-file encryption key and the IV,
 *   ensuring swapping the IV field is itself detectable via the root HMAC.
 *
 * === Security properties ===
 *
 *   Corrupted chunk     → per-chunk HMAC fails → reject before writing any plaintext
 *   Truncated file      → readBytes returns short → error → partial output deleted
 *   Reordered chunks    → index field mismatch → reject
 *   Substituted chunk   → HMAC over (index ‖ len ‖ ciphertext) fails → reject
 *   IV replaced         → hmacKey changes → all chunk HMACs fail → reject
 *   Chunk removal/add   → root HMAC covers count + all chunk MACs → reject
 *   Old-format evidence → routed via `item.auth_format` check, never reaches here
 *
 * === Design document ===
 *   /app/memory/dhara_evidence/EVIDENCE_OOM_DESIGN.md
 */
import { File } from 'expo-file-system';
import * as aesjs from 'aes-js';
import * as Crypto from 'expo-crypto';
import { getOrCreateKey } from './evidenceCrypto';

export const CHUNK_SIZE      = 4 * 1024 * 1024; // 4 MB read window
const HEADER_SIZE            = 52;              // IV(16) + RootHMAC(32) + Count(4)
const CHUNK_HEADER_SIZE      = 40;              // Index(4) + Len(4) + MAC(32)
const MAX_SAFE_CHUNK_LEN     = CHUNK_SIZE + 16; // allow for block-size padding
const MAX_CHUNK_COUNT        = 100_000;         // sanity cap (~390 GB at 4 MB chunks)

// Label for HMAC key derivation: 'dhara-evidence-hmac-v1' as UTF-8 bytes
const AUTH_LABEL = new Uint8Array([
  100,104,97,114,97,45,101,118,105,100,101,110,99,101,45,104,109,97,99,45,118,49
]);

// ── Utility helpers ─────────────────────────────────────────────────────────

function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, false);
  return b;
}

function readU32be(buf: Uint8Array, offset: number): number {
  return new DataView(buf.buffer, buf.byteOffset + offset, 4).getUint32(0, false);
}

/** Constant-time equality — prevents timing-oracle attacks on MAC comparison. */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, data as unknown as ArrayBuffer)
  );
}

/**
 * Derives the per-file HMAC key from the AES key and IV.
 * Different IV → different hmacKey → swapping the IV is itself detectable.
 */
export async function deriveHmacKey(
  aesKey: Uint8Array,
  iv: Uint8Array,
): Promise<Uint8Array> {
  const inp = new Uint8Array(aesKey.length + iv.length + AUTH_LABEL.length);
  inp.set(aesKey, 0);
  inp.set(iv, aesKey.length);
  inp.set(AUTH_LABEL, aesKey.length + iv.length);
  return sha256(inp);
}

/**
 * Computes iKey and oKey from the HMAC key once; callers reuse them
 * across all chunk MACs to avoid 128-byte allocation per chunk.
 */
export function prepareHmacKeys(hmacKey: Uint8Array): [Uint8Array, Uint8Array] {
  const pad = new Uint8Array(64);
  pad.set(hmacKey); // hmacKey is 32 bytes; zero-extends to 64
  return [
    pad.map(b => b ^ 0x36), // iKey
    pad.map(b => b ^ 0x5c), // oKey
  ];
}

/** Inner HMAC-SHA256 worker using pre-computed iKey / oKey. */
async function hmacSha256(
  iKey: Uint8Array,
  oKey: Uint8Array,
  msg: Uint8Array,
): Promise<Uint8Array> {
  const inner = new Uint8Array(64 + msg.length);
  inner.set(iKey, 0);
  inner.set(msg, 64);
  const innerHash = await sha256(inner);
  const outer = new Uint8Array(96);
  outer.set(oKey, 0);
  outer.set(innerHash, 64);
  return sha256(outer);
}

/** Computes the per-chunk MAC over (uint32be(idx) ‖ uint32be(len) ‖ ciphertext). */
export async function computeChunkMac(
  iKey: Uint8Array,
  oKey: Uint8Array,
  idx: number,
  cipherChunk: Uint8Array,
): Promise<Uint8Array> {
  const msg = new Uint8Array(8 + cipherChunk.length);
  msg.set(u32be(idx), 0);
  msg.set(u32be(cipherChunk.length), 4);
  msg.set(cipherChunk, 8);
  return hmacSha256(iKey, oKey, msg);
}

/**
 * Computes the root HMAC over (IV ‖ uint32be(count) ‖ MAC₀ ‖ … ‖ MACₙ₋₁).
 * Covers the full chunk list including its length, so removal or addition of
 * chunks (even with valid per-chunk MACs) is detectable.
 */
export async function computeRootMac(
  hmacKey: Uint8Array,
  iv: Uint8Array,
  chunkCount: number,
  chunkMacs: Uint8Array[],
): Promise<Uint8Array> {
  const [iKey, oKey] = prepareHmacKeys(hmacKey);
  const msg = new Uint8Array(16 + 4 + chunkMacs.length * 32);
  msg.set(iv, 0);
  msg.set(u32be(chunkCount), 16);
  chunkMacs.forEach((m, i) => msg.set(m, 20 + i * 32));
  return hmacSha256(iKey, oKey, msg);
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Encrypts `sourceUri` to `destFile` in CHUNK_SIZE pieces using
 * AES-256-CTR + HMAC-SHA256 (`ctr-hmac-v1` format).
 *
 * Returns the IV hex string — same field used by in-memory encrypted items
 * so the RecordingItem schema needs no structural change beyond `auth_format`.
 *
 * On any error: `destFile` is deleted before rethrowing so the caller never
 * inherits a partially-written ciphertext.
 *
 * Recovery guarantee: `sourceUri` (the temp recorder output) is NEVER
 * modified or deleted; it stays available for retry.
 */
export async function encryptFileChunked(
  scope: string,
  sourceUri: string,
  destFile: File,
): Promise<string /* iv hex */> {
  const aesKey  = await getOrCreateKey(scope);
  const ivBytes = await Crypto.getRandomBytesAsync(16);
  const ivHex   = aesjs.utils.hex.fromBytes(ivBytes);

  // Open source first so we can read its size for the chunk count.
  const srcHandle = new File(sourceUri).open();
  const totalSize = srcHandle.size ?? 0;
  if (totalSize <= 0) {
    srcHandle.close();
    throw new Error('Source file is empty or inaccessible; cannot encrypt.');
  }
  const chunkCount = Math.ceil(totalSize / CHUNK_SIZE);

  // Create dest file with a placeholder header (zeros for root HMAC).
  const headerPlaceholder = new Uint8Array(HEADER_SIZE);
  headerPlaceholder.set(ivBytes, 0);
  new DataView(headerPlaceholder.buffer).setUint32(48, chunkCount, false);
  destFile.write(headerPlaceholder); // creates the file on disk

  const dstHandle = destFile.open();
  dstHandle.offset = HEADER_SIZE;

  const aesCtr    = new aesjs.ModeOfOperation.ctr(aesKey, new aesjs.Counter(ivBytes));
  const hmacKey   = await deriveHmacKey(aesKey, ivBytes);
  const [iKey, oKey] = prepareHmacKeys(hmacKey);
  const chunkMacs: Uint8Array[] = [];
  let bytesProcessed = 0;

  try {
    for (let i = 0; i < chunkCount; i++) {
      const chunkSize  = Math.min(CHUNK_SIZE, totalSize - bytesProcessed);
      const plainChunk  = srcHandle.readBytesSync(chunkSize);
      if (plainChunk.length < chunkSize) {
        throw new Error(`Source file truncated at chunk ${i}: expected ${chunkSize} B, got ${plainChunk.length} B.`);
      }
      const cipherChunk = aesCtr.encrypt(plainChunk);
      const mac         = await computeChunkMac(iKey, oKey, i, cipherChunk);
      chunkMacs.push(mac);

      dstHandle.writeBytes(u32be(i));
      dstHandle.writeBytes(u32be(cipherChunk.length));
      dstHandle.writeBytes(mac);
      dstHandle.writeBytes(cipherChunk);

      bytesProcessed += chunkSize;
    }

    // Write root HMAC into the placeholder slot in the header.
    const rootMac = await computeRootMac(hmacKey, ivBytes, chunkCount, chunkMacs);
    dstHandle.offset = 16; // seek back — always within file size at this point
    dstHandle.writeBytes(rootMac);

    return ivHex;
  } catch (err) {
    srcHandle.close();
    dstHandle.close();
    try { if (destFile.exists) destFile.delete(); } catch { /* best-effort */ }
    throw err;
  } finally {
    try { srcHandle.close(); } catch { /* best-effort */ }
    try { dstHandle.close(); } catch { /* best-effort */ }
  }
}

/**
 * Decrypts a `ctr-hmac-v1` ciphertext file into `tempFile` for preview.
 *
 * Verification order per chunk:
 *   1. Assert sequence index matches expected position  → reordering detection
 *   2. Verify per-chunk HMAC over (index ‖ length ‖ ciphertext) → corruption/substitution
 *   3. Decrypt — only after both checks pass
 *   4. Verify root HMAC after all chunks → chunk removal/addition detection
 *
 * On any error: `tempFile` is deleted before rethrowing; no incomplete
 * plaintext is left on disk.
 */
export async function decryptFileChunked(
  scope: string,
  cipherUri: string,
  tempFile: File,
): Promise<void> {
  const aesKey    = await getOrCreateKey(scope);
  const srcHandle = new File(cipherUri).open();

  // Create an empty temp file so the FileHandle can open it.
  tempFile.write(new Uint8Array(0));
  const dstHandle = tempFile.open();
  dstHandle.offset = 0;

  try {
    // ── Read and parse header ──────────────────────────────────────────────
    srcHandle.offset = 0;
    const header = srcHandle.readBytesSync(HEADER_SIZE);
    if (header.length < HEADER_SIZE) {
      throw new Error('File truncated: header is incomplete.');
    }
    const ivBytes        = header.slice(0, 16);
    const storedRootMac  = header.slice(16, 48);
    const chunkCount     = readU32be(header, 48);

    if (chunkCount === 0 || chunkCount > MAX_CHUNK_COUNT) {
      throw new Error(`Invalid chunk count in header: ${chunkCount}.`);
    }

    const aesCtr          = new aesjs.ModeOfOperation.ctr(aesKey, new aesjs.Counter(ivBytes));
    const hmacKey         = await deriveHmacKey(aesKey, ivBytes);
    const [iKey, oKey]    = prepareHmacKeys(hmacKey);
    const collectedMacs: Uint8Array[] = [];

    // ── Process chunks ────────────────────────────────────────────────────
    for (let i = 0; i < chunkCount; i++) {
      const chunkHeader = srcHandle.readBytesSync(CHUNK_HEADER_SIZE);
      if (chunkHeader.length < CHUNK_HEADER_SIZE) {
        throw new Error(`File truncated: chunk ${i} header is incomplete (got ${chunkHeader.length} B).`);
      }

      const readIdx    = readU32be(chunkHeader, 0);
      const cipherLen  = readU32be(chunkHeader, 4);
      const storedMac  = chunkHeader.slice(8, 40);

      // Reordering detection
      if (readIdx !== i) {
        throw new Error(`Chunk reordering detected: expected index ${i}, read ${readIdx}.`);
      }
      if (cipherLen === 0 || cipherLen > MAX_SAFE_CHUNK_LEN) {
        throw new Error(`Chunk ${i} has invalid ciphertext length: ${cipherLen}.`);
      }

      const cipherChunk = srcHandle.readBytesSync(cipherLen);
      if (cipherChunk.length < cipherLen) {
        throw new Error(`File truncated: chunk ${i} body is incomplete (expected ${cipherLen} B, got ${cipherChunk.length} B).`);
      }

      // Corruption / substitution detection — verify BEFORE decrypting
      const expectedMac = await computeChunkMac(iKey, oKey, i, cipherChunk);
      if (!constantTimeEqual(storedMac, expectedMac)) {
        throw new Error(`Authentication failed for chunk ${i} — file may be corrupted or tampered.`);
      }

      collectedMacs.push(storedMac);

      // Decrypt and write only after MAC passes
      const plainChunk = aesCtr.decrypt(cipherChunk);
      dstHandle.writeBytes(plainChunk);
    }

    // ── Root HMAC verification ────────────────────────────────────────────
    // Protects against chunk removal or addition (even with valid per-chunk MACs).
    const expectedRootMac = await computeRootMac(
      hmacKey, ivBytes, chunkCount, collectedMacs,
    );
    if (!constantTimeEqual(storedRootMac, expectedRootMac)) {
      throw new Error(
        'File authentication failed — root HMAC mismatch. ' +
        'The file structure may be corrupt or the chunk list was modified.',
      );
    }
  } catch (err) {
    srcHandle.close();
    dstHandle.close();
    // Remove any partial plaintext — never leave incomplete decrypted output.
    try { if (tempFile.exists) tempFile.delete(); } catch { /* best-effort */ }
    throw err;
  } finally {
    try { srcHandle.close(); } catch { /* best-effort */ }
    try { dstHandle.close(); } catch { /* best-effort */ }
  }
}
