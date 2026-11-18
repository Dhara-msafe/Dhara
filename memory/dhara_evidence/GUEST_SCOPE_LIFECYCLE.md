# Guest Scope Lifecycle — Recovery & Migration Design

**Status**: DESIGN ONLY — not yet implemented  
**Author**: DHARA Agent  
**Date**: 2026-06

---

## 1. The Problem

Guest users receive a real UUID as `user.id`; their evidence scope is `user.id`
(not `'device'`). When a guest JWT expires and `logout()` fires, three artefacts
become permanently orphaned under that UUID scope:

| Artefact | Location | Key / path |
|---|---|---|
| Encrypted `.enc` files | `Paths.document` | `dhara-evidence-<id>.enc` |
| Recordings manifest | AsyncStorage | `dhara_local_recordings_<uuid>` |
| AES-256-CTR key | SecureStore (iOS) / AES-GCM-wrapped (Android) | `dhara_evidence_key_<uuid>` |

Subsequent guest sessions generate a new UUID, so the old data is never
read again.  On a device that cycles through many guest sessions (demo kiosk,
shared device) this accumulates disk and SecureStore slots indefinitely.

---

## 2. Options Evaluated

### Option A — Migrate to `'device'` scope on logout

**Mechanism**: re-encrypt every `.enc` file with the `'device'` AES key on the
way out of the guest session.

**Pros**:
- Evidence survives and is immediately accessible to any subsequent guest.

**Cons**:
- Requires reading and re-encrypting every file — O(n × fileSize) CPU / RAM at
  logout time, potentially on a background thread just before the app is killed.
- OOM risk identical to the main `saveItem` path (see EVIDENCE_OOM_DESIGN.md).
- `'device'` scope has no authentication; anyone who unlocks the phone can
  access all previous guests' evidence in a shared-device scenario.
- **Verdict**: too risky for MVP — deferred until chunked crypto path exists.

### Option B — Deferred GC via guest scope registry (RECOMMENDED)

**Mechanism**:
1. Maintain `dhara_guest_scope_registry_v1` in AsyncStorage:
   ```json
   [ { "scope": "<uuid>", "createdAt": "ISO", "lastSeenAt": "ISO" } ]
   ```
2. On guest login: append a new entry.
3. On logout / expiry: update `lastSeenAt` for the entry.
4. On every cold start (AppState → `active`, once per session): scan the
   registry asynchronously for entries where `lastSeenAt` is > 30 days ago.
5. For each stale entry: delete its `.enc` files, AsyncStorage manifest keys,
   and SecureStore AES key — then remove the entry from the registry.
6. No re-encryption across scopes; no cross-guest data sharing.

**Pros**:
- Zero data loss on logout — the 30-day window gives the user time to register
  and claim (or at least export) their data.
- GC runs asynchronously off the critical path; the app is never blocked.
- Pairs cleanly with the eventual chunked crypto path.

**Cons**:
- Storage accumulates for up to 30 days per session — acceptable for MVP.
- Registry itself is a small AsyncStorage overhead (a few bytes per guest).

### Option C — Export prompt before expiry

If the app can detect imminent JWT expiry (or the user taps "End session"),
show a bottom-sheet: "Your session is ending. Export your evidence before it
becomes unavailable?" with a single-tap share flow.

**Verdict**: complementary to Option B, not an alternative. Good UX addition in
a future sprint once the deferred GC is in place.

---

## 3. Recommended Implementation Plan (Option B)

### Phase 1 — Guest scope registry (1–2 days)

```typescript
// src/women/guestScopeRegistry.ts

const REGISTRY_KEY = 'dhara_guest_scope_registry_v1';

export type GuestScopeEntry = {
  scope: string;      // user.id UUID
  createdAt: string;  // ISO
  lastSeenAt: string; // ISO — updated on every logout/expiry
};

export async function registerGuestScope(scope: string): Promise<void> { ... }
export async function touchGuestScope(scope: string): Promise<void> { ... }
export async function listStaleGuestScopes(olderThanMs: number): Promise<GuestScopeEntry[]> { ... }
export async function removeGuestScopeEntry(scope: string): Promise<void> { ... }
```

### Phase 2 — Deferred GC (1 day)

```typescript
// src/women/evidenceGC.ts

import { listStaleGuestScopes, removeGuestScopeEntry } from './guestScopeRegistry';
import { deleteEvidenceScope } from './evidenceStore'; // new export
import { deleteEvidenceKey }   from './evidenceCrypto'; // new export

export async function runDeferredGuestGC(): Promise<void> {
  const stale = await listStaleGuestScopes(30 * 24 * 60 * 60 * 1000); // 30 days
  for (const entry of stale) {
    await deleteEvidenceScope(entry.scope).catch(() => {});
    await deleteEvidenceKey(entry.scope).catch(() => {});
    await removeGuestScopeEntry(entry.scope).catch(() => {});
  }
}
```

Call `runDeferredGuestGC()` from the root `_layout.tsx` `AppState` handler,
limited to once per session, non-blocking:

```typescript
useEffect(() => {
  const sub = AppState.addEventListener('change', state => {
    if (state === 'active' && !gcRanThisSession.current) {
      gcRanThisSession.current = true;
      runDeferredGuestGC().catch(() => {});
    }
  });
  return () => sub.remove();
}, []);
```

### Phase 3 — Hook into auth.tsx (< 1 hour)

In `logout()`, if `user?.is_guest`:
```typescript
touchGuestScope(user.id).catch(() => {}); // mark lastSeenAt = now
// Do NOT delete immediately — let Phase 2 GC handle it after the grace period.
```

In `continueAsGuest()`, after creating the guest user:
```typescript
await registerGuestScope(guestUser.id).catch(() => {});
```

---

## 4. Data Safety Guarantees

- **No immediate deletion on logout/expiry** — data survives for 30 days.
- **Atomic GC per scope** — if GC fails mid-way, the entry stays in the
  registry and will be retried on the next cold start.
- **AES key deleted last** — files are unreadable once the key is gone;
  deleting files first means a mid-GC crash leaves unreadable but inert bytes.

---

## 5. Known Limitations (not addressed here)

- If the user force-quits the app immediately after a guest session without
  the app having a chance to `touchGuestScope()`, the `lastSeenAt` timestamp
  will be stale (from the previous login), which may extend the grace window.
  Mitigation: also call `touchGuestScope()` from `AppState → 'background'`.
- No cross-device syncing — evidence is device-local only.
- The 30-day window is not configurable per-deployment; a future operator
  config flag could expose this.
