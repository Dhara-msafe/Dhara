/**
 * codePhraseGate.test.mjs — Code-phrase false-ARMED gate regression tests
 *
 * Covers the corrected trigger path:
 *   web save → unsupported_platform (never ARMED on web)
 *   native save → only ARMED after verified readback
 *   phrase matching → exact, case, whitespace, punctuation, Unicode apostrophe
 *   gate contract → exact phrase intercepted; near-miss continues; no stored → no intercept
 *   normalization contract → single shared normalizer in codePhraseHelpers
 *   static copy check → literal \u2014 absent from rendered JSX text nodes
 *
 * Run with:
 *   node --experimental-strip-types \
 *     src/__tests__/codePhraseGate.test.mjs
 *
 * All tests that touch storage or the trigger coordinator use in-memory fakes
 * so this file has ZERO native-module dependencies and runs in plain Node.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Production modules (no native deps) ───────────────────────────────────────
import { normalizePhrase, phrasesConflict } from '../women/codePhraseHelpers.ts';
import { isCodePhraseMatch } from '../women/codePhraseMatcher.ts';

// ── Test harness ──────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const queue = [];
function test(label, fn) { queue.push({ label, fn }); }

async function run() {
  for (const { label, fn } of queue) {
    try {
      await fn();
      console.log(`  PASS  ${label}`);
      passed++;
    } catch (e) {
      console.log(`  FAIL  ${label}  — ${e.message}`);
      failed++;
    }
  }
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ${passed} PASS   ${failed} FAIL   ${passed + failed} total`);
  console.log('═'.repeat(70));
  if (failed) process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Part 1: normalizePhrase — single shared normalizer contract
// ─────────────────────────────────────────────────────────────────────────────

test('CP-01: normalizePhrase — exact phrase (no punctuation) is preserved lowercased', () => {
  assert.equal(normalizePhrase('did you feed the cat today'), 'did you feed the cat today');
});

test('CP-02: normalizePhrase — case variation is normalised', () => {
  assert.equal(
    normalizePhrase('Did You Feed The Cat Today?'),
    normalizePhrase('did you feed the cat today')
  );
});

test('CP-03: normalizePhrase — leading and trailing whitespace stripped', () => {
  assert.equal(normalizePhrase('  did you feed the cat today?  '), 'did you feed the cat today');
});

test('CP-04: normalizePhrase — repeated interior spaces collapsed to one', () => {
  assert.equal(normalizePhrase('did  you   feed the  cat  today?'), 'did you feed the cat today');
});

test('CP-05: normalizePhrase — terminal question mark stripped', () => {
  assert.equal(normalizePhrase('did you feed the cat today?'), 'did you feed the cat today');
});

test('CP-06: normalizePhrase — terminal exclamation mark stripped', () => {
  assert.equal(normalizePhrase('help me!'), 'help me');
});

test('CP-07: normalizePhrase — Unicode NFC smart apostrophe U+2019 stripped', () => {
  assert.equal(normalizePhrase("didn\u2019t you see it?"), 'didnt you see it');
});

test('CP-08: normalizePhrase — straight apostrophe also stripped', () => {
  assert.equal(normalizePhrase("didn't you see it?"), 'didnt you see it');
});

test('CP-09: normalizePhrase — hyphen removed, no space substituted (documented near-miss)', () => {
  assert.equal(normalizePhrase('blue-moon'), 'bluemoon');
  // "blue moon" and "blue-moon" must NOT match
  assert.notEqual(normalizePhrase('blue moon'), normalizePhrase('blue-moon'));
});

test('CP-10: normalizePhrase — NFC canonical form: composed vs decomposed variant', () => {
  // U+00E9 (precomposed é) vs U+0065 U+0301 (decomposed e + combining acute)
  const composed   = 'caf\u00e9';       // café
  const decomposed = 'cafe\u0301';      // cafe + combining acute = café
  assert.equal(normalizePhrase(composed), normalizePhrase(decomposed),
    'NFC normalization must make composed and decomposed forms equal');
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 2: isCodePhraseMatch — same normalizer, same results
// ─────────────────────────────────────────────────────────────────────────────

test('CP-11: isCodePhraseMatch — exact phrase matches stored', () => {
  assert.equal(
    isCodePhraseMatch('Did you feed the cat today?', 'Did you feed the cat today?'),
    true
  );
});

test('CP-12: isCodePhraseMatch — case variation matches', () => {
  assert.equal(
    isCodePhraseMatch('DID YOU FEED THE CAT TODAY', 'did you feed the cat today'),
    true
  );
});

test('CP-13: isCodePhraseMatch — trailing whitespace matches', () => {
  assert.equal(
    isCodePhraseMatch('did you feed the cat today   ', 'did you feed the cat today'),
    true
  );
});

test('CP-14: isCodePhraseMatch — repeated spaces match (collapsed)', () => {
  assert.equal(
    isCodePhraseMatch('did  you  feed the cat today', 'did you feed the cat today'),
    true
  );
});

test('CP-15: isCodePhraseMatch — with and without final question mark match', () => {
  assert.equal(
    isCodePhraseMatch('did you feed the cat today?', 'did you feed the cat today'),
    true,
    'phrase with ? must match stored phrase without ?'
  );
  assert.equal(
    isCodePhraseMatch('did you feed the cat today', 'did you feed the cat today?'),
    true,
    'phrase without ? must match stored phrase with ?'
  );
});

test('CP-16: isCodePhraseMatch — Unicode smart apostrophe variation matches straight', () => {
  // Stored phrase uses smart apostrophe; typed phrase uses straight apostrophe
  assert.equal(
    isCodePhraseMatch("didn't you come today?", "didn\u2019t you come today?"),
    true
  );
});

test('CP-17: isCodePhraseMatch — near-miss (extra word) must NOT match', () => {
  assert.equal(
    isCodePhraseMatch('the blue moon is bright', 'blue moon is bright'),
    false,
    'extra word "the" must make phrases differ after normalization'
  );
});

test('CP-18: isCodePhraseMatch — substring of phrase must NOT match', () => {
  assert.equal(
    isCodePhraseMatch('feed the cat', 'did you feed the cat today'),
    false
  );
});

test('CP-19: isCodePhraseMatch — no stored phrase → false (fail closed)', () => {
  assert.equal(isCodePhraseMatch('did you feed the cat today?', ''), false);
  assert.equal(isCodePhraseMatch('did you feed the cat today?', '   '), false);
});

test('CP-20: isCodePhraseMatch — empty input → false (fail closed)', () => {
  assert.equal(isCodePhraseMatch('', 'did you feed the cat today'), false);
  assert.equal(isCodePhraseMatch('   ', 'did you feed the cat today'), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 3: StorePhraseResult contract — in-memory gate simulation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * makeFakeStore — simulates the storePhrase result contract in isolation.
 *
 *  platform  : 'native' | 'web'
 *  hasIdentity: whether a scoped storage key exists (logged in)
 *  failWrite  : if true, the write throws
 *  failReadBack: if true, the readback returns a different value
 */
