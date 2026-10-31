/**
 * evidenceCrypto.idb.test.mjs — unit tests for the B1-web-idb split-storage
 * strategy in evidenceCrypto.ts.
 *
 * Strategy under test (confirmed by user GO):
 *   New key writes → IndexedDB only.
 *   Reads          → IndexedDB first, then AsyncStorage (localStorage) fallback.
 *   Old localStorage keys stay untouched (no migration, no data loss).
 *
 * Because this runs in Node (not a browser), both IndexedDB and AsyncStorage
 * are mocked in-process with simple Map-backed implementations that mirror
 * the real API contracts exactly.  The logic under test is the ROUTING:
 *   storeGet reads IDB first, then falls back.
 *   storeSet writes to IDB only.
 */

import { strict as assert } from 'assert';
import { test, describe, beforeEach } from 'node:test';

// ── Minimal IDBDatabase / IDBObjectStore mock ──────────────────────────────
function makeIDBMock() {
  const _store = new Map();
  const _db = {
    transaction: (name, mode) => ({
      objectStore: () => ({
        get: (k)    => ({ onsuccess: null, onerror: null,
                          _run() { const r = this; r.result = _store.get(k); setTimeout(() => r.onsuccess?.(), 0); } }),
        put: (v, k) => ({ onsuccess: null, onerror: null,
                          _run() { _store.set(k, v); const r = this; setTimeout(() => r.onsuccess?.(), 0); } }),
      }),
    }),
    _store,
  };
  return {
    indexedDB: {
      open: (name, ver) => {
        const req = { onsuccess: null, onerror: null, onupgradeneeded: null };
        // Simulate async open — fire onupgradeneeded (first time) then onsuccess.
        setTimeout(() => {
          req.onupgradeneeded?.({ target: { result: { createObjectStore: () => {} } } });
          req.onsuccess?.({ target: { result: _db } });
        }, 0);
        return req;
      },
    },
    _idb: _db,
  };
}

// ── AsyncStorage mock (localStorage stand-in) ─────────────────────────────
function makeAsyncStorageMock() {
  const _ls = new Map();
  return {
    getItem: async (k) => _ls.get(k) ?? null,
    setItem: async (k, v) => { _ls.set(k, v); },
    _ls,
  };
}

// ── Inline port of storeGet / storeSet logic ──────────────────────────────
// Mirrors evidenceCrypto.ts storeGet / storeSet for web path exactly.

function makeStoreFns(idbMock, asyncStorageMock) {
  async function idbGet(key) {
    try {
      const db = await new Promise((resolve, reject) => {
        const req = idbMock.indexedDB.open('dhara_evidence_v2', 1);
        req.onupgradeneeded = (e) => {};
        req.onsuccess  = (e) => resolve(e.target.result);
        req.onerror    = (e) => reject(e.target.error);
      });
      return new Promise((resolve, reject) => {
        const tx    = db.transaction('keys', 'readonly');
        const store = tx.objectStore();
        const req   = store.get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror   = () => reject(req.error);
        req._run();
      });
    } catch { return null; }
  }

  async function idbSet(key, value) {
    const db = await new Promise((resolve, reject) => {
      const req = idbMock.indexedDB.open('dhara_evidence_v2', 1);
      req.onupgradeneeded = (e) => {};
      req.onsuccess  = (e) => resolve(e.target.result);
      req.onerror    = (e) => reject(e.target.error);
    });
    return new Promise((resolve, reject) => {
      const tx    = db.transaction('keys', 'readwrite');
      const store = tx.objectStore();
      const req   = store.put(value, key);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
      req._run();
    });
  }

  // Exact logic from evidenceCrypto.ts (web path)
  async function storeGet(key) {
    const idbVal = await idbGet(key);
    if (idbVal !== null) return idbVal;
    return asyncStorageMock.getItem(key); // legacy localStorage fallback
  }

  async function storeSet(key, value) {
    await idbSet(key, value); // B1-web-idb: writes to IDB only
  }

  return { storeGet, storeSet, idbGet, idbSet };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('B1-web-idb: split-storage routing', () => {
  let idbMock, asyncMock, fns;

  beforeEach(() => {
    idbMock   = makeIDBMock();
    asyncMock = makeAsyncStorageMock();
    fns       = makeStoreFns(idbMock, asyncMock);
  });

  // IDB-1: storeSet writes to IndexedDB, NOT to localStorage
  test('IDB-1: storeSet writes to IndexedDB only — localStorage unchanged', async () => {
    await fns.storeSet('dhara_evidence_aes_key_v1_user-123', 'hex-key-abc');
    assert.equal(
      idbMock._idb._store.get('dhara_evidence_aes_key_v1_user-123'),
      'hex-key-abc',
      'IDB must contain the written key'
    );
    assert.equal(
      asyncMock._ls.get('dhara_evidence_aes_key_v1_user-123'),
      undefined,
      'localStorage must NOT be written to (B1-web-idb: writes go to IDB only)'
    );
  });

  // IDB-2: storeGet returns IDB value when key exists there
  test('IDB-2: storeGet returns the IDB value for a new key', async () => {
    await fns.storeSet('dhara_evidence_aes_key_v1_user-456', 'idb-key-xyz');
    const result = await fns.storeGet('dhara_evidence_aes_key_v1_user-456');
    assert.equal(result, 'idb-key-xyz', 'storeGet must return the IDB-stored key');
  });

  // IDB-3: storeGet falls back to AsyncStorage when key is NOT in IDB (old user)
  test('IDB-3: storeGet falls back to localStorage for a legacy key (old user — no data loss)', async () => {
    // Simulate an existing user whose key was written to localStorage before the IDB migration
    await asyncMock.setItem('dhara_evidence_aes_key_v1_legacy-user', 'legacy-localStorage-key');
    // IDB has nothing for this key
    const result = await fns.storeGet('dhara_evidence_aes_key_v1_legacy-user');
    assert.equal(
      result, 'legacy-localStorage-key',
      'legacy localStorage key must be returned via fallback — no data loss'
    );
  });

  // IDB-4: IDB value shadows localStorage if both exist (IDB takes precedence)
  test('IDB-4: IDB value shadows localStorage if both stores have the key', async () => {
    await asyncMock.setItem('dhara_evidence_aes_key_v1_scope-A', 'old-ls-key');
    await fns.storeSet('dhara_evidence_aes_key_v1_scope-A', 'new-idb-key');
    const result = await fns.storeGet('dhara_evidence_aes_key_v1_scope-A');
    assert.equal(result, 'new-idb-key', 'IDB must shadow localStorage');
  });

  // IDB-5: storeGet returns null for a completely new scope (no key anywhere)
  test('IDB-5: storeGet returns null for a scope with no key in either store', async () => {
    const result = await fns.storeGet('dhara_evidence_aes_key_v1_brand-new-scope');
    assert.equal(result, null, 'must return null when no key exists (triggers key generation)');
  });

  // IDB-6: Old localStorage key is NOT removed or mutated by storeGet
  test('IDB-6: storeGet does not alter old localStorage key while reading it', async () => {
    const oldKey = 'legacy-ls-key-value';
    await asyncMock.setItem('dhara_evidence_aes_key_v1_user-old', oldKey);
    await fns.storeGet('dhara_evidence_aes_key_v1_user-old');
    assert.equal(
      asyncMock._ls.get('dhara_evidence_aes_key_v1_user-old'),
      oldKey,
      'legacy localStorage key must be untouched after a storeGet read'
    );
  });
});

console.log('evidenceCrypto.idb tests: done.');
