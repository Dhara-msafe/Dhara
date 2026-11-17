// B-62 (17 Nov 2026): the consent notice said "Your phone number and name - to
// log you in", but sign-in is by email (sign-up asks for name, email and phone).
// The first "what we collect" line must name the email address, in every language.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(path.join(root, 'src', 'consentStrings.ts'), 'utf8');

test('B-62: English notice names the email address used to sign in', () => {
  assert.match(src, /"Your name, email address and phone number - to create your account, sign you in and keep your account safe\."/);
  assert.doesNotMatch(src, /Your phone number and name - to log you in/);
});

test('B-62: Hindi and Marathi notices name the email address too', () => {
  assert.match(src, /आपका नाम, ईमेल पता और फ़ोन नंबर/);
  assert.match(src, /तुमचे नाव, ईमेल पत्ता आणि फोन नंबर/);
  assert.doesNotMatch(src, /आपका फ़ोन नंबर और नाम - आपको लॉग इन/);
  assert.doesNotMatch(src, /तुमचा फोन नंबर आणि नाव - तुम्हाला लॉग इन/);
});