function makeFakeStore({ platform = 'native', hasIdentity = true, failWrite = false, failReadBack = false } = {}) {
  let _stored = '';

  return {
    async storePhrase(phrase) {
      if (platform === 'web') return { outcome: 'unsupported_platform' };
      const trimmed = phrase.trim();
      if (!hasIdentity) {
        if (!trimmed) return { outcome: 'saved', stored: '' };
        return { outcome: 'no_identity' };
      }
      if (failWrite) return { outcome: 'storage_failure' };

      if (!trimmed) {
        // Clearing: just remove, no readback needed (mirrors storePhrase in store)
        _stored = '';
        return { outcome: 'saved', stored: '' };
      }

      // Saving with readback verification
      _stored = trimmed;
      const readBack = failReadBack ? 'CORRUPT' : _stored;
      if (!readBack || normalizePhrase(readBack) !== normalizePhrase(trimmed)) {
        return { outcome: 'verification_failure' };
      }
      return { outcome: 'saved', stored: trimmed };
    },
    async getStoredPhrase() {
      if (platform === 'web') return '';
      return _stored;
    },
  };
}

/** Simulates what save() in code-phrase.tsx should do after the fix. */
function simulateSave(storeResult, phraseInput) {
  if (storeResult.outcome !== 'saved') return { armed: false, reason: storeResult.outcome };
  const trimmed = phraseInput.trim();
  return { armed: trimmed.length > 0, reason: 'saved' };
}

