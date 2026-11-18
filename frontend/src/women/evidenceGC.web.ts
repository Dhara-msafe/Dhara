/**
 * Deferred Guest Evidence GC stub — web
 * --------------------------------------
 * On web, evidence is stored as IndexedDB blobs (no filesystem paths).
 * Guest scopes accumulate small amounts of IndexedDB data, which the OS
 * manages automatically under storage pressure.  Full web GC can be
 * implemented in a future sprint; for now this is intentionally a no-op.
 */
export async function runDeferredGuestGC(): Promise<void> {
  // no-op on web
}
