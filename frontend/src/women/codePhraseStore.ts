/**
 * codePhraseStore.ts — Item B
 *
 * Secure on-device storage for the code phrase.
 * Replaces the old AsyncStorage slot with expo-secure-store (AES-256 /
 * Keychain on iOS, EncryptedSharedPreferences on Android) so the phrase is
 * never accessible to other apps, backup tools, or adb pulls.
 *
 * PRIVACY CONTRACT:
 *   — Phrase is NEVER logged, sent to analytics, or transmitted off-device.
 *   — Only isCodePhraseMatch() in codePhraseMatcher consumes the raw value.
 *   — Everything else works with a boolean (isPhraseArmed).
 */
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { appendAuditEntry } from './privacyAuditLog';

const SECURE_KEY    = 'ws_code_phrase_v2';
const OLD_ASYNC_KEY = 'ws_code_phrase'; // legacy key to migrate away from

/** One-time migration from the old AsyncStorage slot to SecureStore. */
async function migrateIfNeeded(): Promise<void> {
  try {
    const existing = await SecureStore.getItemAsync(SECURE_KEY);
    if (existing !== null) return; // already migrated (even empty string counts)
    const old = await AsyncStorage.getItem(OLD_ASYNC_KEY);
    if (old && old.trim()) {
      await SecureStore.setItemAsync(SECURE_KEY, old.trim());
    }
    // Remove old key regardless so we don't re-check next time
    await AsyncStorage.removeItem(OLD_ASYNC_KEY).catch(() => {});
  } catch {
    // Migration failure is non-fatal; phrase will be re-entered by user.
  }
}

/** Returns the stored phrase (empty string if none set). */
export async function getStoredPhrase(): Promise<string> {
  await migrateIfNeeded();
  try {
    return (await SecureStore.getItemAsync(SECURE_KEY)) ?? '';
  } catch {
    return '';
  }
}

/** Save the phrase securely. Pass empty string to clear. */
export async function storePhrase(phrase: string): Promise<void> {
  const trimmed = phrase.trim();
  if (!trimmed) {
    await SecureStore.deleteItemAsync(SECURE_KEY).catch(() => {});
    await appendAuditEntry('PHRASE_CLEARED');
    return;
  }
  await SecureStore.setItemAsync(SECURE_KEY, trimmed);
  await appendAuditEntry('PHRASE_SAVED');
}

/** Wipe the phrase entirely. */
export async function clearPhrase(): Promise<void> {
  await SecureStore.deleteItemAsync(SECURE_KEY).catch(() => {});
  await appendAuditEntry('PHRASE_CLEARED');
}

/**
 * Returns true when a non-empty phrase is saved.
 * Safe to call in UI — never exposes the phrase itself.
 */
export async function isPhraseArmed(): Promise<boolean> {
  await migrateIfNeeded();
  try {
    const v = await SecureStore.getItemAsync(SECURE_KEY);
    return !!(v && v.trim().length > 0);
  } catch {
    return false;
  }
}
