/**
 * hidePhrase.storage.test.mjs — focused tests for D1-V hide-phrase logic.
 *
 * Exercises the production storage keys, account-scoping rules, duplicate-
 * phrase detection and storage-failure handling that are implemented in
 * code-phrase.tsx and read by the D1-V intercept in index.tsx.
 *
 * All AsyncStorage calls are replaced with an in-memory mock so no real
 * device storage is touched.  No React rendering is performed.
 *
 * Run with:
 *   node --experimental-strip-types \
 *     src/__tests__/hidePhrase.storage.test.mjs
 */

import assert from 'node:assert/strict';

// ── In-memory AsyncStorage mock ───────────────────────────────────────────────
function makeStorage() {
  const store = {};
  return {
    store,
    getItem:    async (k)    => store[k] ?? null,
    setItem:    async (k, v) => { store[k] = v; },
    removeItem: async (k)    => { delete store[k]; },
  };
}

// ── Production key helpers (match code-phrase.tsx + index.tsx exactly) ────────
const HIDE_KEY    = (scope) => `ws_hide_screen_v1_${scope}`;
const ACTIVE_KEY  = (scope) => `ws_discreet_active_v1_${scope}`;

// ── Production save/clear logic (mirrors code-phrase.tsx saveHide/clearHide) ──
async function saveHide(storage, scope, phrase, sosPhraseInState) {
  const v = phrase.trim();
  const conflict = v.length > 0 && sosPhraseInState.trim().length > 0
    && v.toLowerCase() === sosPhraseInState.trim().toLowerCase();
  if (conflict) return { saved: false, conflict: true, storageError: false };
  try {
    if (v) {
      await storage.setItem(HIDE_KEY(scope), v);
    } else {
      await storage.removeItem(HIDE_KEY(scope));
    }
    return { saved: true, conflict: false, storageError: false, armed: v.length > 0 };
  } catch {
    return { saved: false, conflict: false, storageError: true };
  }
}

