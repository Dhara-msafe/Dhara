/**
 * coverState.ts — in-memory privacy cover flag with AsyncStorage persistence.
 *
 * The module-level boolean `_active` is the fast synchronous read; callers
 * can check isCoverActive() on first render without an async gap.
 * Callers supply a scope string so the persisted key stays account-isolated.
 *
 * B002 STATUS (2026-10-30):
 *
 *   FIXED (auth.tsx):
 *     A. Guest → authenticated login:
 *        persist() calls deactivateCover(prevScope='device') when prevScope≠newScope.
 *     B. Auth-A → Auth-B (account switch):
 *        persist() calls deactivateCover(prevScope=userId-A).
 *     D. Authenticated logout → guest:
 *        logout() calls deactivateCover(prevScope=userId).
 *     D2. Guest explicit logout:
 *        logout() calls deactivateCover(prevScope='device').
 *
 *   RESOLVED — B002-C Option 3 (this file, 2026):
 *     C. Two guest sessions with no explicit logout between them (e.g. force-close):
 *        An ephemeral session ID is generated on every cold start (by RootLayout
 *        via setGuestSessionId).  activateCover('device') persists that ID alongside
 *        the cover flag.  syncCoverFromStorage('device') rejects the stored flag
 *        when the session IDs don't match — i.e. a new cold-start of the app sees
 *        the stale flag and clears it rather than inheriting it.
 *        Authenticated scopes (scope !== 'device') are not affected; they never
 *        use GUEST_SESSION_ASYNC_KEY.
 *        EXPO_PUBLIC_PRIVACY_COVER_V1 remains OFF; this wiring is safe to activate
 *        at any time.
 *
 * PRIVACY CONTRACT:
 *   No phrase or user data passes through this module — it carries a boolean only.
 *
 * GATE: callers must check EXPO_PUBLIC_PRIVACY_COVER_V1 before calling these
 *   functions.  This module is unconditionally imported but does nothing harmful
 *   when called with the flag off because it only toggles a boolean.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export const COVER_ASYNC_KEY = (scope: string): string =>
  `ws_discreet_active_v1_${scope}`;

/**
 * AsyncStorage key used by B002-C Option 3 to persist the guest session ID
 * alongside the cover flag.  Only written for scope='device' (guest users).
 */
export const GUEST_SESSION_ASYNC_KEY = 'ws_guest_session_v1';

// ── In-memory flag ────────────────────────────────────────────────────────────
let _active = false;

// ── B002-C Option 3: ephemeral guest session ID ───────────────────────────────
// Set once per cold start from RootLayout (_layout.tsx) via setGuestSessionId().
// Null until setGuestSessionId() is called (i.e. before RootLayout mounts) so
// that the session-ID check is only applied once the cold-start ID is known.
let _guestSessionId: string | null = null;

// ── Listener emitter ──────────────────────────────────────────────────────────
type CoverListener = (active: boolean) => void;
const _listeners: CoverListener[] = [];

function _emit(active: boolean): void {
  _listeners.forEach(fn => {
    try { fn(active); } catch { /* never allow a listener to break the cover */ }
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Synchronous: returns the in-memory flag without an AsyncStorage round-trip. */
export function isCoverActive(): boolean { return _active; }

/**
 * B002-C Option 3: register the ephemeral guest session ID for this cold start.
 * Call once from RootLayout useEffect (empty deps) before the first
 * syncCoverFromStorage('device') call.  Safe to call when the flag is OFF.
 *
 * Only affects the 'device' scope (guests).  Authenticated users use
 * scope=user.id in all coverState calls, so their settings are unaffected.
 */
export function setGuestSessionId(id: string): void {
  _guestSessionId = id;
}

/** Returns the current in-memory guest session ID (null if not yet set). */
export function getGuestSessionId(): string | null {
  return _guestSessionId;
}

/** Subscribe to cover state changes.  Returns an unsubscribe function. */
export function subscribeCover(fn: CoverListener): () => void {
  _listeners.push(fn);
  return () => {
    const i = _listeners.indexOf(fn);
    if (i >= 0) _listeners.splice(i, 1);
  };
}

/**
 * Activate the cover: set in-memory flag, notify listeners,
 * then persist to AsyncStorage (best-effort).
 */
export async function activateCover(scope: string): Promise<void> {
  _active = true;
  _emit(true);
  try { await AsyncStorage.setItem(COVER_ASYNC_KEY(scope), 'true'); } catch { /* best-effort */ }
  // B002-C Option 3: bind this cover activation to the current cold-start
  // session so syncCoverFromStorage can detect and clear stale covers from
  // previous guest sessions.  Only applies to scope='device'; authenticated
  // scopes never use GUEST_SESSION_ASYNC_KEY.
  if (scope === 'device' && _guestSessionId !== null) {
    try { await AsyncStorage.setItem(GUEST_SESSION_ASYNC_KEY, _guestSessionId); } catch { /* best-effort */ }
  }
}

/**
 * Deactivate the cover: clear in-memory flag, notify listeners,
 * then remove from AsyncStorage (best-effort).
 */
export async function deactivateCover(scope: string): Promise<void> {
  _active = false;
  _emit(false);
  try { await AsyncStorage.removeItem(COVER_ASYNC_KEY(scope)); } catch { /* best-effort */ }
}

/**
 * Read AsyncStorage and sync the in-memory flag.
 * Call on cold start and on AppState 'active' return to cover the gap between
 * a persisted flag and a freshly-loaded module.
 * Returns the resolved boolean.
 *
 * B002-C Option 3: for the guest ('device') scope, compares the stored session
 * ID against the current cold-start session ID.  If they differ (= a new
 * cold-start that didn't get an explicit logout), the stale cover is cleared
 * silently and false is returned.  Authenticated scopes bypass this check.
 */
export async function syncCoverFromStorage(scope: string): Promise<boolean> {
  try {
    // Session-ID guard: only active for the guest scope once the cold-start
    // ID has been registered via setGuestSessionId().
    if (scope === 'device' && _guestSessionId !== null) {
      const storedSession = await AsyncStorage.getItem(GUEST_SESSION_ASYNC_KEY);
      if (storedSession !== null && storedSession !== _guestSessionId) {
        // The persisted cover belongs to a different guest session.
        // Clear it so the new session starts uncovered (shared-device safety).
        _active = false;
        try { await AsyncStorage.removeItem(COVER_ASYNC_KEY(scope)); } catch {}
        try { await AsyncStorage.removeItem(GUEST_SESSION_ASYNC_KEY); } catch {}
        return false;
      }
    }
    const v = await AsyncStorage.getItem(COVER_ASYNC_KEY(scope));
    _active = v === 'true';
    return _active;
  } catch {
    return _active; // keep existing in-memory value on read failure
  }
}