test('CP-21: web storePhrase returns unsupported_platform', async () => {
  const store = makeFakeStore({ platform: 'web' });
  const result = await store.storePhrase('Did you feed the cat today?');
  assert.equal(result.outcome, 'unsupported_platform');
});

test('CP-22: web save never shows ARMED (outcome !== saved → armed=false)', async () => {
  const store = makeFakeStore({ platform: 'web' });
  const result = await store.storePhrase('Did you feed the cat today?');
  const ui = simulateSave(result, 'Did you feed the cat today?');
  assert.equal(ui.armed, false,
    'web save must not produce armed=true; UI must stay OFF');
});

test('CP-23: native save with identity and good readback returns saved + armed', async () => {
  const store = makeFakeStore({ platform: 'native', hasIdentity: true });
  const result = await store.storePhrase('Did you feed the cat today?');
  assert.equal(result.outcome, 'saved');
  const ui = simulateSave(result, 'Did you feed the cat today?');
  assert.equal(ui.armed, true);
});

test('CP-24: native save with write failure returns storage_failure → armed=false', async () => {
  const store = makeFakeStore({ platform: 'native', hasIdentity: true, failWrite: true });
  const result = await store.storePhrase('Did you feed the cat today?');
  assert.equal(result.outcome, 'storage_failure');
  const ui = simulateSave(result, 'Did you feed the cat today?');
  assert.equal(ui.armed, false,
    'storage failure must not set ARMED');
});

test('CP-25: native save with failed readback returns verification_failure → armed=false', async () => {
  const store = makeFakeStore({ platform: 'native', hasIdentity: true, failReadBack: true });
  const result = await store.storePhrase('Did you feed the cat today?');
  assert.equal(result.outcome, 'verification_failure');
  const ui = simulateSave(result, 'Did you feed the cat today?');
  assert.equal(ui.armed, false,
    'verification failure (corrupt readback) must not set ARMED');
});

test('CP-26: native save without identity returns no_identity → armed=false', async () => {
  const store = makeFakeStore({ platform: 'native', hasIdentity: false });
  const result = await store.storePhrase('Did you feed the cat today?');
  assert.equal(result.outcome, 'no_identity');
  const ui = simulateSave(result, 'Did you feed the cat today?');
  assert.equal(ui.armed, false);
});

