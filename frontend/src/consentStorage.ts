import AsyncStorage from '@react-native-async-storage/async-storage';
import { CONSENT_NOTICE_VERSION } from './consentStrings';

export const CONSENT_VERSION_KEY = 'gk_consent_version';
export const CONSENT_ANON_KEY = 'gk_consent_anon_id';
export const CONSENT_PREFS_KEY = 'gk_consent_prefs';

// A different signed-in account must never inherit another account's acceptance.
export function consentVersionKey(userId?: string) {
  return userId ? `${CONSENT_VERSION_KEY}:${userId}` : CONSENT_VERSION_KEY;
}

export function isCurrentConsent(local: string | null, server?: string) {
  // The legacy server stores a notice date in terms_version. Legal version
  // "2.0" is NOT comparable to a notice date. Compare exact notice versions.
  return local === CONSENT_NOTICE_VERSION || server === CONSENT_NOTICE_VERSION;
}

export async function saveConsentLocally(
  purposes: { core: boolean; analytics: boolean; updates: boolean }, userId?: string,
) {
  const prefsKey = userId ? `${CONSENT_PREFS_KEY}:${userId}` : CONSENT_PREFS_KEY;
  // Write the version last: it is the completion marker read by the guard.
  await AsyncStorage.setItem(prefsKey, JSON.stringify(purposes));
  await AsyncStorage.setItem(consentVersionKey(userId), CONSENT_NOTICE_VERSION);
}

/**
 * B-90: consent is normally given on the /consent screen BEFORE the person
 * has an account, so saveConsentLocally() above writes it under the
 * anonymous (no-suffix) key. The moment guest-start/sign-up/login completes,
 * ConsentGuard (app/_layout.tsx) immediately re-checks consent for the new
 * user.id -- which uses a *different*, per-user AsyncStorage key that was
 * never written -- and re-opens /consent, asking again for consent just
 * given. The backend-side /api/consent/link call (fired in auth.tsx's
 * persist()) fixes this durably, but it's a network round-trip racing
 * against ConsentGuard's synchronous-feeling re-check.
 *
 * This copies the anonymous local consent flag onto the new user's own key
 * immediately (pure on-device AsyncStorage, no network), so that race can
 * never cause a re-ask. It's a no-op if the anonymous flag isn't current
 * (nothing to migrate) or if the user-scoped key is already populated.
 */
export async function migrateAnonConsentToUser(userId: string): Promise<void> {
  if (!userId) return;
  try {
    const anonVersion = await AsyncStorage.getItem(consentVersionKey(undefined));
    if (!isCurrentConsent(anonVersion, undefined)) return;
    const userKey = consentVersionKey(userId);
    const alreadyMigrated = await AsyncStorage.getItem(userKey);
    if (isCurrentConsent(alreadyMigrated, undefined)) return;
    const anonPrefs = await AsyncStorage.getItem(CONSENT_PREFS_KEY);
    if (anonPrefs) await AsyncStorage.setItem(`${CONSENT_PREFS_KEY}:${userId}`, anonPrefs);
    await AsyncStorage.setItem(userKey, CONSENT_NOTICE_VERSION);
  } catch {
    // Best-effort: worst case the guard re-checks via the server-side
    // terms_version (set durably by /api/consent/link) on the next load.
  }
}