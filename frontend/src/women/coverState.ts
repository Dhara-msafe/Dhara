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
 *   OPEN — PRODUCT DECISION REQUIRED (see reconciliation §3):
 *     C. Two guest sessions with no explicit logout between them (e.g. force-close):
 *        Both use scope='device'. Cover from session 1 persists to cold-start
 *        of session 2 via AsyncStorage. Cleared only when the user explicitly
 *        logs in (scenario A) or logs out (D2) — not by a cold start alone.
 *        Remediation options recorded in V0/V1 reconciliation; the fix depends
 *        on a product decision about whether cover should survive a guest
 *        cold-start (user intent) or be cleared (shared-device safety).
 *        EXPO_PUBLIC_PRIVACY_COVER_V1 is currently OFF; no visual impact.
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

// ── In-memory flag ────────────────────────────────────────────────────────────
let _active = false;

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
 */
export async function syncCoverFromStorage(scope: string): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(COVER_ASYNC_KEY(scope));
    _active = v === 'true';
    return _active;
  } catch {
    return _active; // keep existing in-memory value on read failure
  }
}
