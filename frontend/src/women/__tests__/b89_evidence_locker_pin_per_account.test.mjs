/**
 * B-89 / D-09 — the Evidence Locker PIN must be per-account, not shared by
 * every account on a device.
 *
 * D-09 (DHARA Decision Log) confirms the team recommendation for shared-
 * phone data is "per account", and explicitly names the Evidence Locker
 * PIN as something to confirm is per-account the same way codePhraseStore.ts's
 * SOS/hide phrases already are. Before this fix, evidenceLock.ts's PIN
 * hash, salt, attempt counter and lockout timer all lived under one flat,
 * unnamespaced key -- Account A's PIN unlocked Account B's evidence too,
 * and a lockout triggered by one account locked out every other account
 * on the same device as well.
 *
 * evidenceLock.ts transitively imports expo-secure-store, whose native
 * binding doesn't resolve under plain Node in this sandbox (same
 * limitation noted in w2j04_code_phrase_silent_alert_evidence_locker.test.ts),
 * so this is a source-level wiring check, same convention as that file and
 * as b87_notetaker_wave1_gate.test.mjs.
 *
 * Run with:
 *   node --experimental-strip-types --test src/women/__tests__/b89_evidence_locker_pin_per_account.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCK_SRC = readFileSync(join(__dirname, '..', 'evidenceLock.ts'), 'utf8');
const SCREEN_SRC = readFileSync(join(__dirname, '..', '..', '..', 'app', 'women', 'evidence-locker.tsx'), 'utf8');

test('evidenceLock.ts resolves the active account id, same helper as codePhraseStore.ts', () => {
  assert.ok(LOCK_SRC.includes("import { getActiveUserIdSync, whenAuthHydrated } from '../auth';"));
});

test('every PIN key (hash, salt, attempts, lockout) is namespaced per account, not a flat shared key', () => {
  assert.ok(/hash: `\$\{PIN_HASH_BASE\}_\$\{uid\}`/.test(LOCK_SRC));
  assert.ok(/salt: `\$\{PIN_SALT_BASE\}_\$\{uid\}`/.test(LOCK_SRC));
  assert.ok(/attempts: `\$\{PIN_ATTEMPTS_BASE\}_\$\{uid\}`/.test(LOCK_SRC));
  assert.ok(/lockout: `\$\{PIN_LOCKOUT_BASE\}_\$\{uid\}`/.test(LOCK_SRC));
});

test('a missing signed-in identity fails closed: no uid means no read, no write', () => {
  assert.ok(/if \(!uid\) return null;/.test(LOCK_SRC));
  // hasPin(): no keys -> false (not "throws", not "true by accident")
  assert.match(LOCK_SRC, /export async function hasPin[\s\S]{0,200}if \(!keys\) return false;/);
  // setPin(): no keys -> no-op, never writes under a fallback flat key
  assert.match(LOCK_SRC, /export async function setPin[\s\S]{0,300}if \(!keys\) return; \/\/ fail closed/);
  // clearPin(): no keys -> no-op
  assert.match(LOCK_SRC, /export async function clearPin[\s\S]{0,200}if \(!keys\) return;/);
});

test('the old flat PIN keys are quarantined once, never read by hasPin/verifyPin/setPin/clearPin', () => {
  assert.ok(LOCK_SRC.includes('_quarantineLegacyOnce'));
  assert.ok(LOCK_SRC.includes("const OLD_PIN_HASH_KEY     = 'dhara_evidence_pin_hash';"));
  // the quarantine key is written to, but no get/verify function reads from it
  assert.ok(LOCK_SRC.includes('QUARANTINE_HASH_KEY'));
  const readsOfQuarantineKey = (LOCK_SRC.match(/store_get\(QUARANTINE_HASH_KEY\)/g) || []).length;
  assert.equal(readsOfQuarantineKey, 0, 'QUARANTINE_HASH_KEY must never be read back by any PIN-check function');
  // old key is deleted (not left lying around) once quarantined
  assert.ok(LOCK_SRC.includes('store_delete(OLD_PIN_HASH_KEY)'));
});

test('the old PIN is dropped, not migrated forward -- no cross-account inheritance of a shared PIN', () => {
  assert.ok(
    !/legacyUnsaltedHashPin|legacySecure.*hashPin\(pin/.test(LOCK_SRC),
    'no code path should let the old shared PIN silently become any one account\'s new per-account PIN'
  );
});

test('exported function signatures are unchanged (no new required params) -- call sites need no changes', () => {
  assert.ok(LOCK_SRC.includes('export async function hasPin(): Promise<boolean>'));
  assert.ok(LOCK_SRC.includes('export async function setPin(pin: string): Promise<void>'));
  assert.ok(LOCK_SRC.includes('export async function verifyPin(pin: string): Promise<PinCheckResult>'));
  assert.ok(LOCK_SRC.includes('export async function clearPin(): Promise<void>'));
  assert.ok(LOCK_SRC.includes('export async function getLockoutRemainingMs(): Promise<number>'));
});

test('evidence-locker.tsx calls these functions with no account/user argument (resolved internally now)', () => {
  assert.ok(/hasPin\(\)/.test(SCREEN_SRC));
  assert.ok(/setPin\(pin\)/.test(SCREEN_SRC));
  assert.ok(/verifyPin\(pin\)/.test(SCREEN_SRC));
  assert.ok(/getLockoutRemainingMs\(\)/.test(SCREEN_SRC));
});

test('lockout/backoff math is unchanged by the account-scoping fix', () => {
  assert.ok(LOCK_SRC.includes('const MAX_ATTEMPTS_BEFORE_LOCKOUT = 5;'));
  assert.ok(LOCK_SRC.includes('const BASE_LOCKOUT_MS = 30_000;'));
});
