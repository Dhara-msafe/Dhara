/**
 * Guest Evidence GC — MANUAL INVOCATION ONLY
 * -------------------------------------------
 * ⚠️  AUTOMATIC STARTUP CALL DISABLED (Jun 2026, user instruction).
 *     Do NOT call this function from any scheduled, timed, or lifecycle hook
 *     without explicit user approval and a completed recovery-flow design review.
 *
 * This function is preserved for future use in an explicit, informed,
 * user-initiated deletion flow only.  Guest evidence (.enc files and AES keys)
 * must persist indefinitely until the user consciously chooses to discard it.
 *
 * When an explicit deletion UI is approved, call this function ONLY after:
 *   1. The user has been shown what will be deleted and confirmed.
 *   2. The session that owns the data is unambiguously identified.
 *   3. No recovery window remains (or the user has dismissed the recovery prompt).
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
