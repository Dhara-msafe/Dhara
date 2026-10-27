import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

// DHARA: local PIN lock for the Evidence Locker — so photos/videos/recordings
// can't be viewed by anyone who just picks up the phone, even with no network.
// The hash is device-keychain-backed (SecureStore) on native. SecureStore has
// NO web implementation at all (its web build exports an empty object), so
// every call there would throw "is not a function" — fall back to AsyncStorage
// on web instead of crashing the whole screen.
const PIN_HASH_KEY = 'dhara_evidence_pin_hash';
const PIN_SALT_KEY = 'dhara_evidence_pin_salt';
const PIN_ATTEMPTS_KEY = 'dhara_evidence_pin_attempts';
const PIN_LOCKOUT_KEY = 'dhara_evidence_pin_lockout_until';
const isWeb = Platform.OS === 'web';

// T09 assessment (2026-10-26 remediation): after MAX_ATTEMPTS_BEFORE_LOCKOUT
// consecutive wrong PINs, lock further attempts out for BASE_LOCKOUT_MS,
// doubling on each additional cycle of wrong attempts (simple exponential
// backoff) — makes brute-forcing a 4-digit PIN on an unlocked device
// impractical instead of instantaneous.
const MAX_ATTEMPTS_BEFORE_LOCKOUT = 5;
const BASE_LOCKOUT_MS = 30_000; // 30s, then 60s, 120s, ...

async function store_get(key: string): Promise<string | null> {
  return isWeb ? AsyncStorage.getItem(key) : SecureStore.getItemAsync(key);
}
async function store_set(key: string, value: string): Promise<void> {
  if (isWeb) { await AsyncStorage.setItem(key, value); return; }
  await SecureStore.setItemAsync(key, value);
}
async function store_delete(key: string): Promise<void> {
  if (isWeb) { await AsyncStorage.removeItem(key); return; }
  await SecureStore.deleteItemAsync(key);
}

async function randomSalt(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(16);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Current, salted hash. Each device generates its own random salt
 * (setPin()/the migration path in verifyPin() below), so a leaked hash
 * can no longer be checked against one offline rainbow table shared
 * across every DHARA install. */
async function hashPin(pin: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `dhara-evidence-lock:${salt}:${pin}`);
}

/** Pre-2026-10-26 installs hashed the PIN with no salt at all. Kept ONLY
 * so an existing PIN still unlocks after this update — verifyPin() below
 * silently upgrades to a salted hash on the next successful unlock; this
 * legacy function is never used to WRITE a new hash. */
async function legacyUnsaltedHashPin(pin: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `dhara-evidence-lock:${pin}`);
}

export async function hasPin(): Promise<boolean> {
  try { return !!(await store_get(PIN_HASH_KEY)); } catch { return false; }
}

export async function setPin(pin: string): Promise<void> {
  const salt = await randomSalt();
  await store_set(PIN_SALT_KEY, salt);
  await store_set(PIN_HASH_KEY, await hashPin(pin, salt));
  await store_delete(PIN_ATTEMPTS_KEY).catch(() => {});
  await store_delete(PIN_LOCKOUT_KEY).catch(() => {});
}

export type PinCheckResult =
  | { ok: true }
  | { ok: false; reason: 'incorrect'; attemptsRemaining: number }
  | { ok: false; reason: 'locked_out'; retryAfterMs: number };

/** Milliseconds remaining in an active lockout, or 0 if none. Exposed so the
 * PIN screen can show a live countdown without duplicating the storage key. */
export async function getLockoutRemainingMs(): Promise<number> {
  try {
    const raw = await store_get(PIN_LOCKOUT_KEY);
    if (!raw) return 0;
    const remaining = parseInt(raw, 10) - Date.now();
    return remaining > 0 ? remaining : 0;
  } catch { return 0; }
}

export async function verifyPin(pin: string): Promise<PinCheckResult> {
  const lockoutRemaining = await getLockoutRemainingMs();
  if (lockoutRemaining > 0) {
    return { ok: false, reason: 'locked_out', retryAfterMs: lockoutRemaining };
  }

  const storedHash = await store_get(PIN_HASH_KEY).catch(() => null);
  if (!storedHash) {
    // No PIN set yet — treat as a simple mismatch rather than throwing;
    // the screen only calls verifyPin() once hasPin() is already true.
    return { ok: false, reason: 'incorrect', attemptsRemaining: MAX_ATTEMPTS_BEFORE_LOCKOUT };
  }

  const salt = await store_get(PIN_SALT_KEY).catch(() => null);
  const matches = salt
    ? storedHash === (await hashPin(pin, salt))
    : storedHash === (await legacyUnsaltedHashPin(pin));

  if (matches) {
    await store_delete(PIN_ATTEMPTS_KEY).catch(() => {});
    await store_delete(PIN_LOCKOUT_KEY).catch(() => {});
    // Silent migration: upgrade a legacy unsalted hash to a freshly salted
    // one, now that we know the PIN is correct. Never touches the
    // independent AES-256 file-encryption key (evidenceCrypto.ts) or any
    // saved recording — purely an internal PIN-hash storage upgrade,
    // invisible to the user, with zero risk to existing evidence.
    if (!salt) {
      const newSalt = await randomSalt();
      await store_set(PIN_SALT_KEY, newSalt);
      await store_set(PIN_HASH_KEY, await hashPin(pin, newSalt));
    }
    return { ok: true };
  }

  const prevAttempts = parseInt((await store_get(PIN_ATTEMPTS_KEY).catch(() => null)) || '0', 10) || 0;
  const attempts = prevAttempts + 1;
  await store_set(PIN_ATTEMPTS_KEY, String(attempts));
  if (attempts >= MAX_ATTEMPTS_BEFORE_LOCKOUT) {
    const cycles = Math.floor(attempts / MAX_ATTEMPTS_BEFORE_LOCKOUT);
    const lockoutMs = BASE_LOCKOUT_MS * Math.pow(2, cycles - 1);
    await store_set(PIN_LOCKOUT_KEY, String(Date.now() + lockoutMs));
    return { ok: false, reason: 'locked_out', retryAfterMs: lockoutMs };
  }
  return { ok: false, reason: 'incorrect', attemptsRemaining: MAX_ATTEMPTS_BEFORE_LOCKOUT - attempts };
}

export async function clearPin(): Promise<void> {
  await store_delete(PIN_HASH_KEY);
  await store_delete(PIN_SALT_KEY);
  await store_delete(PIN_ATTEMPTS_KEY);
  await store_delete(PIN_LOCKOUT_KEY);
}
