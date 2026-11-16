// B-20 (14 Nov 2026): "Server cannot end sessions."
//
// Before this fix, a signed JWT kept working for the rest of its 30-day life
// no matter what -- there was no server-side way to end a session it had
// already handed out (lost phone, stolen token, a user who just wants to be
// sure). dependencies.py/api/auth_router.py (backend) now stamp every token
// with the user's token_version and check it on every request; a new
// POST /api/auth/logout-everywhere bumps it, invalidating every token for
// that account immediately. This file checks the FRONTEND side: the new
// "Sign out of all devices" action in Settings actually calls that endpoint
// and then performs the same local logout as the ordinary sign-out button
// (never leaving this device's own session looking "signed in" after the
// call that just invalidated it).
//
// Source-level wiring check -- settings.tsx is a React Native screen with
// RN/Expo imports and can't be executed directly in this test runner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, '..', '..', 'app', '(tabs)', 'settings.tsx'), 'utf8');

test('B-20: a "sign out of all devices" action exists and calls POST /api/auth/logout-everywhere', () => {
  assert.match(src, /\/api\/auth\/logout-everywhere/);
  const fnMatch = src.match(/const signOutEverywhere = async[\s\S]*?\n  \};/);
  assert.ok(fnMatch, 'expected a signOutEverywhere handler');
  assert.match(fnMatch[0], /method:\s*'POST'/);
  assert.match(fnMatch[0], /Authorization:\s*`Bearer \$\{token\}`/);
});

test('B-20: signOutEverywhere always finishes with the same local logout() + redirect as ordinary sign-out', () => {
  const fnMatch = src.match(/const signOutEverywhere = async[\s\S]*?\n  \};/);
  assert.ok(fnMatch);
  // Must run in a `finally` so a network failure can never leave this
  // device's own session looking signed-in after the user asked to end it.
  assert.match(fnMatch[0], /finally\s*\{[\s\S]*await logout\(\);[\s\S]*\}/);
  assert.match(fnMatch[0], /router\.replace\('\/login'\)/);
});

test('B-20: the action is confirmed before firing, like the destructive sign-out/delete actions beside it', () => {
  assert.match(src, /confirmLogoutAll[\s\S]{0,400}crossAlert\(/);
  assert.match(src, /'Sign out everywhere'[\s\S]{0,20}style:\s*'destructive'/);
});

test('B-20: the button is wired to the confirm step and hidden for guest sessions (nothing else to sign out of)', () => {
  const btnMatch = src.match(/testID="logout-everywhere-button"[\s\S]*?\/>|testID="logout-everywhere-button"[\s\S]*?<\/Pressable>/);
  assert.ok(btnMatch, 'expected a logout-everywhere-button Pressable');
  assert.match(src, /!user\?\.is_guest[\s\S]{0,200}testID="logout-everywhere-button"/);
  assert.match(src, /onPress=\{confirmLogoutAll\}/);
});
