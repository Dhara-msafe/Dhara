/**
 * B-81: Privacy-choices screen does not show current choices; the PATCH
 * call is never made.
 *
 * Root cause (confirmed by reading backend/dependencies.py and
 * backend/server.py alongside app/consent.tsx):
 *  1. A real `PATCH /api/user/privacy-choices` endpoint already existed on
 *     the backend (backend/server.py), built specifically to let a user flip
 *     their optional analytics/updates consent purposes -- but nothing in
 *     the app ever called it. Settings -> "Withdraw consent" and
 *     Data & Privacy -> "Withdraw consent" both route to the SAME
 *     /consent?mode=update screen used for first-time signup consent, and
 *     that screen's only submit handler (handleContinue) POSTs to
 *     /api/consent/log (the signup logger), never the PATCH endpoint.
 *  2. The `User` type returned by GET /auth/me (backend/dependencies.py's
 *     public_user()) never included the user's current consent_purposes at
 *     all, and the consent screen never read the `mode` query param or
 *     pre-filled its analytics/updates toggles from anything -- they always
 *     start at hardcoded `false`, regardless of what the user had actually
 *     chosen before. So "Withdraw consent" always showed both optional
 *     toggles off, whatever the user's real saved preference was.
 *
 * Fix:
 *  - backend/dependencies.py: public_user() now includes consent_purposes.
 *  - frontend/src/auth.tsx: User type carries consent_purposes.
 *  - frontend/app/consent.tsx: reads `mode` from the route, and in
 *    mode=update pre-fills the analytics/updates switches from
 *    user.consent_purposes and calls PATCH /api/user/privacy-choices on
 *    save (via a dedicated handleSavePrivacyChoices, not handleContinue).
 *
 * This is a source-wiring test (grep/regex over the real .tsx/.py source),
 * matching this repo's existing .mjs test convention for RN screens that
 * have no renderer available in this plain-Node setup.
 *
 * Run with: node --experimental-strip-types --test src/__tests__/b81_privacy_choices_patch_wiring.test.mjs
 * (run from the frontend/ directory)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONSENT_TSX = readFileSync(path.join(__dirname, '../../app/consent.tsx'), 'utf8');
const AUTH_TSX = readFileSync(path.join(__dirname, '../auth.tsx'), 'utf8');
const DEPENDENCIES_PY = readFileSync(path.join(__dirname, '../../../backend/dependencies.py'), 'utf8');
const SERVER_PY = readFileSync(path.join(__dirname, '../../../backend/server.py'), 'utf8');

test('consent.tsx reads the mode query param to detect update mode', () => {
  assert.match(CONSENT_TSX, /useLocalSearchParams/);
  assert.match(CONSENT_TSX, /mode\s*===\s*['"]update['"]/);
});

test('consent.tsx pre-fills analytics/updates toggles from user.consent_purposes in update mode', () => {
  assert.match(CONSENT_TSX, /user\.consent_purposes\?\.analytics/);
  assert.match(CONSENT_TSX, /user\.consent_purposes\?\.updates/);
});

test('consent.tsx calls the real PATCH /api/user/privacy-choices endpoint on save', () => {
  assert.match(CONSENT_TSX, /\/api\/user\/privacy-choices/);
  assert.match(CONSENT_TSX, /method:\s*['"]PATCH['"]/);
});

test('consent.tsx update-mode save handler is wired to its own Pressable, not the signup handleContinue', () => {
  assert.match(CONSENT_TSX, /handleSavePrivacyChoices/);
  assert.match(CONSENT_TSX, /onPress=\{handleSavePrivacyChoices\}/);
});

test('consent.tsx update mode does not force first-time age/terms/data gating back on the user', () => {
  // The age/terms-checkbox/data-checkbox block must be conditioned out for
  // update mode (wrapped in the !isUpdateMode branch), not unconditionally
  // rendered alongside the optional toggles.
  assert.match(CONSENT_TSX, /isUpdateMode\s*\?[\s\S]*?:\s*\(/);
  assert.match(CONSENT_TSX, /consent-age-heading/);
});

test('User type (frontend/src/auth.tsx) carries consent_purposes so the screen has something to pre-fill from', () => {
  assert.match(AUTH_TSX, /consent_purposes\?:\s*\{[^}]*analytics\?:\s*boolean[^}]*updates\?:\s*boolean[^}]*\}/s);
});

test('backend public_user() (dependencies.py) returns consent_purposes', () => {
  assert.match(DEPENDENCIES_PY, /"consent_purposes":\s*u\.get\("consent_purposes"\)/);
});

test('backend still exposes the PATCH /api/user/privacy-choices endpoint the frontend now calls', () => {
  assert.match(SERVER_PY, /@app\.patch\("\/api\/user\/privacy-choices"\)/);
});