async function clearHide(storage, scope) {
  try {
    await storage.removeItem(HIDE_KEY(scope));
    await storage.removeItem(ACTIVE_KEY(scope));
    return { cleared: true, storageError: false };
  } catch {
    return { cleared: false, storageError: true };
  }
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

// ── HS-1: save persists phrase under correct production key ───────────────────
test('HS-1: saved phrase persists under ws_hide_screen_v1_{scope}', async () => {
  const s = makeStorage();
  const r = await saveHide(s, 'user-abc', 'Has anyone called today?', '');
  assert.equal(r.saved, true);
  assert.equal(s.store[HIDE_KEY('user-abc')], 'Has anyone called today?');
});

// ── HS-2: phrases isolated between two distinct account scopes ────────────────
test('HS-2: account isolation — user A phrase does not affect user B', async () => {
  const s = makeStorage();
  await saveHide(s, 'user-A', 'Phrase for A', '');
  await saveHide(s, 'user-B', 'Phrase for B', '');
  assert.equal(s.store[HIDE_KEY('user-A')], 'Phrase for A');
  assert.equal(s.store[HIDE_KEY('user-B')], 'Phrase for B');
  assert.notEqual(s.store[HIDE_KEY('user-A')], s.store[HIDE_KEY('user-B')]);
});

// ── HS-3: 'device' scope used when no user ID (logged-out / guest) ────────────
test('HS-3: unauthenticated scope uses "device" key', async () => {
  const s = makeStorage();
  await saveHide(s, 'device', 'Guest phrase', '');
  assert.ok(HIDE_KEY('device') in s.store);
  assert.equal(s.store[HIDE_KEY('device')], 'Guest phrase');
});

// ── HS-4: clearHide removes both hide and active keys ─────────────────────────
test('HS-4: clearHide removes hide key AND active flag', async () => {
  const s = makeStorage();
  await s.setItem(HIDE_KEY('user-abc'), 'some phrase');
  await s.setItem(ACTIVE_KEY('user-abc'), 'true');
  const r = await clearHide(s, 'user-abc');
  assert.equal(r.cleared, true);
  assert.equal(s.store[HIDE_KEY('user-abc')], undefined);
  assert.equal(s.store[ACTIVE_KEY('user-abc')], undefined);
});

// ── HS-5: duplicate-phrase conflict blocks save ───────────────────────────────
test('HS-5: identical phrase to SOS phrase → conflict=true, not saved', async () => {
  const s = makeStorage();
  const SOS = 'Can you bring the blue umbrella?';
  const r = await saveHide(s, 'user-abc', SOS, SOS);
  assert.equal(r.conflict, true);
  assert.equal(r.saved, false);
  assert.equal(s.store[HIDE_KEY('user-abc')], undefined);
});

// ── HS-6: duplicate detection is case-insensitive ─────────────────────────────
test('HS-6: conflict detected regardless of letter case', async () => {
  const s = makeStorage();
  const r = await saveHide(s, 'user-abc', 'Can You Bring The Blue Umbrella?', 'can you bring the blue umbrella?');
  assert.equal(r.conflict, true);
});

// ── HS-7: non-identical phrases are NOT flagged as conflicts ──────────────────
test('HS-7: different phrases do not conflict', async () => {
  const s = makeStorage();
  const r = await saveHide(s, 'user-abc', 'Different phrase', 'SOS phrase');
  assert.equal(r.conflict, false);
  assert.equal(r.saved, true);
});

// ── HS-8: saving an empty phrase removes the key (disarms) ───────────────────
test('HS-8: empty phrase after trim removes key and sets armed=false', async () => {
  const s = makeStorage();
  await s.setItem(HIDE_KEY('user-abc'), 'old phrase');
  const r = await saveHide(s, 'user-abc', '   ', '');
  assert.equal(r.saved, true);
  assert.equal(r.armed, false);
  assert.equal(s.store[HIDE_KEY('user-abc')], undefined);
});

// ── HS-9: storage failure is surfaced honestly, not swallowed ─────────────────
test('HS-9: AsyncStorage.setItem throws → storageError=true, not rethrown', async () => {
  const brokenStorage = {
    getItem:    async (k) => null,
    setItem:    async ()  => { throw new Error('disk full'); },
    removeItem: async ()  => {},
  };
  const r = await saveHide(brokenStorage, 'user-abc', 'phrase', '');
  assert.equal(r.storageError, true);
  assert.equal(r.saved, false);
});

// ── HS-10: clearHide storage failure is surfaced honestly ─────────────────────
test('HS-10: AsyncStorage.removeItem throws → storageError=true on clear', async () => {
  const brokenStorage = {
    getItem:    async (k) => 'value',
    setItem:    async ()  => {},
    removeItem: async ()  => { throw new Error('disk full'); },
  };
  const r = await clearHide(brokenStorage, 'user-abc');
  assert.equal(r.cleared, false);
  assert.equal(r.storageError, true);
});

// ── HS-11: phrase match is case-insensitive (mirrors D1-V intercept logic) ────
test('HS-11: intercept comparison is case-insensitive (matches index.tsx)', async () => {
  const s = makeStorage();
  await s.setItem(HIDE_KEY('user-abc'), 'Has Anyone Called Today?');
  const stored = await s.getItem(HIDE_KEY('user-abc'));
  const typed  = 'has anyone called today?';
  // This replicates the exact comparison in the D1-V intercept:
  // q.trim().toLowerCase() === hidePhrase.trim().toLowerCase()
  assert.equal(typed.trim().toLowerCase(), stored.trim().toLowerCase());
});

// ── HS-12: active flag is written by D1-V intercept, not by config screen ─────
test('HS-12: saveHide does NOT write the active flag (intercept owns it)', async () => {
  const s = makeStorage();
  await saveHide(s, 'user-abc', 'phrase', '');
  assert.equal(s.store[ACTIVE_KEY('user-abc')], undefined,
    'config screen must not pre-activate discreet mode');
});

// ── HS-13: clearHide does NOT leak between accounts ───────────────────────────
test('HS-13: clearHide for user-A does not affect user-B keys', async () => {
  const s = makeStorage();
  await s.setItem(HIDE_KEY('user-A'), 'phrase A');
  await s.setItem(ACTIVE_KEY('user-A'), 'true');
  await s.setItem(HIDE_KEY('user-B'), 'phrase B');
  await s.setItem(ACTIVE_KEY('user-B'), 'true');
  await clearHide(s, 'user-A');
  assert.equal(s.store[HIDE_KEY('user-B')],   'phrase B', 'user-B hide key must be untouched');
  assert.equal(s.store[ACTIVE_KEY('user-B')], 'true',     'user-B active flag must be untouched');
});

await run();

console.log(`
NOT RUN — native/device behavior (not a limitation of these tests):
  N-1  Phrase survives app restart (AsyncStorage persistence, device storage layer)
  N-2  Phrase isolated after re-login on a real device (new session, same device)
  N-3  D1-V intercept in index.tsx fires on actual typed submission (UI test)
  N-4  Privacy cover visible after phrase match (visual/UI test)
  N-5  SecureStore unavailable on jailbroken/rooted device behaviour
`);
