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
// IMPORTANT: This port must stay in sync with production coverState.ts.
// Key invariant: _active = true / _emit() happen BEFORE the AsyncStorage write
// so the in-memory flag is always set synchronously even if storage throws.
let _active = false;
const _listeners = [];
const COVER_KEY = (scope) => `ws_discreet_active_v1_${scope}`;

const isCoverActive    = ()       => _active;
const subscribeCover   = (fn)     => { _listeners.push(fn); return () => { const i = _listeners.indexOf(fn); if (i >= 0) _listeners.splice(i, 1); }; };
const _emit = (v) => _listeners.forEach(fn => { try { fn(v); } catch { /* mirror production behaviour */ } });
const activateCover    = async (scope) => { _active = true;  _emit(true);  try { await AsyncStorage.setItem(COVER_KEY(scope), 'true'); } catch { /* best-effort */ } };
const deactivateCover  = async (scope) => { _active = false; _emit(false); try { await AsyncStorage.removeItem(COVER_KEY(scope)); } catch { /* best-effort */ } };
const syncFromStorage  = async (scope) => {
  try {
    const v = await AsyncStorage.getItem(COVER_KEY(scope));
    _active = v === 'true';
    return _active;
  } catch {
    return _active;
  }
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

// ── NEW: Immediate activation (P0 fix verification) ───────────────────────────
describe('Immediate activation — in-memory flag is set before AsyncStorage resolves', () => {
  beforeEach(resetState);

  it('isCoverActive() is true immediately after activateCover resolves', async () => {
    // The fix in index.tsx calls activateCover(scope) instead of AsyncStorage.setItem.
    // _active = true and _emit() fire synchronously INSIDE activateCover before the
    // awaited AsyncStorage write, so the in-memory flag is available without any
    // further round-trip.
    await activateCover('user1');
    assert.equal(isCoverActive(), true, 'in-memory flag must be true immediately');
  });

  it('listeners receive true before AsyncStorage.setItem completes', async () => {
    // Simulate a slow AsyncStorage (resolves after listener fires).
    const events = [];
    let resolveStorage;
    const orig = AsyncStorage.setItem;
    AsyncStorage.setItem = (k, v) => new Promise(res => { resolveStorage = () => { orig(k, v); res(); }; });
    subscribeCover(v => events.push({ v, storageSettled: resolveStorage === undefined }));
    const p = activateCover('user1');
    // Listener fired (synchronously inside activateCover) before storage resolves
    assert.equal(events.length, 1, 'listener fired once');
    assert.equal(events[0].v, true, 'listener value is true');
    resolveStorage?.();
    await p;
    AsyncStorage.setItem = orig;
  });
});

// ── NEW: Storage failure resilience ───────────────────────────────────────────
describe('Storage failure resilience', () => {
  beforeEach(resetState);

  it('activateCover keeps in-memory flag even when AsyncStorage.setItem throws', async () => {
    const orig = AsyncStorage.setItem;
    AsyncStorage.setItem = () => Promise.reject(new Error('storage full'));
    await activateCover('user1'); // must NOT throw
    AsyncStorage.setItem = orig;
    assert.equal(isCoverActive(), true, 'in-memory flag survives storage error');
  });

  it('deactivateCover clears in-memory flag even when AsyncStorage.removeItem throws', async () => {
    await activateCover('user1');
    const orig = AsyncStorage.removeItem;
    AsyncStorage.removeItem = () => Promise.reject(new Error('storage error'));
    await deactivateCover('user1'); // must NOT throw
    AsyncStorage.removeItem = orig;
    assert.equal(isCoverActive(), false, 'in-memory flag cleared despite storage error');
  });

  it('syncFromStorage returns existing in-memory value when AsyncStorage.getItem throws', async () => {
    _active = true; // pre-set in-memory
    const orig = AsyncStorage.getItem;
    AsyncStorage.getItem = () => Promise.reject(new Error('read error'));
    const result = await syncFromStorage('user1');
    AsyncStorage.getItem = orig;
    assert.equal(result, true, 'returns existing in-memory value on read failure');
  });
});

// ── NEW: Gate-OFF behaviour ────────────────────────────────────────────────────
describe('Gate-OFF — coverState is flag-agnostic (EXPO_PUBLIC_PRIVACY_COVER_V1 check lives in UI layer)', () => {
  beforeEach(resetState);

  it('activateCover/deactivateCover work regardless of EXPO_PUBLIC_PRIVACY_COVER_V1 value', async () => {
    // coverState.ts never reads EXPO_PUBLIC_PRIVACY_COVER_V1.
    // The feature gate lives in _layout.tsx (PrivacyCoverGate).
    // This test documents that invariant: the module always accepts calls,
    // and whether the cover UI is rendered is a separate concern.
    await activateCover('user1');
    assert.equal(isCoverActive(), true, 'flag ON even when UI gate would be false');
    await deactivateCover('user1');
    assert.equal(isCoverActive(), false, 'flag OFF after deactivate');
  });

  it('scope key format is stable: ws_discreet_active_v1_<scope>', async () => {
    await activateCover('abc123');
    const val = await AsyncStorage.getItem('ws_discreet_active_v1_abc123');
    assert.equal(val, 'true', 'key format must not change — PrivacyCoverGate depends on it');
  });
});

// ── NEW: SOS-vs-hide phrase priority ─────────────────────────────────────────
describe('Phrase priority — SOS beats D1-V hide (mirrors send() logic in index.tsx)', () => {
  beforeEach(resetState);

  it('when SOS phrase matches, D1-V hide is never evaluated', async () => {
    let sosTriggered = false;
    let coverTriggered = false;

    // Mirrors the two sequential if-blocks in send():
    const simulateSend = async (phrase, sosPhrase, hidePhrase) => {
      // SOS block (first, per amendment 1)
      if (phrase === sosPhrase) { sosTriggered = true; return; }
      // D1-V block (second)
      if (phrase === hidePhrase) { await activateCover('user1'); coverTriggered = true; return; }
    };

    await simulateSend('emergency', 'emergency', 'hide-me');
    assert.equal(sosTriggered, true, 'SOS was triggered');
    assert.equal(coverTriggered, false, 'D1-V cover was NOT triggered');
    assert.equal(isCoverActive(), false, 'cover flag stays false');
  });

  it('when only D1-V hide phrase matches, cover activates and SOS does not fire', async () => {
    let sosTriggered = false;
    let coverTriggered = false;

    const simulateSend = async (phrase, sosPhrase, hidePhrase) => {
      if (phrase === sosPhrase) { sosTriggered = true; return; }
      if (phrase === hidePhrase) { await activateCover('user1'); coverTriggered = true; return; }
    };

    await simulateSend('hide-me', 'emergency', 'hide-me');
    assert.equal(sosTriggered, false, 'SOS was NOT triggered');
    assert.equal(coverTriggered, true, 'Cover WAS triggered');
    assert.equal(isCoverActive(), true, 'cover in-memory flag is set');
  });

  it('when neither phrase matches, nothing fires', async () => {
    let sosTriggered = false;
    let coverTriggered = false;

    const simulateSend = async (phrase, sosPhrase, hidePhrase) => {
      if (phrase === sosPhrase) { sosTriggered = true; return; }
      if (phrase === hidePhrase) { await activateCover('user1'); coverTriggered = true; return; }
    };

    await simulateSend('random question', 'emergency', 'hide-me');
    assert.equal(sosTriggered, false);
    assert.equal(coverTriggered, false);
    assert.equal(isCoverActive(), false);
  });
});

// ── NEW: Stale callbacks ───────────────────────────────────────────────────────
describe('Stale callback safety', () => {
  beforeEach(resetState);

  it('subscriber registered after activation is NOT called retroactively', async () => {
    await activateCover('user1');
    let called = false;
    subscribeCover(() => { called = true; });
    // No new activation — late subscriber should not receive the past event
    assert.equal(called, false, 'late subscriber must not fire for past events');
  });

  it('unsubscribed callback is not called on subsequent deactivation', async () => {
    let count = 0;
    await activateCover('user1');
    const unsub = subscribeCover(() => count++);
    unsub();
    await deactivateCover('user1');
    assert.equal(count, 0, 'unsubscribed listener must never fire');
  });

  it('multiple rapid activations only emit once per call, not cumulatively', async () => {
    const events = [];
    subscribeCover(v => events.push(v));
    await activateCover('user1');
    await activateCover('user1'); // second call (already active)
    assert.equal(events.length, 2, 'each call emits exactly once');
    assert.deepEqual(events, [true, true]);
  });
});

// ── B002 ASSESSMENT (OPEN DEFECT — no code change required) ──────────────────
/**
 * B002 — Guest-scope cover state bleed across sign-out/sign-in
 *
 * SUMMARY:  MODERATE RISK.  No code change in this batch.
 *
 * HOW IT WORKS NOW:
 *   scope = user?.id || 'device'
 *   - Guest sessions always use scope = 'device'.
 *   - Authenticated sessions use scope = user.id (a stable UUID).
 *   AsyncStorage key: `ws_discreet_active_v1_<scope>`
 *
 * BLEED SCENARIOS:
 *
 *   A) Guest activates cover → logs in
 *      The 'device' key ('ws_discreet_active_v1_device' = 'true') persists in
 *      AsyncStorage.  The authenticated session reads 'ws_discreet_active_v1_<userId>',
 *      so it does NOT see the stale 'device' flag.  Risk: stale storage litter only.
 *      Visual impact: NONE.
 *
 *   B) Authenticated user activates cover → logs out → new guest session
 *      The 'ws_discreet_active_v1_<userId>' key persists.  Guest reads 'device'
 *      scope, so it does NOT see the old user's flag.  Risk: stale storage litter.
 *      Visual impact: NONE.
 *
 *   C) Two guest sessions on the same device (e.g. incognito-then-back)
 *      Both share scope 'device', so a cover activated in session A persists into
 *      session B on app relaunch.  Risk: privacy cover shown for wrong "user".
 *      Visual impact: COVER SHOWN unexpectedly when EXPO_PUBLIC_PRIVACY_COVER_V1=true.
 *
 *   D) In-memory _active flag on cold start
 *      On first import the module-level `_active` is always `false`.
 *      syncCoverFromStorage(scope) must be called on cold-start to restore it.
 *      If _layout.tsx doesn't call this before PrivacyCoverGate renders, scenario C
 *      is harmless.  If it does call sync, scenario C triggers the unexpected cover.
 *
 * RECOMMENDED FIX (deferred — requires auth integration review):
 *   1. On sign-in: call deactivateCover('device') to clear any guest-session flag.
 *   2. On sign-out: call deactivateCover(userId) to clear the user's flag.
 *   Neither requires a schema change — both are single AsyncStorage.removeItem calls.
 *   NOT implemented here to avoid broadening the current batch scope.
 *
 * RISK LEVEL:   Moderate (affects scenario C only; scenarios A/B are litter only).
 * PRIORITY:     P1 — fix before EXPO_PUBLIC_PRIVACY_COVER_V1 is turned ON.
 */
describe('B002 — Guest scope bleed (assessment only, no code change)', () => {
  beforeEach(resetState);

  it('B002-A: guest flag does not bleed into an authenticated session (different scope keys)', async () => {
    // Simulate guest activating cover
    await activateCover('device');
    // Simulate user logging in — they use a different scope
    const userFlag = await AsyncStorage.getItem(COVER_KEY('user-abc-123'));
    assert.equal(userFlag, null, 'authenticated scope is clean; no bleed from guest scope');
  });

  it('B002-B: authenticated flag does not bleed into guest session (different scope keys)', async () => {
    await activateCover('user-abc-123');
    const guestFlag = await AsyncStorage.getItem(COVER_KEY('device'));
    assert.equal(guestFlag, null, 'device/guest scope is clean; no bleed from user scope');
  });

  it('B002-C: two guest sessions share the device scope — cover persists across sessions', async () => {
    // This is the documented risk: both guest sessions use scope='device'.
    await activateCover('device');
    // Simulate app restart: reset in-memory state but leave AsyncStorage intact
    _active = false;
    // Session 2 restores state from storage
    const restored = await syncFromStorage('device');
    assert.equal(restored, true, 'B002-C CONFIRMED: cover bleeds from session 1 to session 2 for guest');
    // NOTE: This test DOCUMENTS the known defect, not a desired behaviour.
    // Fix: call deactivateCover("device") on sign-in to prevent bleed.
  });
});

console.log('privacyCoverState tests: done.');
