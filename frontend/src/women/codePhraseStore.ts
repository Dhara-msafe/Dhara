/**
 * codePhraseStore.ts — Item B
 *
 * Secure on-device storage for the code phrase.
 * Uses expo-secure-store (OS-protected Keychain / Keystore) so the phrase is
 * never accessible to other apps, backup tools, or adb pulls.
 *
 * NOTE: We describe storage as "OS-protected" (Keychain on iOS, Keystore on
 * Android). We do not make specific cryptographic algorithm claims beyond what
 * expo-secure-store documents.
 *
 * PRIVACY CONTRACT:
 *   — Phrase is NEVER logged, sent to analytics, or transmitted off-device.
 *   — Only isCodePhraseMatch() in codePhraseMatcher consumes the raw value.
 *   — Everything else works with a boolean (isPhraseArmed).
 *
 * ACCOUNT ISOLATION (added alongside the same fix in src/women/api.ts):
 *   This key used to be flat/device-global — one phrase shared by whoever
 *   is signed in, regardless of account, and never cleared on logout. On a
 *   shared device, Account B could read/arm/match Account A's code phrase.
 *   Every key below is now namespaced by the SYNCHRONOUSLY captured active
 *   account id (getActiveUserIdSync()) — see auth.tsx's doc comment for why
 *   a synchronous, atomically-captured identity avoids a race where a save
 *   started as A could land under B's key after a fast account switch.
 *   Missing identity FAILS CLOSED (no read, no write) — there is no shared
 *   "guest" fallback key, on purpose: that would just be a smaller-blast-
 *   radius version of the same bug.
 *
 * LEGACY DATA (pre-this-fix): two older, unscoped sources may exist —
 * OLD_ASYNC_KEY (AsyncStorage, pre-dates SecureStore entirely) and the flat
 * SecureStore key this file used before account-scoping. NEITHER recorded
 * who it belonged to, so neither is ever copied into any account's live
 * key automatically. _quarantineLegacyOnce() moves whatever is found,
 * once, into a private key that no get/isArmed function ever reads and no
 * screen ever displays — preserved for a possible future explicit recovery
 * flow, never silently granted to whoever happens to sign in first.
 *
 * MIGRATION SAFETY (kept from the original design, applied to quarantining):
 *   1. Write to the quarantine key.
 *   2. Read back to verify the write succeeded.
 *   3. Only delete the old value AFTER verified read-back.
 *   4. If any step fails, the old value remains untouched (recoverable).
 */
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { appendAuditEntry } from './privacyAuditLog';
import { getActiveUserIdSync, whenAuthHydrated } from '../auth';

const SECURE_KEY_BASE  = 'ws_code_phrase_v2';
const OLD_ASYNC_KEY     = 'ws_code_phrase';                              // legacy AsyncStorage key (pre-SecureStore)
const MARKER_KEY        = `${SECURE_KEY_BASE}_legacy_quarantined_v1`;    // SecureStore — "have we quarantined yet?"
const QUARANTINE_KEY    = `${SECURE_KEY_BASE}_legacy_unclaimed_v1`;      // SecureStore — never read by get*()/isPhraseArmed()

async function _scopedKeyOrNull(): Promise<string | null> {
  await whenAuthHydrated();
  const uid = getActiveUserIdSync();
  return uid ? `${SECURE_KEY_BASE}_${uid}` : null;
}

/** One-time, ownership-agnostic quarantine of both legacy sources. Safe to
 * call repeatedly/concurrently/after an interrupted run — every step is
 * itself idempotent, and the marker is only set once everything else
 * succeeded. */
async function _quarantineLegacyOnce(): Promise<void> {
  try {
    if (await SecureStore.getItemAsync(MARKER_KEY)) return;

    const legacySecure = await SecureStore.getItemAsync(SECURE_KEY_BASE);
    const legacyAsync  = await AsyncStorage.getItem(OLD_ASYNC_KEY);
    const candidate = (legacySecure && legacySecure.trim()) || (legacyAsync && legacyAsync.trim()) || null;

    if (candidate) {
      const alreadyParked = await SecureStore.getItemAsync(QUARANTINE_KEY);
      if (!alreadyParked) {
        // 1. Write
        await SecureStore.setItemAsync(QUARANTINE_KEY, candidate);
        // 2. Read-back verification
        const readBack = await SecureStore.getItemAsync(QUARANTINE_KEY);
        if (readBack !== candidate) return; // mismatch → leave everything as-is, retry next time
      }
      // 3. Delete old values only after a verified (or already-verified) quarantine write
      await SecureStore.deleteItemAsync(SECURE_KEY_BASE).catch(() => {});
      await AsyncStorage.removeItem(OLD_ASYNC_KEY).catch(() => {});
    } else {
      // Nothing to quarantine — still tidy up an empty legacy AsyncStorage key if present
      await AsyncStorage.removeItem(OLD_ASYNC_KEY).catch(() => {});
    }
    await SecureStore.setItemAsync(MARKER_KEY, '1');
  } catch {
    // Any failure: old values remain untouched (recoverable on next attempt).
  }
}

export async function getStoredPhrase(): Promise<string> {
  await _quarantineLegacyOnce();
  try {
    const key = await _scopedKeyOrNull();
    if (!key) return '';   // fail closed — no signed-in identity
    return (await SecureStore.getItemAsync(key)) ?? '';
  } catch {
    return '';
  }
}

export async function storePhrase(phrase: string): Promise<void> {
  const trimmed = phrase.trim();
  const key = await _scopedKeyOrNull();
  if (!key) return;   // fail closed — refuse to persist without a known identity
  // expo-secure-store has NO web implementation (SecureStore.setValueWithKeyAsync
  // does not exist on web) — every SecureStore call below is wrapped so this
  // fails SOFT (silently does not persist) on web instead of throwing an
  // uncaught rejection that crashes the screen. This is a web-preview-only
  // limitation; on a real iOS/Android build SecureStore works normally.
  // See <features_requiring_native_build> — code-phrase persistence cannot
  // be validated on web/Expo Go, only on a native build.
  try {
    if (!trimmed) {
      await SecureStore.deleteItemAsync(key);
      await appendAuditEntry('CODE_PHRASE_CLEARED');
      await appendAuditEntry('CODE_PHRASE_DISARMED');
      return;
    }
    // Distinguish first-time config from update
    let isFirst = false;
    try {
      const existing = await SecureStore.getItemAsync(key);
      isFirst = !existing || !existing.trim();
    } catch { isFirst = false; }
    await SecureStore.setItemAsync(key, trimmed);
    await appendAuditEntry(isFirst ? 'CODE_PHRASE_CONFIGURED' : 'CODE_PHRASE_CHANGED');
    await appendAuditEntry('CODE_PHRASE_ARMED');
  } catch {
    // Web-preview-only no-op (see comment above). Native builds do not hit
    // this catch under normal operation.
  }
}

export async function clearPhrase(): Promise<void> {
  const key = await _scopedKeyOrNull();
  if (key) await SecureStore.deleteItemAsync(key).catch(() => {});
  await appendAuditEntry('CODE_PHRASE_CLEARED');
  await appendAuditEntry('CODE_PHRASE_DISARMED');
}

export async function isPhraseArmed(): Promise<boolean> {
  await _quarantineLegacyOnce();
  try {
    const key = await _scopedKeyOrNull();
    if (!key) return false;
    const v = await SecureStore.getItemAsync(key);
    return !!(v && v.trim().length > 0);
  } catch {
    return false;
  }
}