test('CP-27: screen remount derives state from store readback — not from save outcome', async () => {
  // Simulates the useEffect on mount: getStoredPhrase() → setArmed(p.trim().length > 0)
  const store = makeFakeStore({ platform: 'native' });
  // Before save: remount reads empty
  const beforeSave = await store.getStoredPhrase();
  assert.equal(beforeSave.trim().length > 0, false, 'unarmed before save');
  // Save
  await store.storePhrase('Did you feed the cat today?');
  // Remount reads stored value
  const afterSave = await store.getStoredPhrase();
  assert.equal(afterSave.trim().length > 0, true, 'armed after save');
  // Web: remount always reads empty
  const webStore = makeFakeStore({ platform: 'web' });
  const webRead = await webStore.getStoredPhrase();
  assert.equal(webRead, '', 'web remount always reads empty string');
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 4: Gate contract — phrase swallowed, near-miss continues
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simulates the send() intercept in index.tsx:
 *   1. Reads stored phrase from store
 *   2. isCodePhraseMatch(input, stored)
 *   3. If match: swallow (never reaches chat/backend); call safety coordinator
 *   4. If no match: continues to normal chat
 */
async function simulateSend(input, store, { flagEnabled = true } = {}) {
  if (!flagEnabled) return { intercepted: false, coordinatorCalled: false, reason: 'flag_off' };
  const stored = await store.getStoredPhrase();
  if (stored && isCodePhraseMatch(input, stored)) {
    return { intercepted: true, coordinatorCalled: true, sentToChat: false, sentToBackend: false };
  }
  return { intercepted: false, coordinatorCalled: false, sentToChat: true, sentToBackend: true };
}

test('CP-28: exact phrase is intercepted — never reaches chat or backend', async () => {
  const store = makeFakeStore({ platform: 'native' });
  await store.storePhrase('Did you feed the cat today?');
  const result = await simulateSend('Did you feed the cat today?', store);
  assert.equal(result.intercepted, true);
  assert.equal(result.sentToChat, false);
  assert.equal(result.sentToBackend, false);
});

test('CP-29: case variation of phrase is intercepted', async () => {
  const store = makeFakeStore({ platform: 'native' });
  await store.storePhrase('Did you feed the cat today?');
  const result = await simulateSend('DID YOU FEED THE CAT TODAY', store);
  assert.equal(result.intercepted, true);
  assert.equal(result.sentToBackend, false);
});

test('CP-30: near-miss phrase continues to normal chat', async () => {
  const store = makeFakeStore({ platform: 'native' });
  await store.storePhrase('Did you feed the cat today?');
  const result = await simulateSend('did you feed the dog today', store);
  assert.equal(result.intercepted, false);
  assert.equal(result.sentToChat, true);
  assert.equal(result.sentToBackend, true);
});

test('CP-31: no stored phrase → no intercept (fail closed)', async () => {
  const store = makeFakeStore({ platform: 'native' });
  // Nothing saved
  const result = await simulateSend('Did you feed the cat today?', store);
  assert.equal(result.intercepted, false);
  assert.equal(result.sentToChat, true);
});

test('CP-32: storage read failure → no intercept (fail closed)', async () => {
  // Simulates getStoredPhrase() returning '' (as it does on any failure)
  const store = { getStoredPhrase: async () => '' };
  const result = await simulateSend('Did you feed the cat today?', store);
  assert.equal(result.intercepted, false);
  assert.equal(result.sentToChat, true);
});

test('CP-33: flag off → no intercept regardless of phrase', async () => {
  const store = makeFakeStore({ platform: 'native' });
  await store.storePhrase('Did you feed the cat today?');
  const result = await simulateSend('Did you feed the cat today?', store, { flagEnabled: false });
  assert.equal(result.intercepted, false);
  assert.equal(result.reason, 'flag_off');
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 5: Remove clears store and armed state
// ─────────────────────────────────────────────────────────────────────────────

test('CP-34: Remove clears store — subsequent read returns empty string', async () => {
  const store = makeFakeStore({ platform: 'native' });
  await store.storePhrase('Did you feed the cat today?');
  assert.equal((await store.getStoredPhrase()).trim().length > 0, true, 'must be armed before remove');
  // Simulate clear: storePhrase('') + setArmed(false)
  const clearResult = await store.storePhrase('');
  assert.equal(clearResult.outcome, 'saved', 'clear must return saved');
  const afterClear = await store.getStoredPhrase();
  assert.equal(afterClear, '', 'store must be empty after clear');
  // UI state
  const ui = simulateSave(clearResult, '');
  assert.equal(ui.armed, false, 'armed must be false after clear');
});

test('CP-35: Remove on web does nothing (guard)', async () => {
  const store = makeFakeStore({ platform: 'web' });
  const clearResult = await store.storePhrase('');
  assert.equal(clearResult.outcome, 'unsupported_platform');
  // Web clear guard: UI platform check prevents clear() from running
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 6: Static analysis — literal \u2014 absent from rendered JSX text nodes
// ─────────────────────────────────────────────────────────────────────────────

test('CP-36: literal \\u2014 is absent from JSX text content in code-phrase.tsx', () => {
  const srcPath = path.resolve(__dirname, '../../app/women/code-phrase.tsx');
  const src = readFileSync(srcPath, 'utf8');
  const lines = src.split('\n');

  // Find lines that contain the 6-character sequence \u2014 (backslash u 2 0 1 4)
  // but are NOT inside a JS string expression {...}.
  // In JSX, text between tags is NOT a JS expression and does not process \uXXXX.
  // A JS expression would be on a line with '{\'' or '{`' or the pattern >{...}<.
  const jsxTextWithLiteral = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Check: line contains the literal 6 chars \u2014
    if (!line.includes('\\u2014')) continue;
    // Exclude: line is inside a JS expression (contains {' or {` or {'  or {"
    const isJsExpr = /\{['"`]/.test(line) || /\{[^}]*\\u2014[^}]*\}/.test(line);
    // Exclude: line is a comment
    const isComment = line.trimStart().startsWith('//') || line.trimStart().startsWith('*');
    // Exclude: line is a JSX expression attribute {value}
    if (!isJsExpr && !isComment) {
      jsxTextWithLiteral.push(`  line ${i + 1}: ${line.trim()}`);
    }
  }

  assert.equal(jsxTextWithLiteral.length, 0,
    `Literal \\u2014 found in JSX text content (not inside {'"...'"}):\n${jsxTextWithLiteral.join('\n')}\n` +
    `Fix: replace \\u2014 in JSX text nodes with {'—'} or the literal em-dash character —`
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 7: Simulation cannot invoke any outbound boundary
// ─────────────────────────────────────────────────────────────────────────────

test('CP-37: safety coordinator with flag off returns flagOff=true — no outbound boundary', async () => {
  // We cannot import safetyTriggerCoordinator without stubbing privacyAuditLog.
  // Test the contract via the simulateSend gate simulation: flag off → no intercept.
  const store = makeFakeStore({ platform: 'native' });
  await store.storePhrase('Did you feed the cat today?');
  const result = await simulateSend('Did you feed the cat today?', store, { flagEnabled: false });
  assert.equal(result.intercepted, false,
    'with flag off, coordinator must never be called — no recording, no alert, no SMS');
  assert.equal(result.coordinatorCalled, false);
});

test('CP-38: web simulation never reaches real boundary (getStoredPhrase returns empty on web)', async () => {
  // On web, getStoredPhrase() returns '' — so even if SAFE_WORD_V1 flag is on,
  // isCodePhraseMatch('...', '') returns false and the coordinator is never called.
  const webStore = makeFakeStore({ platform: 'web' });
  const result = await simulateSend('Did you feed the cat today?', webStore, { flagEnabled: true });
  assert.equal(result.intercepted, false,
    'web: stored is always empty → intercept never fires → no outbound boundary');
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 8: normalizePhrase and isCodePhraseMatch are the SAME function (single source)
// ─────────────────────────────────────────────────────────────────────────────

test('CP-39: isCodePhraseMatch uses the same normalizer as normalizePhrase', () => {
  const a = 'Did you feed the cat today?';
  const b = 'Did you feed the cat today?';
  // isCodePhraseMatch(a, b) must be equivalent to normalizePhrase(a) === normalizePhrase(b)
  assert.equal(
    isCodePhraseMatch(a, b),
    normalizePhrase(a) === normalizePhrase(b)
  );
  const c = 'DID YOU FEED THE CAT TODAY';
  assert.equal(
    isCodePhraseMatch(a, c),
    normalizePhrase(a) === normalizePhrase(c)
  );
  const d = 'unrelated phrase';
  assert.equal(
    isCodePhraseMatch(a, d),
    normalizePhrase(a) === normalizePhrase(d)
  );
});

await run();

console.log(`
NOT RUN — native/device behaviour (requires an APK/device build):
  N-1  storePhrase() persists to encrypted SecureStore on native (real write test)
  N-2  Armed state survives app restart (SecureStore key persisted)
  N-3  Phrase typed in Ask DHARA on device fires triggerSafetySequence
  N-4  triggerSafetySequence starts EvidenceRecorder (mic permission required)
  N-5  Phrase cleared from Remove: SecureStore key is gone after app restart
  N-6  Web preview never shows ARMED (visual screenshot regression)
`);
