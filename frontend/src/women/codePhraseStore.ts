/**
 * codePhraseStore.ts — Item B
 *
 * Secure on-device storage for the SOS code phrase AND the D1-V hide phrase.
 * Uses expo-secure-store (OS-protected Keychain / Keystore) so phrases are
 * never accessible to other apps, backup tools, or adb pulls.
 *
 * NOTE: We describe storage as "OS-protected" (Keychain on iOS, Keystore on
 * Android). We do not make specific cryptographic algorithm claims beyond what
 * expo-secure-store documents.
 *
 * PRIVACY CONTRACT:
 *   — Phrases are NEVER logged, sent to analytics, or transmitted off-device.
 *   — Only isCodePhraseMatch() in codePhraseMatcher consumes the raw SOS value.
 *   — The D1-V intercept in index.tsx consumes the raw hide value locally.
 *   — Everything else works with booleans (isPhraseArmed / isHidePhraseArmed).
 *
 * ACCOUNT ISOLATION:
 *   All keys are namespaced by getActiveUserIdSync(). A missing identity FAILS
 *   CLOSED (no read, no write) for the SOS phrase.  For the hide phrase,
 *   authenticated users use SecureStore; guest / unauthenticated sessions use a
 *   module-level in-memory variable — never written to disk, never under a
 *   fallback "_device" key, and reset automatically when the active account
 *   changes (including logout).
 *
 * BIDIRECTIONAL CONFLICT GUARD:
 *   setHidePhrase() reads the persisted SOS phrase via getStoredPhrase() and
 *   rejects (conflict: true) if the incoming phrase matches after normalisation.
 *   The reverse guard (SOS input vs persisted hide) is applied in code-phrase.tsx
 *   before calling storePhrase(). Both directions use the same normalizePhrase()
 *   and phrasesConflict() from codePhraseHelpers.ts so they can never disagree.
 *
 * WEB LIMITATION:
 *   expo-secure-store has no web implementation. All SecureStore calls are
 *   wrapped so the code fails SOFT on web (silently does not persist) instead
 *   of throwing uncaught rejections. The UI shows a capability notice on web.
 *
 * LEGACY DATA (pre-fix):
 *   OLD_ASYNC_KEY (AsyncStorage, pre-dates SecureStore) and the flat
 *   SecureStore key (pre-dates account-scoping) may exist. Neither is ever
 *   copied into any account's live key; _quarantineLegacyOnce() moves them
 *   once into a private quarantine key that no get/isArmed function ever reads.
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { appendAuditEntry } from './privacyAuditLog';
import { getActiveUserIdSync, whenAuthHydrated } from '../auth';
import { normalizePhrase, phrasesConflict } from './codePhraseHelpers';

// Re-export pure helpers so consumers (index.tsx D1-V intercept, code-phrase.tsx
// SOS-save guard) can use the same normalisation without a separate import path.
export { normalizePhrase, phrasesConflict };

// ── SOS phrase storage keys ────────────────────────────────────────────────────
const SECURE_KEY_BASE = 'ws_code_phrase_v2';
const OLD_ASYNC_KEY   = 'ws_code_phrase';                               // legacy AsyncStorage key (pre-SecureStore)
const MARKER_KEY      = `${SECURE_KEY_BASE}_legacy_quarantined_v1`;     // SecureStore — "have we quarantined yet?"
const QUARANTINE_KEY  = `${SECURE_KEY_BASE}_legacy_unclaimed_v1`;       // SecureStore — never read by get*()/isPhraseArmed()

// ── Hide-phrase storage key builder (SecureStore, auth users only) ─────────────
const HIDE_SECURE_KEY = (uid: string) => `ws_hide_screen_v2_${uid}`;

// ── Hide-phrase in-memory state (guest / unauthenticated sessions only) ────────
// Never written to disk. Reset automatically when the active account changes
// (detected by comparing getActiveUserIdSync() against the last known UID).
let _guestHidePhrase: string = '';
let _lastKnownUid: string | null | undefined = undefined; // undefined = not yet initialised

/** Wipe in-memory guest state when the active account changes (includes logout). */
async function _resetGuestStateIfNeeded(): Promise<void> {
  await whenAuthHydrated();
  const uid = getActiveUserIdSync();
  if (uid !== _lastKnownUid) {
    _guestHidePhrase = '';
    _lastKnownUid = uid;
  }
}

