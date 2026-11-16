import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { getActiveUserIdSync, whenAuthHydrated } from '../auth';

// DHARA: local PIN lock for the Evidence Locker — so photos/videos/recordings
// can't be viewed by anyone who just picks up the phone, even with no network.
// The hash is device-keychain-backed (SecureStore) on native. SecureStore has
// NO web implementation at all (its web build exports an empty object), so
// every call there would throw "is not a function" — fall back to AsyncStorage
// on web instead of crashing the whole screen.
//
// B-89 / D-09 — ACCOUNT ISOLATION (16-17 Nov):
//   D-09's team recommendation (confirming "per account" for everything a
//   shared phone stores) explicitly calls out the Evidence Locker PIN by
//   name as something to confirm is per-account, the same way
//   codePhraseStore.ts's SOS/hide phrases already are. Before this fix the
//   PIN hash, salt, attempt counter and lockout timer all lived under one
//   flat, unnamespaced key shared by every account on the device: Account
//   A's PIN unlocked Account B's evidence too, and a lockout triggered by
//   one account's wrong attempts locked out every other account as well.
//
//   Same convention as codePhraseStore.ts: every key is namespaced by
//   getActiveUserIdSync(), a missing identity FAILS CLOSED (no read, no
//   write, hasPin() reports false), and the old flat-key data is moved
//   ONCE into a quarantine key that nothing here ever reads again --
//   never silently inherited by whichever account happens to ask first.
const PIN_HASH_BASE      = 'dhara_evidence_pin_hash_v2';
const PIN_SALT_BASE      = 'dhara_evidence_pin_salt_v2';
const PIN_ATTEMPTS_BASE  = 'dhara_evidence_pin_attempts_v2';
const PIN_LOCKOUT_BASE   = 'dhara_evidence_pin_lockout_until_v2';

// Pre-account-scoping (pre-17 Nov) flat keys -- read only by the one-time
// quarantine below, never by hasPin()/verifyPin()/etc.
const OLD_PIN_HASH_KEY     = 'dhara_evidence_pin_hash';
const OLD_PIN_SALT_KEY     = 'dhara_evidence_pin_salt';
const OLD_PIN_ATTEMPTS_KEY = 'dhara_evidence_pin_attempts';
const OLD_PIN_LOCKOUT_KEY  = 'dhara_evidence_pin_lockout_until';
const MARKER_KEY      = `${PIN_HASH_BASE}_legacy_quarantined_v1`;
const QUARANTINE_HASH_KEY = `${PIN_HASH_BASE}_legacy_unclaimed_v1`;
const QUARANTINE_SALT_KEY = `${PIN_SALT_BASE}_legacy_unclaimed_v1`;

const isWeb = Platform.OS === 'web';

// T09 assessment (2026-10-26 remediation): after MAX_ATTEMPTS_BEFORE_LOCKOUT
// consecutive wrong PINs, lock further attempts out for BASE_LOCKOUT_MS,
// doubling on each additional cycle of wrong attempts (simple exponential
// backoff) — makes brute-forcing a 4-digit PIN on an unlocked device
// impractical instead of instantaneous. (Now scoped per account -- see
// above -- so one account's wrong attempts never lock out another.)
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

/** Resolves the active account's key prefix, or null if nobody is signed
 * in -- callers fail closed on null (no read, no write), same semantics as
 * codePhraseStore.ts's SOS phrase. */
async function _scopedKeysOrNull(): Promise<{ hash: string; salt: string; attempts: string; lockout: string } | null> {
  await whenAuthHydrated();
  const uid = getActiveUserIdSync();
  if (!uid) return null;
  return {
    hash: `${PIN_HASH_BASE}_${uid}`,
    salt: `${PIN_SALT_BASE}_${uid}`,
    attempts: `${PIN_ATTEMPTS_BASE}_${uid}`,
    lockout: `${PIN_LOCKOUT_BASE}_${uid}`,
  };
}

/** One-time, ownership-agnostic quarantine of the pre-account-scoping flat
 * PIN hash/salt. Safe to call repeatedly/concurrently/after an interrupted
 * run -- every step is itself idempotent, and the marker is only set once
 * everything else succeeded. Does NOT migrate the old PIN into any
 * account's new per-account key: whichever account used to share that PIN
 * must set a fresh one. Attempts/lockout counters are simply dropped (they
 * are transient by nature, not data worth preserving). */
