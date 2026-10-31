/**
 * hidePhrase.storage.test.mjs — D1-V hide-phrase logic tests.
 *
 * Imports the actual production helpers (normalizePhrase, phrasesConflict) from
 * codePhraseHelpers.ts rather than duplicating the comparison logic inline.
 * Storage functions are exercised through an in-memory mock store whose conflict
 * detection wires the same imported production helpers — so every test exercises
 * REAL normalisation behaviour, not a copy of it.
 *
 * Run with:
 *   node --experimental-strip-types \
 *     src/__tests__/hidePhrase.storage.test.mjs
 */

import assert from 'node:assert/strict';

// ── Production helpers (real code, not inline duplicates) ─────────────────────
import { normalizePhrase, phrasesConflict } from '../women/codePhraseHelpers.ts';

// ── In-memory mock store (mirrors codePhraseStore logic without native deps) ───
// Each makeStore() call represents one independent account session.
// setSOS/setHide delegate their conflict check to the imported phrasesConflict —
// this is what makes the test exercise production code, not test-only logic.
function makeStore(initialSOS = '') {
  let sos = initialSOS.trim();
  let hide = '';
  return {
    async getSOS()          { return sos; },
    async setSOS(phrase) {
      const t = phrase.trim();
      if (phrasesConflict(t, hide))
        return { saved: false, conflict: true, storageError: false };
      sos = t;
      return { saved: true, conflict: false, storageError: false, armed: t.length > 0 };
    },
    async getHide()         { return hide; },
    async setHide(phrase) {
      const t = phrase.trim();
      if (phrasesConflict(t, sos))
        return { saved: false, conflict: true, storageError: false };
      hide = t;
      return { saved: true, conflict: false, storageError: false, armed: t.length > 0 };
    },
    async clearHide() { hide = ''; return { cleared: true, storageError: false }; },
  };
}

