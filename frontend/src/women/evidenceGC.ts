/**
 * Deferred Guest Evidence GC (native)
 * ------------------------------------
 * Runs once per cold start (5 s after boot) and removes evidence data for
 * guest scopes that have been inactive for > 30 days.
 *
 * Deletion order: .enc files → AsyncStorage manifests → SecureStore AES key
 * (key is always last so a mid-GC crash leaves unreadable but inert bytes).
 *
 * Design: /app/memory/dhara_evidence/GUEST_SCOPE_LIFECYCLE.md
 */
import {
  listStaleGuestScopes,
  removeGuestScopeEntry,
} from './guestScopeRegistry';
import { deleteEvidenceScope } from './evidenceStore';
import { deleteEvidenceKey }   from './evidenceCrypto';

const GRACE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Run the deferred guest evidence GC.  Best-effort — any per-scope failure
 * is caught individually so one bad scope does not block the others.
 * Always resolves; never throws.
 */
export async function runDeferredGuestGC(): Promise<void> {
  let stale: Awaited<ReturnType<typeof listStaleGuestScopes>>;
  try {
    stale = await listStaleGuestScopes(GRACE_MS);
  } catch {
    return; // registry unreadable — skip silently
  }

  for (const entry of stale) {
    try {
      // 1. Delete all .enc files and AsyncStorage manifest keys for this scope.
      await deleteEvidenceScope(entry.scope);
      // 2. Delete the AES-256 key LAST — once gone, the data above is unreadable
      //    even if any .enc files survived (e.g. OS denied delete).
      await deleteEvidenceKey(entry.scope);
      // 3. Remove from registry only after both cleanup steps succeed.
      await removeGuestScopeEntry(entry.scope);
    } catch {
      // Leave the entry in the registry — it will be retried on the next cold start.
    }
  }
}