async function _quarantineLegacyOnce(): Promise<void> {
  try {
    if (await store_get(MARKER_KEY)) return;

    const legacyHash = await store_get(OLD_PIN_HASH_KEY).catch(() => null);
    const legacySalt = await store_get(OLD_PIN_SALT_KEY).catch(() => null);

    if (legacyHash) {
      await store_set(QUARANTINE_HASH_KEY, legacyHash);
      if (legacySalt) await store_set(QUARANTINE_SALT_KEY, legacySalt);
    }

    await store_delete(OLD_PIN_HASH_KEY).catch(() => {});
    await store_delete(OLD_PIN_SALT_KEY).catch(() => {});
    await store_delete(OLD_PIN_ATTEMPTS_KEY).catch(() => {});
    await store_delete(OLD_PIN_LOCKOUT_KEY).catch(() => {});

    await store_set(MARKER_KEY, '1');
  } catch {
    // Best-effort — if this fails, hasPin()/verifyPin() simply won't see
    // any pre-existing PIN under the new per-account keys (fail closed,
    // same as "no PIN set yet"), never a crash.
  }
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

export async function hasPin(): Promise<boolean> {
  await _quarantineLegacyOnce();
  const keys = await _scopedKeysOrNull();
  if (!keys) return false;
  try { return !!(await store_get(keys.hash)); } catch { return false; }
}

export async function setPin(pin: string): Promise<void> {
  await _quarantineLegacyOnce();
  const keys = await _scopedKeysOrNull();
  if (!keys) return; // fail closed -- no signed-in account to scope the PIN to
  const salt = await randomSalt();
  await store_set(keys.salt, salt);
  await store_set(keys.hash, await hashPin(pin, salt));
  await store_delete(keys.attempts).catch(() => {});
  await store_delete(keys.lockout).catch(() => {});
}

export type PinCheckResult =
  | { ok: true }
  | { ok: false; reason: 'incorrect'; attemptsRemaining: number }
  | { ok: false; reason: 'locked_out'; retryAfterMs: number };

/** Milliseconds remaining in an active lockout, or 0 if none. Exposed so the
 * PIN screen can show a live countdown without duplicating the storage key. */
export async function getLockoutRemainingMs(): Promise<number> {
  const keys = await _scopedKeysOrNull();
  if (!keys) return 0;
  try {
    const raw = await store_get(keys.lockout);
    if (!raw) return 0;
    const remaining = parseInt(raw, 10) - Date.now();
    return remaining > 0 ? remaining : 0;
  } catch { return 0; }
}

export async function verifyPin(pin: string): Promise<PinCheckResult> {
  const keys = await _scopedKeysOrNull();
  if (!keys) {
    // No signed-in account to check against -- treat as a simple mismatch
    // rather than throwing; the screen only calls verifyPin() once
    // hasPin() is already true (which itself requires a signed-in account).
    return { ok: false, reason: 'incorrect', attemptsRemaining: MAX_ATTEMPTS_BEFORE_LOCKOUT };
  }

  const lockoutRemaining = await getLockoutRemainingMs();
  if (lockoutRemaining > 0) {
    return { ok: false, reason: 'locked_out', retryAfterMs: lockoutRemaining };
  }

  const storedHash = await store_get(keys.hash).catch(() => null);
  if (!storedHash) {
    return { ok: false, reason: 'incorrect', attemptsRemaining: MAX_ATTEMPTS_BEFORE_LOCKOUT };
  }

  const salt = await store_get(keys.salt).catch(() => null);
  if (!salt) {
    // Per-account keys are always written with a salt by setPin() above;
    // a hash with no salt under the new key shape should not occur, but
    // fail safely rather than guessing at a legacy unsalted comparison.
    return { ok: false, reason: 'incorrect', attemptsRemaining: MAX_ATTEMPTS_BEFORE_LOCKOUT };
  }
  const matches = storedHash === (await hashPin(pin, salt));

  if (matches) {
    await store_delete(keys.attempts).catch(() => {});
    await store_delete(keys.lockout).catch(() => {});
    return { ok: true };
  }

  const prevAttempts = parseInt((await store_get(keys.attempts).catch(() => null)) || '0', 10) || 0;
  const attempts = prevAttempts + 1;
  await store_set(keys.attempts, String(attempts));
  if (attempts >= MAX_ATTEMPTS_BEFORE_LOCKOUT) {
    const cycles = Math.floor(attempts / MAX_ATTEMPTS_BEFORE_LOCKOUT);
    const lockoutMs = BASE_LOCKOUT_MS * Math.pow(2, cycles - 1);
    await store_set(keys.lockout, String(Date.now() + lockoutMs));
    return { ok: false, reason: 'locked_out', retryAfterMs: lockoutMs };
  }
  return { ok: false, reason: 'incorrect', attemptsRemaining: MAX_ATTEMPTS_BEFORE_LOCKOUT - attempts };
}

export async function clearPin(): Promise<void> {
  const keys = await _scopedKeysOrNull();
  if (!keys) return;
  await store_delete(keys.hash);
  await store_delete(keys.salt);
  await store_delete(keys.attempts);
  await store_delete(keys.lockout);
}

// ── Phase 0.5 B5: changing or clearing the PIN requires the current PIN ──────

/** Change the PIN from `currentPin` to `newPin`.
 *  Returns the same PinCheckResult shape as verifyPin() so the caller can
 *  display incorrect / locked-out feedback using exactly the same logic as
 *  the existing unlock gate. */
export async function changePin(
  currentPin: string,
  newPin: string,
): Promise<PinCheckResult> {
  const check = await verifyPin(currentPin);
  if (!check.ok) return check;
  await setPin(newPin);
  return { ok: true };
}

/** Remove the PIN entirely after verifying the current one.
 *  On success the locker will prompt the user to create a new PIN on the
 *  next visit (hasPin() === false). */
export async function clearPinAuthenticated(
  currentPin: string,
): Promise<PinCheckResult> {
  const check = await verifyPin(currentPin);
  if (!check.ok) return check;
  await clearPin();
  return { ok: true };
}
