/**
 * D-09 / B-17 (17 Nov 2026, owner decision): on a shared phone each account's
 * on-device data is stored separately, and only the signed-in account's data
 * is loaded. Covers the four stores that used to be one shared copy per phone:
 *   - saved answers         (src/bookmarks.ts)
 *   - draft notice history  (src/draftHistory.ts, encrypted per B-93)
 *   - fraud checklist       (app/fraud-checklist.tsx)
 *   - "For you" interests   (src/userProfile.ts)
 *
 * Same pattern as Women's Shield's per-account stores (src/women/api.ts):
 *  - accountKey(base) namespaces the key by the account id captured
 *    synchronously from auth (getActiveUserIdSync), so a write started as
 *    account A can never land under account B. Guest sessions have their own
 *    id, so a guest gets its own space too. Nobody signed in -> null: callers
 *    fail closed (empty read, write skipped), never a shared bucket.
 *  - Data saved before this change has no owner recorded, so it is never
 *    handed to whichever account signs in first. It is moved once into a
 *    private "<base>_legacy_unclaimed_v1" key that no screen reads. (Saved
 *    answers that were already synced come back from the server for their
 *    real owner on the next sync.)
 *  - clearAccountLocalData(uid) removes one account's copies when that
 *    account is deleted.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getActiveUserIdSync, whenAuthHydrated } from './auth';

export const PER_ACCOUNT_STORES = [
  'dhara_bookmarks_v1',
  'dhara_draft_history_v1',
  'dhara_fraud_checklist_v1',
  'dhara_user_interests_v1',
] as const;
export type PerAccountStore = (typeof PER_ACCOUNT_STORES)[number];

const accountKeyFor = (base: PerAccountStore, uid: string) => `${base}_${uid}`;

/** Moves the pre-D-09 shared copy (no owner recorded) out of reach, once. */
export async function quarantineLegacyOnce(base: PerAccountStore): Promise<void> {
  const markerKey = `${base}_legacy_quarantined_v1`;
  const parkedKey = `${base}_legacy_unclaimed_v1`;
  try {
    if (await AsyncStorage.getItem(markerKey)) return;
    const legacy = await AsyncStorage.getItem(base);
    if (legacy != null) {
      if ((await AsyncStorage.getItem(parkedKey)) == null) await AsyncStorage.setItem(parkedKey, legacy);
      await AsyncStorage.removeItem(base);
    }
    await AsyncStorage.setItem(markerKey, '1');
  } catch {
    // Best-effort; every step is idempotent, so the next call simply retries.
  }
}

/** This account's storage key for `base`, or null when nobody is signed in. */
export async function accountKey(base: PerAccountStore): Promise<string | null> {
  await whenAuthHydrated();
  const uid = getActiveUserIdSync();
  await quarantineLegacyOnce(base);
  return uid ? accountKeyFor(base, uid) : null;
}

/** Removes every per-account copy belonging to `uid` (account deletion). */
export async function clearAccountLocalData(uid: string | null | undefined): Promise<void> {
  if (!uid) return;
  try {
    await AsyncStorage.multiRemove(PER_ACCOUNT_STORES.map((b) => accountKeyFor(b, uid)));
  } catch {
    // Best-effort: the server copy is already gone; a leftover local copy is
    // only readable by this (now deleted) account id, which can never sign in.
  }
}
