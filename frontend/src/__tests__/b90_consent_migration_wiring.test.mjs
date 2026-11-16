/**
 * B-90: Consent asked again after guest start and after sign-up.
 *
 * Frontend half of the fix (the backend half -- link_anonymous_consent now
 * setting db.users.terms_version/consent_purposes -- is covered by
 * backend/tests/test_b90_consent_link_sets_user_record.py).
 *
 * Root cause: /consent saves its "consent given" flag to AsyncStorage under
 * a key scoped by consentVersionKey(userId) -- which is a DIFFERENT key for
 * an anonymous visitor (no suffix) than for the account that gets created
 * moments later by guest-start/sign-up/login. ConsentGuard (app/_layout.tsx)
 * checks the key for whatever user.id exists NOW, which was never written,
 * so it redirects straight back to /consent -- asking again for consent
 * just given. The backend-side /api/consent/link call fixes this durably,
 * but it's a network round-trip racing against ConsentGuard's immediate
 * post-login re-check.
 *
 * Fix verified here (source-wiring, matching this repo's .mjs convention for
 * RN modules with no renderer in this plain-Node setup):
 *  - consentStorage.ts exports migrateAnonConsentToUser(), which is pure
 *    on-device AsyncStorage (no network) and copies the anonymous consent
 *    flag onto the new user's own key.
 *  - auth.tsx's persist() calls it BEFORE setUser(u) -- the call that
 *    triggers ConsentGuard's re-check -- so the race can't happen.
 *
 * Run with: node --experimental-strip-types --test src/__tests__/b90_consent_migration_wiring.test.mjs
 * (run from the frontend/ directory)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_TSX = readFileSync(path.join(__dirname, '../auth.tsx'), 'utf8');
const CONSENT_STORAGE_TS = readFileSync(path.join(__dirname, '../consentStorage.ts'), 'utf8');

test('consentStorage.ts exports migrateAnonConsentToUser', () => {
  assert.match(CONSENT_STORAGE_TS, /export async function migrateAnonConsentToUser/);
});

test('migrateAnonConsentToUser copies the anonymous consent flag onto the user-scoped key', () => {
  assert.match(CONSENT_STORAGE_TS, /consentVersionKey\(undefined\)/);
  assert.match(CONSENT_STORAGE_TS, /consentVersionKey\(userId\)/);
  assert.match(CONSENT_STORAGE_TS, /isCurrentConsent\(anonVersion/);
});

test('auth.tsx imports migrateAnonConsentToUser', () => {
  assert.match(AUTH_TSX, /import\s*\{[^}]*migrateAnonConsentToUser[^}]*\}\s*from\s*['"]\.\/consentStorage['"]/);
});

test('auth.tsx persist() calls migrateAnonConsentToUser BEFORE setUser (not after, not only in the fire-and-forget link call)', () => {
  const persistFnMatch = AUTH_TSX.match(/const persist = async[\s\S]*?\n  \};/);
  assert.ok(persistFnMatch, 'could not locate the persist() function body');
  const body = persistFnMatch[0];
  const migrateIdx = body.indexOf('migrateAnonConsentToUser(');
  const setUserIdx = body.indexOf('setUser(u)');
  assert.ok(migrateIdx !== -1, 'persist() must call migrateAnonConsentToUser');
  assert.ok(setUserIdx !== -1, 'persist() must call setUser(u)');
  assert.ok(
    migrateIdx < setUserIdx,
    `migrateAnonConsentToUser (index ${migrateIdx}) must run before setUser (index ${setUserIdx}) ` +
    'so ConsentGuard\'s post-login re-check never races the network-bound /api/consent/link call',
  );
});

test('auth.tsx still fires the durable server-side /api/consent/link call too (belt-and-suspenders)', () => {
  assert.match(AUTH_TSX, /\/api\/consent\/link/);
});
