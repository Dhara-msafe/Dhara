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
 * MIGRATION SAFETY:
 *   1. Write to SecureStore.
 *   2. Read back to verify the write succeeded.
 *   3. Only delete old AsyncStorage value AFTER verified read-back.
 *   4. If any step fails the old value remains in AsyncStorage (recoverable).
 */
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { appendAuditEntry } from './privacyAuditLog';

const SECURE_KEY    = 'ws_code_phrase_v2';
const OLD_ASYNC_KEY = 'ws_code_phrase'; // legacy AsyncStorage key

/** One-time migration with read-back verification. Old phrase stays until confirmed. */
async function migrateIfNeeded(): Promise<void> {
  try {
    const existing = await SecureStore.getItemAsync(SECURE_KEY);
    if (existing !== null) return; // already has a SecureStore value
    const old = await AsyncStorage.getItem(OLD_ASYNC_KEY);
    if (!old || !old.trim()) {
      await AsyncStorage.removeItem(OLD_ASYNC_KEY).catch(() => {});
      return;
    }
    // 1. Write
    await SecureStore.setItemAsync(SECURE_KEY, old.trim());
    // 2. Read-back verification — only delete old value if write is confirmed
    const readBack = await SecureStore.getItemAsync(SECURE_KEY);
    if (readBack !== old.trim()) return; // mismatch → old phrase stays in AsyncStorage
    // 3. Delete old value after verified write
    await AsyncStorage.removeItem(OLD_ASYNC_KEY).catch(() => {});
  } catch {
    // Any failure: old phrase remains in AsyncStorage (recoverable on next launch).
  }
}

export async function getStoredPhrase(): Promise<string> {
  await migrateIfNeeded();
  try {
    return (await SecureStore.getItemAsync(SECURE_KEY)) ?? '';
  } catch {
    return '';
  }
}

export async function storePhrase(phrase: string): Promise<void> {
  const trimmed = phrase.trim();
  if (!trimmed) {
    await SecureStore.deleteItemAsync(SECURE_KEY).catch(() => {});
    await appendAuditEntry('CODE_PHRASE_CLEARED');
    await appendAuditEntry('CODE_PHRASE_DISARMED');
    return;
  }
  // Distinguish first-time config from update
  let isFirst = false;
  try {
    const existing = await SecureStore.getItemAsync(SECURE_KEY);
    isFirst = !existing || !existing.trim();
  } catch { isFirst = false; }
  await SecureStore.setItemAsync(SECURE_KEY, trimmed);
  await appendAuditEntry(isFirst ? 'CODE_PHRASE_CONFIGURED' : 'CODE_PHRASE_CHANGED');
  await appendAuditEntry('CODE_PHRASE_ARMED');
}

export async function clearPhrase(): Promise<void> {
  await SecureStore.deleteItemAsync(SECURE_KEY).catch(() => {});
  await appendAuditEntry('CODE_PHRASE_CLEARED');
  await appendAuditEntry('CODE_PHRASE_DISARMED');
}

export async function isPhraseArmed(): Promise<boolean> {
  await migrateIfNeeded();
  try {
    const v = await SecureStore.getItemAsync(SECURE_KEY);
    return !!(v && v.trim().length > 0);
  } catch {
    return false;
  }
}
