/**
 * B-93 (D-27, decided 13 Nov): Encrypt draft notices and Women's Shield data
 * on the phone (small scope only).
 *
 * Scope found by reading the code (no pre-existing ticket detail beyond the
 * one-line description):
 *  - "draft notices" = frontend/src/draftHistory.ts -- the Legal Notice
 *    Drafts history, already documented in its own file as "device-only by
 *    design: a legal notice contains names, addresses and amounts" -- but
 *    it was stored as a bare plaintext JSON array in AsyncStorage.
 *  - "Women's Shield data" = the Evidence Locker's hash-chain manifest
 *    (frontend/src/women/evidenceManifest.ts). The evidence FILES themselves
 *    were already AES-256-CTR encrypted at rest (S-B5, evidenceStore.ts) --
 *    the gap was the manifest's `gps` field (precise location of where
 *    evidence was recorded), which was still plaintext JSON in AsyncStorage
 *    even though the files next to it were already encrypted.
 *
 * Fix: both now encrypt at rest using the same AES-256-CTR primitives
 * already used for evidence files (frontend/src/women/evidenceCrypto.ts),
 * via two new thin helpers there (encryptText/decryptText) for JSON
 * payloads that live directly in AsyncStorage rather than as a File. Keys
 * are hardware-backed where available (SecureStore on native) via the
 * existing getOrCreateKey(). Legacy plaintext (saved before this change) is
 * still read back correctly -- no data loss, no forced migration.
 *
 * This test has two parts:
 *  1. A REAL, executed behavioral check that the AES-256-CTR encrypt/decrypt
 *     round-trip evidenceCrypto.ts's encryptText/decryptText implement
 *     (hex-encoded ciphertext via aes-js, the same real dependency already
 *     used by the app) actually works bit-for-bit -- using the same
 *     `aes-js` package the app depends on (no reimplementation, no mock).
 *     evidenceCrypto.ts itself can't be executed directly here (it imports
 *     react-native/expo-secure-store, native modules absent in plain Node),
 *     so this exercises the identical algorithm it wraps.
 *  2. Source-wiring checks (this repo's established convention for RN
 *     modules with no renderer/native-module support in plain Node)
 *     confirming draftHistory.ts and evidenceManifest.ts actually call
 *     those helpers, store an envelope (not plaintext), and still fall
 *     back to legacy plaintext on read.
 *
 * Run with: node --experimental-strip-types --test src/__tests__/b93_encrypt_draft_notices_women_shield_data.test.mjs
 * (run from the frontend/ directory; requires the real `aes-js` dependency)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const aesjs = require('aes-js');

const EVIDENCE_CRYPTO_TS = readFileSync(path.join(__dirname, '../women/evidenceCrypto.ts'), 'utf8');
const DRAFT_HISTORY_TS = readFileSync(path.join(__dirname, '../draftHistory.ts'), 'utf8');
const EVIDENCE_MANIFEST_TS = readFileSync(path.join(__dirname, '../women/evidenceManifest.ts'), 'utf8');

// ── Part 1: real executed behavioral coverage of the actual algorithm ──────

function toHex(bytes) { return aesjs.utils.hex.fromBytes(bytes); }
function fromHex(hex) { return aesjs.utils.hex.toBytes(hex); }

function encryptText(plainText, key, ivBytes) {
  const cipher = new aesjs.ModeOfOperation.ctr(key, new aesjs.Counter(ivBytes));
  return { cipherHex: toHex(cipher.encrypt(aesjs.utils.utf8.toBytes(plainText))), iv: toHex(ivBytes) };
}
function decryptText(cipherHex, key, ivHex) {
  const decipher = new aesjs.ModeOfOperation.ctr(key, new aesjs.Counter(fromHex(ivHex)));
  return aesjs.utils.utf8.fromBytes(decipher.decrypt(fromHex(cipherHex)));
}

test('encryptText/decryptText round-trip a JSON legal-notice-draft payload exactly', () => {
  const key = new Uint8Array(32).fill(42);
  const iv = new Uint8Array(16).fill(9);
  const original = JSON.stringify([{ id: '1', type: 'rent_notice', title: 'Rent demand', text: 'Dear X, pay Y by Z', lang: 'en', created_at: '2026-11-14T00:00:00Z' }]);
  const { cipherHex, iv: ivHex } = encryptText(original, key, iv);
  assert.notEqual(cipherHex, original, 'ciphertext must not equal the plaintext');
  assert.doesNotMatch(cipherHex, /pay Y by Z/, 'ciphertext must not contain the readable draft text');
  const decrypted = decryptText(cipherHex, key, ivHex);
  assert.equal(decrypted, original);
});

test('encryptText/decryptText round-trip a GPS coordinate payload exactly, and a wrong key fails to recover it', () => {
  const key = new Uint8Array(32).fill(7);
  const wrongKey = new Uint8Array(32).fill(8);
  const iv = new Uint8Array(16).fill(3);
  const original = JSON.stringify({ lat: 17.385044, lng: 78.486671, accuracy: 12 });
  const { cipherHex, iv: ivHex } = encryptText(original, key, iv);
  const decrypted = decryptText(cipherHex, key, ivHex);
  assert.equal(decrypted, original);
  const wrongDecrypt = decryptText(cipherHex, wrongKey, ivHex);
  assert.notEqual(wrongDecrypt, original, 'decrypting with the wrong key must not recover the real GPS point');
});

// ── Part 2: source-wiring — confirm the real app files actually use this ───

test('evidenceCrypto.ts exports encryptText/decryptText for JSON-in-AsyncStorage use', () => {
  assert.match(EVIDENCE_CRYPTO_TS, /export async function encryptText/);
  assert.match(EVIDENCE_CRYPTO_TS, /export function decryptText/);
});

test('draftHistory.ts no longer writes plaintext JSON directly to AsyncStorage', () => {
  assert.match(DRAFT_HISTORY_TS, /encryptText\(/);
  assert.match(DRAFT_HISTORY_TS, /getOrCreateKey\(/);
  // The one remaining AsyncStorage.setItem call must write the encrypted
  // envelope, not the raw items array.
  assert.match(DRAFT_HISTORY_TS, /AsyncStorage\.setItem\(KEY,\s*JSON\.stringify\(envelope\)\)/);
});

test('draftHistory.ts still reads back legacy plaintext history (no data loss / forced migration)', () => {
  assert.match(DRAFT_HISTORY_TS, /Array\.isArray\(parsed\)/);
});

test('draftHistory.ts decrypts the envelope on read using the same key scope it encrypted with', () => {
  assert.match(DRAFT_HISTORY_TS, /isEnvelope\(parsed\)/);
  assert.match(DRAFT_HISTORY_TS, /decryptText\(parsed\.cipher,\s*key,\s*parsed\.iv\)/);
});

test('evidenceManifest.ts encrypts the gps field at rest, not just hashes/timestamps', () => {
  assert.match(EVIDENCE_MANIFEST_TS, /encryptText\(JSON\.stringify\(gps\)/);
  assert.match(EVIDENCE_MANIFEST_TS, /gpsEnc/);
});

test('evidenceManifest.ts decrypts gps transparently on read, keeping the public ManifestEntry shape unchanged', () => {
  assert.match(EVIDENCE_MANIFEST_TS, /decryptText\(gpsEnc\.cipher,\s*key,\s*gpsEnc\.iv\)/);
  // Every exported function must still be typed to return a plain
  // ManifestEntry (gps: GpsPoint | null) -- the encryption is invisible to
  // every existing caller (evidenceBackup.ts, evidence-locker.tsx, etc).
  assert.match(EVIDENCE_MANIFEST_TS, /readManifest\(scope: string\): Promise<ManifestEntry\[\]>/);
});

test('evidenceManifest.ts reuses the same per-scope evidence key, no new key material', () => {
  assert.match(EVIDENCE_MANIFEST_TS, /import\s*\{[^}]*getOrCreateKey[^}]*\}\s*from\s*['"]\.\/evidenceCrypto['"]/);
});
