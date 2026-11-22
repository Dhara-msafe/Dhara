// 22 Nov 2026 (Vivek): on a device that is already set up, the privacy notice
// is shown to whoever creates something new (an account or a guest session),
// not to someone signing back in to an existing account. First install still
// runs language -> How it helps -> privacy notice. A signed-in account that has
// never consented gets the FULL notice (not B-81's update mode, which records
// no consent and looped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => readFileSync(path.join(root, p), 'utf8');
const layout = read('app/_layout.tsx');
const consent = read('app/consent.tsx');
const login = read('app/login.tsx');
const howItHelps = read('app/how-it-helps.tsx');

test('first install: How it helps goes straight to the privacy notice', () => {
  assert.match(howItHelps, /router\.replace\('\/consent'\)/);
  assert.doesNotMatch(howItHelps, /router\.replace\('\/login'\)/);
});

test('guard: signed-out sign-in and forgot-password are not forced through the notice', () => {
  assert.match(layout, /if \(!user && \(segments\[0\] === 'login' \|\| segments\[0\] === 'forgot-password'\)\) return;/);
});

test('guard: signed-out /signup without consent goes to the notice with next=signup', () => {
  assert.match(layout, /segments\[0\] === 'signup'\s*\n?\s*\? \{ pathname: '\/consent', params: \{ next: 'signup' \} \}/);
});

test('guard: a signed-in account without consent gets the full notice, never update mode', () => {
  const guard = layout.match(/function ConsentGuard[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(guard, /mode: 'update'/);
});

test('consent: after Accept, carries on to sign-up or starts the guest session', () => {
  assert.match(consent, /if \(next === 'signup'\) \{ router\.replace\('\/signup'\); return; \}/);
  assert.match(consent, /if \(next === 'guest'\) \{\s*try \{ await continueAsGuest\(\); router\.replace\('\/\(tabs\)\/home'\); \}/);
});

test('sign-in: Continue as guest opens the notice first when nobody has consented', () => {
  assert.match(login, /consentVersionKey\(undefined\)/);
  assert.match(login, /params: \{ next: 'guest' \}/);
});

test('consent: the "STEP 3 OF 4" label is only for first-time setup', () => {
  assert.match(consent, /\{!user && !next && <Text style=\{styles\.stepEyebrow\}>STEP 3 OF 4<\/Text>\}/);
});
