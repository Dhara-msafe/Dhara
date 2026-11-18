/**
 * Guest Scope Registry
 * --------------------
 * Tracks guest-session evidence scopes so the deferred GC
 * (`evidenceGC.ts`) can clean them up 30 days after the last activity,
 * preventing indefinite storage accumulation across repeated guest sessions.
 *
 * Design rationale: /app/memory/dhara_evidence/GUEST_SCOPE_LIFECYCLE.md
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const REGISTRY_KEY = 'dhara_guest_scope_registry_v1';

export type GuestScopeEntry = {
  scope: string;      // user.id UUID for this guest session
  createdAt: string;  // ISO 8601 — when the guest session started
  lastSeenAt: string; // ISO 8601 — updated on logout / expiry
};

async function readRegistry(): Promise<GuestScopeEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(REGISTRY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeRegistry(entries: GuestScopeEntry[]): Promise<void> {
  await AsyncStorage.setItem(REGISTRY_KEY, JSON.stringify(entries));
}

/**
 * Called when a guest session starts (`continueAsGuest`).
 * Idempotent — if the scope is already registered, createdAt is preserved
 * and lastSeenAt is refreshed.
 */
export async function registerGuestScope(scope: string): Promise<void> {
  const entries = await readRegistry();
  const existing = entries.findIndex(e => e.scope === scope);
  const now = new Date().toISOString();
  if (existing >= 0) {
    entries[existing].lastSeenAt = now;
  } else {
    entries.push({ scope, createdAt: now, lastSeenAt: now });
  }
  await writeRegistry(entries);
}

/**
 * Called when a guest session ends (logout / JWT expiry).
 * Updates `lastSeenAt` so the 30-day GC grace window runs from this moment.
 */
export async function touchGuestScope(scope: string): Promise<void> {
  const entries = await readRegistry();
  const idx = entries.findIndex(e => e.scope === scope);
  if (idx < 0) return; // not registered — nothing to touch
  entries[idx].lastSeenAt = new Date().toISOString();
  await writeRegistry(entries);
}

/**
 * Returns all entries whose `lastSeenAt` is older than `olderThanMs`
 * milliseconds ago.  These are candidates for deferred GC.
 */
export async function listStaleGuestScopes(
  olderThanMs: number,
): Promise<GuestScopeEntry[]> {
  const entries = await readRegistry();
  const cutoff = Date.now() - olderThanMs;
  return entries.filter(e => new Date(e.lastSeenAt).getTime() < cutoff);
}

/**
 * Removes an entry from the registry — called by the GC once a scope's
 * evidence and key have been successfully deleted.
 */
export async function removeGuestScopeEntry(scope: string): Promise<void> {
  const entries = await readRegistry();
  await writeRegistry(entries.filter(e => e.scope !== scope));
}
