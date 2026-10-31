import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as aesjs from 'aes-js';

/**
 * S-B5: Evidence Locker file-at-rest encryption (AES-256-CTR, pure JS via
 * `aes-js` — no native linking, works identically in Expo Go, web preview
 * and any future build).
 *
 * The encryption key is INDEPENDENT of the screen's PIN (evidenceLock.ts):
 * the PIN only gates who can open this screen; this key protects the file
 * bytes at rest even if someone reads the app's storage directly. Keeping
 * them separate means changing/resetting the PIN never locks out old
 * evidence. The key is generated once per scope (per logged-in user, or
 * "device" for guests) and persisted in:
 *   Native  → SecureStore (hardware-backed on supported devices)
 *   Web NEW → IndexedDB   (origin-scoped, not accessible via document.cookie
 *                          or localStorage APIs — harder to exfiltrate than
 *                          localStorage via XSS)
 *   Web OLD → AsyncStorage / localStorage (legacy fallback — existing users'
 *             keys remain readable; no migration forces data loss)
 *
 * B1-web-idb strategy (2026):
 *   New key writes go to IndexedDB only.
 *   Reads check IndexedDB first, then fall back to AsyncStorage (localStorage)
 *   so existing users' evidence remains decryptable indefinitely.
 *   Old localStorage keys are never touched (no migration, no data loss).
 */

const KEY_STORE_PREFIX = 'dhara_evidence_aes_key_v1_';
const isWeb = Platform.OS === 'web';

// ── IndexedDB helpers (web only) ──────────────────────────────────────────────
const IDB_DB_NAME    = 'dhara_evidence_v2';
const IDB_STORE_NAME = 'keys';

function _idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = (e: IDBVersionChangeEvent) => {
      (e.target as IDBOpenDBRequest).result.createObjectStore(IDB_STORE_NAME);
    };
    req.onsuccess = (e: Event) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror  = (e: Event) => reject((e.target as IDBOpenDBRequest).error);
  });
}

async function idbGet(key: string): Promise<string | null> {
  try {
    const db = await _idbOpen();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(IDB_STORE_NAME, 'readonly');
      const store = tx.objectStore(IDB_STORE_NAME);
      const req   = store.get(key);
      req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
      req.onerror  = () => reject(req.error);
    });
  } catch {
    return null; // graceful degradation — falls through to localStorage below
  }
}

async function idbSet(key: string, value: string): Promise<void> {
  const db = await _idbOpen();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(IDB_STORE_NAME, 'readwrite');
    const store = tx.objectStore(IDB_STORE_NAME);
    const req   = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror  = () => reject(req.error);
  });
}

// ── Unified storage read/write ────────────────────────────────────────────────

async function storeGet(key: string): Promise<string | null> {
  if (!isWeb) return SecureStore.getItemAsync(key);
  // B1-web-idb: check IndexedDB (new-key store) first.
  // Fall back to AsyncStorage (localStorage) so existing users' keys are
  // still readable without any migration or data loss.
  const idbVal = await idbGet(key);
  if (idbVal !== null) return idbVal;
  return AsyncStorage.getItem(key); // legacy localStorage fallback
}

async function storeSet(key: string, value: string): Promise<void> {
  if (!isWeb) { await SecureStore.setItemAsync(key, value); return; }
  // B1-web-idb: all new key writes go to IndexedDB only.
  // Never writes to localStorage — old keys in localStorage are undisturbed.
  await idbSet(key, value);
}

function toHex(bytes: Uint8Array): string { return aesjs.utils.hex.fromBytes(bytes); }
function fromHex(hex: string): Uint8Array { return aesjs.utils.hex.toBytes(hex); }

/** Returns this scope's AES-256 key, generating + persisting one on first use. */
export async function getOrCreateKey(scope: string): Promise<Uint8Array> {
  const storageKey = `${KEY_STORE_PREFIX}${scope}`;
  const existing = await storeGet(storageKey).catch(() => null);
  if (existing) return fromHex(existing);
  const bytes = await Crypto.getRandomBytesAsync(32); // AES-256
  await storeSet(storageKey, toHex(bytes));
  return bytes;
}

export type EncryptResult = { cipherBytes: Uint8Array; iv: string };

/** Encrypts raw bytes with a fresh random IV. The IV is not secret — it is
 * stored alongside the ciphertext's metadata to decrypt later. */
export async function encryptBytes(plainBytes: Uint8Array, key: Uint8Array): Promise<EncryptResult> {
  const ivBytes = await Crypto.getRandomBytesAsync(16);
  const cipher = new aesjs.ModeOfOperation.ctr(key, new aesjs.Counter(ivBytes));
  return { cipherBytes: cipher.encrypt(plainBytes), iv: toHex(ivBytes) };
}

export function decryptBytes(cipherBytes: Uint8Array, key: Uint8Array, ivHex: string): Uint8Array {
  const decipher = new aesjs.ModeOfOperation.ctr(key, new aesjs.Counter(fromHex(ivHex)));
  return decipher.decrypt(cipherBytes);
}