// ── SOS phrase helpers ─────────────────────────────────────────────────────────

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
  // expo-secure-store has no web implementation — return '' early so we never
  // waste multiple failed SecureStore calls on web.
  if (Platform.OS === 'web') return '';
  await _quarantineLegacyOnce();
  try {
    const key = await _scopedKeyOrNull();
    if (!key) return '';   // fail closed — no signed-in identity
    return (await SecureStore.getItemAsync(key)) ?? '';
  } catch {
    return '';
  }
}

// ── StorePhraseResult ─────────────────────────────────────────────────────────

/**
 * Explicit result type returned by storePhrase().
 *
 *  saved                — phrase written AND immediately read back from the
 *                         secure store; normalised readback matches the input.
 *  unsupported_platform — SecureStore has no web implementation; the phrase
 *                         was NOT persisted; the UI must NOT show ARMED.
 *  no_identity          — No signed-in user and no device key: saving fails
 *                         closed. The UI must NOT show ARMED.
 *  storage_failure      — SecureStore threw an unexpected error.
 *  verification_failure — Wrote successfully but the immediate readback did
 *                         not match the normalised input; indicates a corrupt
 *                         or race-condition write. The UI must NOT show ARMED.
 */
export type StorePhraseResult =
  | { outcome: 'saved'; stored: string }
  | { outcome: 'unsupported_platform' }
  | { outcome: 'no_identity' }
  | { outcome: 'storage_failure' }
  | { outcome: 'verification_failure' };