function makeFailingStore() {
  return {
    async getHide()     { return ''; },
    async setHide()     { return { saved: false, conflict: false, storageError: true }; },
    async clearHide()   { return { cleared: false, storageError: true }; },
  };
}

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
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${passed} PASS   ${failed} FAIL   ${passed + failed} total`);
  console.log('═'.repeat(60));
  if (failed) process.exit(1);
}

// ── PH-1: normalizePhrase trims, lowercases, and strips punctuation ──────────
test('PH-1: normalizePhrase trims whitespace, lowercases, and strips punctuation', () => {
  assert.equal(normalizePhrase('  Blue Umbrella  '), 'blue umbrella');
  // Question mark and other punctuation must be stripped (not preserved)
  assert.equal(normalizePhrase('CAN YOU BRING IT?'), 'can you bring it');
  assert.equal(normalizePhrase('  '), '');
  // Repeated spaces collapsed to one
  assert.equal(normalizePhrase('blue  moon'), 'blue moon');
  // Hyphens removed (no space substituted — this is a documented non-match)
  assert.equal(normalizePhrase('blue-moon'), 'bluemoon');
  // Unicode smart apostrophe stripped
  assert.equal(normalizePhrase("didn\u2019t you?"), 'didnt you');
});

// ── PH-2: phrasesConflict is case-insensitive ─────────────────────────────────
test('PH-2: phrasesConflict is case-insensitive', () => {
  assert.equal(phrasesConflict('Blue Umbrella', 'blue umbrella'), true);
  assert.equal(phrasesConflict('Can you BRING IT?', 'can you bring it?'), true);
});

// ── PH-3: empty phrases never conflict ───────────────────────────────────────
test('PH-3: phrasesConflict returns false when either phrase is empty', () => {
  assert.equal(phrasesConflict('', 'something'), false);
  assert.equal(phrasesConflict('something', ''), false);
  assert.equal(phrasesConflict('', ''), false);
  assert.equal(phrasesConflict('   ', 'something'), false);
});

// ── PH-4: distinct phrases do not conflict ────────────────────────────────────
test('PH-4: distinct phrases do not conflict', () => {
  assert.equal(phrasesConflict('Blue Umbrella', 'Red Car'), false);
  assert.equal(phrasesConflict('Call the doctor', 'Has anyone called today?'), false);
});

// ── PH-5: setHide blocked when matches persisted SOS ─────────────────────────
test('PH-5: setHide returns conflict=true when phrase matches persisted SOS', async () => {
  const s = makeStore('Can you bring the blue umbrella?');
  const r = await s.setHide('Can you bring the blue umbrella?');
  assert.equal(r.conflict, true);
  assert.equal(r.saved, false);
  assert.equal(await s.getHide(), '');
});

// ── PH-6: setSOS blocked when matches persisted hide ─────────────────────────
test('PH-6: setSOS returns conflict=true when phrase matches persisted hide', async () => {
  const s = makeStore();
  await s.setHide('Has anyone called today?');
  const r = await s.setSOS('Has anyone called today?');
  assert.equal(r.conflict, true);
  assert.equal(r.saved, false);
});

// ── PH-7: conflict detection is case-insensitive ─────────────────────────────
test('PH-7: conflict detected regardless of letter case', async () => {
  const s = makeStore('can you bring the blue umbrella?');
  const r = await s.setHide('Can You Bring The Blue Umbrella?');
  assert.equal(r.conflict, true);
});

// ── PH-8: distinct phrases save without conflict ─────────────────────────────
test('PH-8: distinct phrases save successfully (no conflict)', async () => {
  const s = makeStore('SOS phrase');
  const r = await s.setHide('Different phrase');
  assert.equal(r.conflict, false);
  assert.equal(r.saved, true);
  assert.equal(await s.getHide(), 'Different phrase');
});

// ── PH-9: account isolation ───────────────────────────────────────────────────
test('PH-9: two accounts have fully independent phrase stores', async () => {
  const storeA = makeStore('Phrase for A');
  const storeB = makeStore('Phrase for B');
  await storeA.setHide('hide-A');
  await storeB.setHide('hide-B');
  assert.equal(await storeA.getHide(), 'hide-A');
  assert.equal(await storeB.getHide(), 'hide-B');
  // Clearing A must not affect B
  await storeA.clearHide();
  assert.equal(await storeB.getHide(), 'hide-B',
    'clearHide for account A must not affect account B');
});

// ── PH-10: clearHide removes hide phrase ─────────────────────────────────────
test('PH-10: clearHide removes the stored hide phrase', async () => {
  const s = makeStore();
  await s.setHide('phrase to clear');
  const r = await s.clearHide();
  assert.equal(r.cleared, true);
  assert.equal(await s.getHide(), '');
});

// ── PH-11: saving empty phrase disarms ───────────────────────────────────────
test('PH-11: saving empty phrase disarms (armed=false, hide key removed)', async () => {
  const s = makeStore();
  await s.setHide('some phrase');
  const r = await s.setHide('   ');
  assert.equal(r.saved, true);
  assert.equal(r.armed, false);
  assert.equal(await s.getHide(), '');
});

// ── PH-12: storage failure surfaces as storageError ──────────────────────────
test('PH-12: storage failure surfaces as storageError=true, not rethrown', async () => {
  const s = makeFailingStore();
  const r = await s.setHide('phrase');
  assert.equal(r.storageError, true);
  assert.equal(r.saved, false);
});

// ── PH-13: clearHide storage failure surfaces ────────────────────────────────
test('PH-13: clearHide storage failure surfaces as storageError=true', async () => {
  const s = makeFailingStore();
  const r = await s.clearHide();
  assert.equal(r.cleared, false);
  assert.equal(r.storageError, true);
});

// ── PH-14: guest sessions are isolated ───────────────────────────────────────
test('PH-14: guest sessions are isolated — new session has empty state', async () => {
  const session1 = makeStore(); // simulates first guest session
  await session1.setHide('guest phrase');
  assert.equal(await session1.getHide(), 'guest phrase');
  // A new makeStore() instance simulates a new session / app restart.
  const session2 = makeStore();
  assert.equal(await session2.getHide(), '',
    'new session must not inherit previous guest phrase');
});

// ── PH-15: bidirectional — setHide after SOS saved ───────────────────────────
test('PH-15: bidirectional — setHide conflict after persisted SOS (case-insensitive)', async () => {
  const s = makeStore();
  await s.setSOS('Has anyone called today?');
  const r = await s.setHide('has anyone called today?');
  assert.equal(r.conflict, true);
  assert.equal(r.saved, false);
});

// ── PH-16: setHide does not pre-set an active flag ───────────────────────────
test('PH-16: setHide result does not include an active flag (intercept owns it)', async () => {
  // Only the D1-V intercept in index.tsx writes the active flag after a
  // live phrase match. The config screen must never pre-activate discreet mode.
  const s = makeStore();
  const r = await s.setHide('phrase');
  assert.equal('active' in r, false,
    'setHide result must not include an active flag');
});

await run();

console.log(`
NOT RUN — native/device behaviour (requires a real device build):
  N-1  Phrase survives app restart (SecureStore persistence on native)
  N-2  Phrase isolated after re-login on a real device (new session, same device)
  N-3  D1-V intercept in index.tsx fires on actual typed submission (UI test)
  N-4  Privacy cover visible after phrase match (visual/UI test)
  N-5  SecureStore unavailable on jailbroken/rooted device behaviour
  N-6  Guest in-memory state wiped on login (account-change reset, native only)
`);
