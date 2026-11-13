/**
 * B-103 — "Unexpected text node" dev-warning toast on /lookup and
 * /lookup-results (React Native Web render warning visible to users).
 *
 * Root cause: app/(tabs)/lookup.tsx's decoded-state/court row was gated with
 * `{(cnrState || cnrCourt) && (<View>...</View>)}`. cnrState/cnrCourt are
 * strings (useState('')), not booleans — '' || '' is '' (a string), and
 * `'' && (<View>...)` evaluates to '' itself, not false. React Native Web
 * then tries to render that empty string as a direct child of a <View>,
 * which is exactly React Native's "Unexpected text node: ." invariant
 * warning (the message template is "Unexpected text node: {content}. A text
 * node cannot be a child of a <View>." — with content='', that renders as
 * "Unexpected text node: . A text node...", matching the reported toast
 * text verbatim).
 *
 * No bundler is available to import a .tsx with RN/Expo imports directly
 * into plain Node, so this test exercises (a) the same gating logic in pure
 * JS, mirroring the convention nearestHelp.logic.test.mjs already uses, and
 * (b) source-level guards confirming the real file was actually fixed.
 * Run with: node --experimental-strip-types src/__tests__/lookupCnrDecodedRow.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Mirrors the FIXED gating in lookup.tsx: an explicit ternary to null,
 * never a bare `&&` on string values. Returns what would be rendered as the
 * row's JSX child — `null` (nothing) or the row's own marker object. */
function decodedRowChild(cnrState, cnrCourt) {
  return (cnrState || cnrCourt) ? { rendered: true, cnrState, cnrCourt } : null;
}

/** Mirrors the OLD, buggy gating — kept here only so the test can show what
 * it used to produce, for contrast. Never used by the real component after
 * this fix. */
function buggyDecodedRowChild(cnrState, cnrCourt) {
  return (cnrState || cnrCourt) && { rendered: true, cnrState, cnrCourt };
}

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); console.log(`  ✅  ${label}`); passed++; }
  catch (e) { console.log(`  ❌  ${label}\n      ${e.message}`); failed++; }
}

console.log('\n── decoded-row gating (B-103) ───────────────────────────────────');

test('both empty: fixed gating renders null, not an empty string', () => {
  assert.equal(decodedRowChild('', ''), null);
});
test('demonstrates the old bug for contrast: both empty used to produce a bare empty string, not false/null', () => {
  const old = buggyDecodedRowChild('', '');
  assert.equal(old, '');
  assert.notEqual(old, null);
  assert.notEqual(old, false);
});
test('state known, court unknown: fixed gating still renders the row', () => {
  assert.deepEqual(decodedRowChild('Delhi', ''), { rendered: true, cnrState: 'Delhi', cnrCourt: '' });
});
test('court known, state unknown: fixed gating still renders the row', () => {
  assert.deepEqual(decodedRowChild('', 'High Court'), { rendered: true, cnrState: '', cnrCourt: 'High Court' });
});
test('both known: fixed gating renders the row', () => {
  assert.deepEqual(decodedRowChild('Delhi', 'High Court'), { rendered: true, cnrState: 'Delhi', cnrCourt: 'High Court' });
});

console.log('\n── Source-level guard ───────────────────────────────────────────');

const src = readFileSync(join(__dirname, '../../app/(tabs)/lookup.tsx'), 'utf8');

test('the decoded-row gate uses an explicit ternary to null, not a bare && on strings', () => {
  assert.ok(
    /\{\(cnrState \|\| cnrCourt\) \? \(/.test(src),
    'expected "(cnrState || cnrCourt) ? (" — the ternary form',
  );
  assert.ok(
    !/\{\(cnrState \|\| cnrCourt\) && \(/.test(src),
    'the old buggy "(cnrState || cnrCourt) && (" form must be gone',
  );
});
test('the inner state/court chips still each use their own null-safe ternary (unchanged by this fix)', () => {
  assert.ok(/\{cnrState \? \(/.test(src));
  assert.ok(/\{cnrCourt \? \(/.test(src));
});

console.log(`\n${'═'.repeat(60)}`);
console.log(`  ${passed} passed   ${failed} failed   ${passed + failed} total`);
console.log('═'.repeat(60));
if (failed > 0) process.exit(1);