export async function storePhrase(phrase: string): Promise<StorePhraseResult> {
  // expo-secure-store has NO web implementation.  Return an explicit result so
  // the UI can show a capability notice instead of silently showing ARMED.
  if (Platform.OS === 'web') {
    return { outcome: 'unsupported_platform' };
  }

  const trimmed = phrase.trim();
  const key = await _scopedKeyOrNull();

  if (!key) {
    // Clearing with no identity is a no-op (nothing was stored), treat as success.
    if (!trimmed) return { outcome: 'saved', stored: '' };
    // Saving without an identity fails closed.
    return { outcome: 'no_identity' };
  }

  try {
    if (!trimmed) {
      // ── Clearing ───────────────────────────────────────────────────────────
      await SecureStore.deleteItemAsync(key);
      await appendAuditEntry('CODE_PHRASE_CLEARED');
      await appendAuditEntry('CODE_PHRASE_DISARMED');
      return { outcome: 'saved', stored: '' };
    }

    // ── Saving ───────────────────────────────────────────────────────────────
    // Distinguish first-time config from update (for audit log granularity).
    let isFirst = false;
    try {
      const existing = await SecureStore.getItemAsync(key);
      isFirst = !existing || !existing.trim();
    } catch { isFirst = false; }

    await SecureStore.setItemAsync(key, trimmed);

    // Immediate read-back verification: the phrase is only considered saved —
    // and the UI may only show ARMED — when the readback matches the input
    // after normalisation.  This catches write failures that do not throw
    // (e.g. Keychain quota exceeded on some iOS versions).
    const readBack = await SecureStore.getItemAsync(key);
    if (!readBack || normalizePhrase(readBack) !== normalizePhrase(trimmed)) {
      return { outcome: 'verification_failure' };
    }

    await appendAuditEntry(isFirst ? 'CODE_PHRASE_CONFIGURED' : 'CODE_PHRASE_CHANGED');
    await appendAuditEntry('CODE_PHRASE_ARMED');
    return { outcome: 'saved', stored: trimmed };
  } catch {
    return { outcome: 'storage_failure' };
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

// ── Hide-phrase API (D1-V) ─────────────────────────────────────────────────────

export type SaveHideResult = {
  saved: boolean;
  conflict: boolean;
  storageError: boolean;
  armed?: boolean;
};

/**
 * Returns the stored hide phrase for the current account, or '' if none.
 *   — Authenticated user  : SecureStore (ws_hide_screen_v2_<uid>)
 *   — Guest / no identity : in-memory only (no disk write, no "_device" key)
 *   — Web                 : always '' (capability notice shown by UI)
 */
export async function getHidePhrase(): Promise<string> {
  if (Platform.OS === 'web') return '';
  await _resetGuestStateIfNeeded();
  const uid = getActiveUserIdSync();
  if (!uid) return _guestHidePhrase;
  try {
    return (await SecureStore.getItemAsync(HIDE_SECURE_KEY(uid))) ?? '';
  } catch {
    return '';
  }
}

/**
 * Persist the hide phrase for the current account.
 *
 * Enforces a bidirectional conflict guard: if the incoming phrase matches the
 * PERSISTED SOS phrase (via getStoredPhrase()), returns { conflict: true } and
 * does NOT write anything.  The reverse guard (SOS input vs persisted hide) is
 * applied by code-phrase.tsx before calling storePhrase().
 *
 * Guest users: stored in-memory only — never written to disk.
 * Web: no-op (capability notice shown by UI).
 */
export async function setHidePhrase(phrase: string): Promise<SaveHideResult> {
  const trimmed = phrase.trim();
  if (Platform.OS === 'web') {
    return { saved: false, conflict: false, storageError: false };
  }
  // Bidirectional guard — compare against the PERSISTED SOS phrase, not just
  // whatever is currently held in React state on the config screen.
  const persistedSOS = await getStoredPhrase();
  if (phrasesConflict(trimmed, persistedSOS)) {
    return { saved: false, conflict: true, storageError: false };
  }
  await _resetGuestStateIfNeeded();
  const uid = getActiveUserIdSync();
  if (!uid) {
    // Guest: in-memory only, never touches disk.
    _guestHidePhrase = trimmed;
    return { saved: true, conflict: false, storageError: false, armed: trimmed.length > 0 };
  }
  try {
    const key = HIDE_SECURE_KEY(uid);
    if (trimmed) {
      await SecureStore.setItemAsync(key, trimmed);
    } else {
      await SecureStore.deleteItemAsync(key).catch(() => {});
    }
    return { saved: true, conflict: false, storageError: false, armed: trimmed.length > 0 };
  } catch {
    return { saved: false, conflict: false, storageError: true };
  }
}

/**
 * Remove the stored hide phrase for the current account.
 *
 * NOTE: This does NOT clear the AsyncStorage discreet-active flag
 * (ws_discreet_active_v1_<scope>). code-phrase.tsx owns that cleanup so the
 * privacy cover lifts correctly without a circular dependency here.
 */
export async function clearHidePhrase(): Promise<{ cleared: boolean; storageError: boolean }> {
  if (Platform.OS === 'web') return { cleared: true, storageError: false };
  await _resetGuestStateIfNeeded();
  const uid = getActiveUserIdSync();
  if (!uid) {
    _guestHidePhrase = '';
    return { cleared: true, storageError: false };
  }
  try {
    await SecureStore.deleteItemAsync(HIDE_SECURE_KEY(uid)).catch(() => {});
    return { cleared: true, storageError: false };
  } catch {
    return { cleared: false, storageError: true };
  }
}

/** True when a hide phrase is configured for the current account. */
export async function isHidePhraseArmed(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  await _resetGuestStateIfNeeded();
  const uid = getActiveUserIdSync();
  if (!uid) return _guestHidePhrase.trim().length > 0;
  try {
    const v = await SecureStore.getItemAsync(HIDE_SECURE_KEY(uid));
    return !!(v && v.trim().length > 0);
  } catch {
    return false;
  }
}
