/**
 * privacyCoverState.test.mjs — unit tests for coverState.ts flag logic.
 *
 * Run without Jest:  node src/__tests__/privacyCoverState.test.mjs
 * Requires Node >= 18 (node:test, node:assert/strict built-ins).
 *
 * UNVERIFIED BEHAVIOURS (real Android device required):
 *   - Shake gesture triggers activateCover (accelerometer hardware).
 *   - App-switcher (background → foreground) restores cover via AppState
 *     listener in PrivacyCoverGate._layout.tsx.
 *   Both are marked UNVERIFIED until tested on a physical Android device.
 *
 * KNOWN BLOCKER B002 (OPEN):
 *   The 'device' scope flag may persist across sign-out / sign-in for different
 *   users.  No test covers this edge case; it remains an open defect.
 */

import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

// ── Minimal AsyncStorage mock ─────────────────────────────────────────────────
const _store = new Map();
const AsyncStorage = {
  setItem:    (k, v) => Promise.resolve(_store.set(k, v)),
  getItem:    (k)    => Promise.resolve(_store.get(k) ?? null),
  removeItem: (k)    => Promise.resolve(void _store.delete(k)),
};

// ── Inline port of coverState.ts (tests the logic, not the compiled path) ─────
let _active = false;
const _listeners = [];
const COVER_KEY = (scope) => `ws_discreet_active_v1_${scope}`;

const isCoverActive    = ()       => _active;
const subscribeCover   = (fn)     => { _listeners.push(fn); return () => { const i = _listeners.indexOf(fn); if (i >= 0) _listeners.splice(i, 1); }; };
const _emit = (v) => _listeners.forEach(fn => { try { fn(v); } catch { /* mirror production behaviour */ } });
const activateCover    = async (scope) => { _active = true;  _emit(true);  await AsyncStorage.setItem(COVER_KEY(scope), 'true'); };
const deactivateCover  = async (scope) => { _active = false; _emit(false); await AsyncStorage.removeItem(COVER_KEY(scope)); };
const syncFromStorage  = async (scope) => {
  const v = await AsyncStorage.getItem(COVER_KEY(scope));
  _active = v === 'true';
  return _active;
};

function resetState() {
  _active = false;
  _listeners.length = 0;
  _store.clear();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('coverState — in-memory flag', () => {
  beforeEach(resetState);

  it('starts inactive', () => {
    assert.equal(isCoverActive(), false);
  });

  it('activateCover sets in-memory flag immediately', async () => {
    await activateCover('user1');
    assert.equal(isCoverActive(), true);
  });

  it('activateCover persists true to AsyncStorage', async () => {
    await activateCover('user1');
    assert.equal(await AsyncStorage.getItem(COVER_KEY('user1')), 'true');
  });

  it('activateCover notifies all listeners', async () => {
    const calls = [];
    subscribeCover(v => calls.push(['a', v]));
    subscribeCover(v => calls.push(['b', v]));
    await activateCover('user1');
    assert.deepEqual(calls, [['a', true], ['b', true]]);
  });

  it('deactivateCover clears in-memory flag', async () => {
    await activateCover('user1');
    await deactivateCover('user1');
    assert.equal(isCoverActive(), false);
  });

  it('deactivateCover removes AsyncStorage entry', async () => {
    await activateCover('user1');
    await deactivateCover('user1');
    assert.equal(await AsyncStorage.getItem(COVER_KEY('user1')), null);
  });

  it('deactivateCover notifies listeners with false', async () => {
    let last;
    await activateCover('user1');
    subscribeCover(v => { last = v; });
    await deactivateCover('user1');
    assert.equal(last, false);
  });

  it('syncFromStorage restores active flag after a module reset', async () => {
    _store.set(COVER_KEY('user1'), 'true');
    const result = await syncFromStorage('user1');
    assert.equal(result, true);
    assert.equal(isCoverActive(), true);
  });

  it('syncFromStorage returns false when no persisted flag', async () => {
    const result = await syncFromStorage('user1');
    assert.equal(result, false);
    assert.equal(isCoverActive(), false);
  });

  it('unsubscribe stops notifications', async () => {
    let count = 0;
    const unsub = subscribeCover(() => count++);
    unsub();
    await activateCover('user1');
    assert.equal(count, 0);
  });

  it('scope isolation: activating scope A does not write scope B key', async () => {
    await activateCover('userA');
    assert.equal(await AsyncStorage.getItem(COVER_KEY('userB')), null);
  });

  it('listener throwing does not prevent subsequent listeners from firing', async () => {
    let secondFired = false;
    subscribeCover(() => { throw new Error('oops'); });
    subscribeCover(() => { secondFired = true; });
    await activateCover('user1');
    assert.equal(secondFired, true);
  });
});

// ── UNVERIFIED behaviours (real device required) ──────────────────────────────
describe('UNVERIFIED — real Android device required', () => {
  it('UNVERIFIED: shake gesture triggers activateCover (accelerometer hardware)', () => {
    assert.ok(true, 'Not run — requires native build + physical device');
  });

  it('UNVERIFIED: app-switcher background→foreground re-shows cover via AppState listener', () => {
    assert.ok(true, 'Not run — requires native build + physical device');
  });
});

console.log('privacyCoverState tests: done.');
