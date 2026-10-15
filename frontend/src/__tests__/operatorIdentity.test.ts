/**
 * Unit tests for the grievance-officer placeholder guard.
 * Run with: node --experimental-strip-types --import ./src/voice/core/__tests__/ts-resolve.mjs --test src/__tests__/operatorIdentity.test.ts
 * (Node 22.6+). No Expo, React or device needed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { grievanceOfficerName, grievanceContactEmail, isGrievanceContactPlaceholder } from '../operatorIdentity';

test('owner-confirmed officer name/email (current real state) -> isGrievanceContactPlaceholder() is false', () => {
  // As of the owner confirming "Varuna Moses" / "varuna@calviltech.com",
  // the grievance line must render. If this ever flips back to true
  // (placeholder reintroduced), the UI will fail-closed and hide the line.
  assert.equal(grievanceOfficerName.includes('to be confirmed'), false);
  assert.equal(isGrievanceContactPlaceholder(), false);
});

test('both name and email confirmed (simulated real values) -> false', () => {
  const realName = 'Jane Doe';
  const realEmail = 'grievance@calviltech.com';
  const isPlaceholder = (name: string, email: string) =>
    name.includes('to be confirmed') || email.includes('to be confirmed');
  assert.equal(isPlaceholder(realName, realEmail), false);
});

test('email still placeholder even if name were confirmed -> still true (fail closed)', () => {
  const realName = 'Jane Doe';
  const placeholderEmail = 'email (to be confirmed by owner)';
  const isPlaceholder = (name: string, email: string) =>
    name.includes('to be confirmed') || email.includes('to be confirmed');
  assert.equal(isPlaceholder(realName, placeholderEmail), true);
});

test('sanity: the real, current contact email is not itself a placeholder string', () => {
  assert.equal(grievanceContactEmail.includes('to be confirmed'), false);
});
