// B-29 + B-91 (14 Nov 2026):
//  B-29: the account-deletion flows (Settings -> Delete my account, and the
//  public /delete-account OTP flow) called fetch() directly with no timeout,
//  so a dropped connection surfaced the raw thrown error text (e.g. "Network
//  request failed" / "TypeError: Failed to fetch") straight to the user
//  instead of a readable message -- unlike /login and /forgot-password,
//  which already guard every fetch with a timeout and a friendly fallback.
//  B-91: after deleting the account, some other screen's in-flight request
//  on the now-invalid token could race in a 401 and flag sessionExpired,
//  so the login screen showed "Your session has expired" even though
//  nothing expired -- the user had just chosen to delete their account.
//
// Source-wiring checks (readFileSync + regex), matching this repo's
// existing *.test.mjs convention for screens that can't be loaded directly
// in plain Node (react-native / expo-router imports).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');

const settingsSrc = readFileSync(path.join(root, 'app', '(tabs)', 'settings.tsx'), 'utf8');
const deleteAccountSrc = readFileSync(path.join(root, 'app', 'delete-account.tsx'), 'utf8');
const loginSrc = readFileSync(path.join(root, 'app', 'login.tsx'), 'utf8');

test('B-29: settings.tsx delete-account fetch has a timeout and a friendly network message', () => {
  assert.match(settingsSrc, /new AbortController\(\)/);
  assert.match(settingsSrc, /signal:\s*ctrl\.signal/);
  assert.match(settingsSrc, /Could not reach DHARA\. Check your internet connection and try again\./);
  // The catch block must not fall back to a bare, possibly-raw e.message with
  // no friendly default -- DELETE_NETWORK_MSG must be the fallback.
  assert.match(settingsSrc, /setDeleteError\(e\?\.message \|\| DELETE_NETWORK_MSG\)/);
});

test('B-29: delete-account.tsx OTP requests go through a timeout-guarded postJson helper', () => {
  assert.match(deleteAccountSrc, /async function postJson/);
  assert.match(deleteAccountSrc, /new AbortController\(\)/);
  assert.match(deleteAccountSrc, /throw new Error\(NETWORK_MSG\)/);
  assert.match(deleteAccountSrc, /await postJson\('\/api\/account-deletion\/request-otp'/);
  assert.match(deleteAccountSrc, /await postJson\('\/api\/account-deletion\/verify'/);
});

test('B-91: settings.tsx clears sessionExpired and tells /login this was a deliberate deletion', () => {
  assert.match(settingsSrc, /clearSessionExpired\s*\}\s*=\s*useAuth\(\)/);
  assert.match(settingsSrc, /clearSessionExpired\(\);\s*\n\s*router\.replace\(\{ pathname: '\/login', params: \{ accountDeleted: '1' \} \}/);
});

test('B-91: delete-account.tsx also clears sessionExpired after a logged-in deletion', () => {
  assert.match(deleteAccountSrc, /clearSessionExpired/);
});

test('B-91: login.tsx shows an accurate "account deleted" notice instead of "session expired"', () => {
  assert.match(loginSrc, /accountDeleted/);
  assert.match(loginSrc, /account-deleted-banner/);
  assert.match(loginSrc, /Your account has been deleted\./);
  // Must clear the flag on mount too, as a second guard against the race.
  assert.match(loginSrc, /if \(accountDeleted === '1'\) clearSessionExpired\(\);/);
  // The two banners must be mutually exclusive (ternary), not both renderable.
  assert.match(loginSrc, /accountDeleted === '1' \? \(/);
});
