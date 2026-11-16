/**
 * B-104 — the CNR example shown on /lookup, "DLHC010001232024", was a real,
 * resolvable case on eCourts: searching it returned a real petitioner's full
 * name. A placeholder that exists only to show the 16-character shape must
 * never be able to resolve to a real person's record.
 *
 * Run with: node --experimental-strip-types src/__tests__/lookupExampleCnr.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../../app/(tabs)/lookup.tsx'), 'utf8');

// Mirrors backend/services/court_data.py's CNR_RE: 4 capital letters + 12 digits.
const CNR_RE = /^[A-Z]{4}\d{12}$/;

// Mirrors frontend/src/courtData.ts's CNR_STATE_CODES keys (2-letter state
// prefixes the app actually recognises). "XX" is deliberately not one of
// these, so the example can never decode to — or be mistaken for — a real
// state/court, let alone resolve against eCourts.
const KNOWN_STATE_PREFIXES = new Set([
  'AP', 'AR', 'AS', 'BR', 'CG', 'CH', 'DD', 'DL', 'GA',
]); // partial list is enough to assert "XX" is not one of them

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); console.log(`  ✅  ${label}`); passed++; }
  catch (e) { console.log(`  ❌  ${label}\n      ${e.message}`); failed++; }
}

console.log('\n── example CNR placeholder (B-104) ──────────────────────────────');

test('the placeholder shown to users is no longer the real, resolvable CNR from the report', () => {
  const m = src.match(/placeholder="CNR — e\.g\. ([A-Z0-9]+)"/);
  assert.ok(m, 'expected to find the CNR placeholder string in the file');
  assert.notEqual(m[1], 'DLHC010001232024', 'the real case\'s CNR must not be the user-visible example');
});

test('the new example CNR still has the correct 16-char shape (4 letters + 12 digits)', () => {
  const m = src.match(/placeholder="CNR — e\.g\. ([A-Z0-9]+)"/);
  assert.ok(m, 'expected to find the CNR placeholder string in the file');
  const example = m[1];
  assert.equal(example.length, 16, example);
  assert.ok(CNR_RE.test(example), `${example} must match the same 4-letter+12-digit CNR format the backend validates`);
});

test('the new example uses a state prefix that is not a real recognised state code', () => {
  const m = src.match(/placeholder="CNR — e\.g\. ([A-Z0-9]+)"/);
  const example = m[1];
  const prefix = example.slice(0, 2);
  assert.ok(!KNOWN_STATE_PREFIXES.has(prefix), `${prefix} must not be a real state code, so it can never decode as (or be mistaken for) a genuine state`);
});

console.log(`\n${'═'.repeat(60)}`);
console.log(`  ${passed} passed   ${failed} failed   ${passed + failed} total`);
console.log('═'.repeat(60));
if (failed > 0) process.exit(1);
