// B-25 (14 Nov 2026): "login token unencrypted on phone."
//
// Before this fix, src/auth.tsx wrote the sign-in JWT with a plain
// `AsyncStorage.setItem(TOKEN_KEY, t)` call. AsyncStorage's native backing
// store is an unencrypted file (SQLite on Android, a plist-backed store on
// iOS) inside the app's own sandbox -- readable by anything with filesystem
// access to that sandbox (a rooted/jailbroken device, a local backup
// extraction tool, a misconfigured content provider on another app). The
// repo already had a `storage` helper (src/utils/storage) built exactly for
// this -- secureGet/secureSet/secureRemove, backed by the iOS Keychain /
// Android EncryptedSharedPreferences via expo-secure-store on native, falling
// back to AsyncStorage only on web (which has no OS keychain to use) -- but
// auth.tsx wasn't using it for the token.
//
// Fixed: every read/write/remove of the token in auth.tsx now goes through
// storage.secureGet/secureSet/secureRemove, with a one-time migration path so
// an app already installed on someone's phone doesn't get silently signed
// out the moment this ships (the old plaintext value is read once, moved
// into the secure store, and the plaintext copy is deleted) rather than
// forcing everyone to sign in again.
//
// This is a source-level wiring check (auth.tsx can't be executed directly
// here -- it's a React Native module with Platform/AsyncStorage/expo-*
// imports), the same style used elsewhere in this test suite for RN wiring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const authSrc = readFileSync(path.join(__dirname, '..', 'auth.tsx'), 'utf8');

test('B-25: auth.tsx imports the secure storage helper', () => {
  assert.match(authSrc, /import\s*\{\s*storage\s*\}\s*from\s*['"]@\/src\/utils\/storage['"]/);
});

test('B-25: the token is WRITTEN with storage.secureSet, not AsyncStorage.setItem', () => {
  assert.match(authSrc, /storage\.secureSet\(TOKEN_KEY,\s*t\)/);
  // The only AsyncStorage.setItem(TOKEN_KEY, ...) call allowed is none at all --
  // the plaintext path must not still exist alongside the secure one.
  assert.doesNotMatch(authSrc, /AsyncStorage\.setItem\(TOKEN_KEY/);
});

test('B-25: the token is READ with storage.secureGet on startup, with a one-time legacy migration', () => {
  assert.match(authSrc, /storage\.secureGet[^(]*\(TOKEN_KEY,\s*null\)/);
  // Migration: an old plaintext value (if present) is picked up once, written
  // into the secure store, and the plaintext copy is removed -- not silently
  // dropped (which would force every existing install to sign in again) and
  // not left in place either (which would leave the plaintext copy readable
  // forever even after the "fix" ships).
  assert.match(authSrc, /legacyT/);
  assert.match(authSrc, /storage\.secureSet\(TOKEN_KEY,\s*legacyT\)/);
  assert.match(authSrc, /AsyncStorage\.removeItem\(TOKEN_KEY\)/);
});

test('B-25: the token is REMOVED with storage.secureRemove on logout', () => {
  assert.match(authSrc, /storage\.secureRemove\(TOKEN_KEY\)/);
  // multiRemove must no longer include the token key -- that was the plain
  // AsyncStorage removal path this fix replaces.
  const multiRemoveMatch = authSrc.match(/AsyncStorage\.multiRemove\(\[([\s\S]*?)\]\)/);
  assert.ok(multiRemoveMatch, 'expected an AsyncStorage.multiRemove([...]) call in the logout path');
  assert.doesNotMatch(multiRemoveMatch[1], /\bTOKEN_KEY\b/);
});

test('B-25: USER_KEY (non-secret profile data) still goes through plain AsyncStorage, unaffected', () => {
  // Only the bearer credential needs Keychain-grade protection; the cached
  // profile object is not a secret and switching it to SecureStore too would
  // just risk hitting SecureStore's size limits for no security benefit.
  assert.match(authSrc, /AsyncStorage\.setItem\(USER_KEY/);
  assert.match(authSrc, /AsyncStorage\.getItem\(USER_KEY\)/);
});
