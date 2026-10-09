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
 * "device" for guests) and persisted in SecureStore (native) /
 * AsyncStorage (web — SecureStore has no web implementation, same fallback
 * pattern already used by evidenceLock.ts).
 */

const KEY_STORE_PREFIX = 'dhara_evidence_aes_key_v1_';
const isWeb = Platform.OS === 'web';

async function storeGet(key: string): Promise<string | null> {
  return isWeb ? AsyncStorage.getItem(key) : SecureStore.getItemAsync(key);
}
async function storeSet(key: string, value: string): Promise<void> {
  if (isWeb) { await AsyncStorage.setItem(key, value); return; }
  await SecureStore.setItemAsync(key, value);
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
