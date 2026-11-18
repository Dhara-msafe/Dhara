# Guest Evidence Recovery — Ownership & Access-Prevention Design
**Status:** DESIGN REVIEW — no UI code written, no deletion button implemented.  
**Author:** Dhara Engineering  
**Date:** June 2026  
**Prerequisite:** Automatic 30-day GC has been disabled (see `evidenceGC.ts` and `_layout.tsx`).

---

## 1. What exists on-device for a guest session

| Storage | Key pattern | Content | Access restriction |
|---|---|---|---|
| `AsyncStorage` | `dhara_evidence_manifest_v1_<scope>` | Recording metadata list (filename, IV, auth_format, timestamps) | No OS-level protection |
| `expo-file-system` | `<documentDirectory>/dhara_local_recordings_<scope>/*.enc` | AES-256-CTR ciphertext blobs | Readable only by the app (iOS Sandbox / Android app-private storage) |
| `SecureStore` | `dhara_evidence_key_<scope>` | AES-256 key (32-byte hex) | iOS Keychain / Android Keystore — **hardware-backed, app-exclusive** |
| `AsyncStorage` | `dhara_guest_scope_registry_v1` | `[{ scope, createdAt, lastSeenAt }]` | No OS-level protection |

`scope` = the `user.id` UUID generated at `continueAsGuest()` time.

---

## 2. Ownership model: device-possession

Guest sessions do not authenticate against a server.  There is no password, biometric,
or server-side identity attached to guest evidence.  The only proof of "I own this
recording" is **physical possession of the device that made the recording**.

This is the same model used by local note-taking apps, voice memo apps, and local
photo libraries.  It is appropriate for the threat model (the user protecting their
own recordings from someone else who does NOT have the phone).

**Corollary:** a recovery prompt shown to a returning guest on the SAME device is
sufficient proof of ownership — no additional verification step is needed as long
as the prompt is shown ONLY to the holder of the device.

---

## 3. How cross-account / cross-scope access is prevented

### 3a. AES key isolation
Each guest scope has its own AES-256 key stored under a scope-keyed SecureStore entry
(`dhara_evidence_key_<scope>`).  The scope is a UUID generated fresh per guest session.

A second user who logs into a registered account on the same device CANNOT:
- Read the guest's AES key (different SecureStore key name).
- Decrypt the guest's `.enc` files (wrong key → every per-chunk HMAC fails).
- Read the guest's manifest (different AsyncStorage key name).

### 3b. No scope ID inference
Scope UUIDs are randomly generated (`uuid v4` from the backend `continueAsGuest`
endpoint).  An authenticated user on the same device cannot enumerate guest scopes
without reading `dhara_guest_scope_registry_v1` from AsyncStorage, which is not
exposed through any in-app UI.

### 3c. Registered-to-guest escalation path
If a registered user later uses `continueAsGuest`, they receive a **new** scope UUID
and a **new** AES key.  Their prior authenticated evidence (stored under their account
UUID) is inaccessible to the new guest scope.

### 3d. Device transfer / factory reset
If the device is wiped or the app is uninstalled, all three storage layers are cleared
by the OS.  Guest evidence does not survive.  This is acceptable and aligns with the
no-server-backup design.

---

## 4. Recovery prompt trigger

**Trigger condition:**  
On `continueAsGuest()`, after a fresh guest UUID has been assigned and before
the user reaches any recording screen, check `dhara_guest_scope_registry_v1`:

```
If registry contains ≥ 1 entry with a scope != current session's scope
  AND that scope has ≥ 1 recording in its AsyncStorage manifest
  → show the recovery bottom-sheet
```

**What must NOT trigger the prompt:**
- Session expiry.
- App backgrounded / foregrounded.
- App restart after a crash.
- Logout by a registered user (registered accounts own separate evidence).

---

## 5. Recovery prompt content (proposed copy)

```
You have X prior recording(s) from [date of most recent lastSeenAt].

These are encrypted and stored only on this device.
No one else can access them.

  [ Keep recordings ]     [ Discard recordings ]
```

- **Keep recordings:** No action taken.  Current session continues.  The existing
  scope(s) remain in the registry with refreshed `lastSeenAt`.  The user can play
  back prior recordings from the Evidence Locker.
- **Discard recordings:** See §6 — explicit deletion flow.

---

## 6. Explicit deletion flow design (pending implementation)

The discard path is NOT a "back to default" tap.  It must be:

1. **Labelled clearly:**  "Delete X recording(s) permanently.  This cannot be undone."
2. **Require a second confirmation:**  A destructive-action sheet with "Delete permanently"
   as a red destructive button, alongside "Cancel".
3. **Non-reversible confirmation screen:**  After the second tap, show a progress
   indicator while `deleteEvidenceScope()` + `deleteEvidenceKey()` + `removeGuestScopeEntry()`
   run in that order.
4. **Never triggered automatically:**  Session expiry, logout, app restart, and time
   elapsed are explicitly NOT triggers.

Deletion order remains: `.enc files → AsyncStorage manifest → SecureStore AES key`.
This ensures that if the device is interrupted mid-delete, the surviving `.enc` files
are still protected by an intact key (readable by the user) rather than leaving
orphaned plaintext.

---

## 7. What this document does NOT cover

- Multi-device sync of guest evidence (not in scope — guest evidence is local-only).
- Server-side backup of guest evidence (not in scope — no account to attach it to).
- Biometric re-auth before playing back evidence (future security layer, not part
  of the recovery prompt).
- Migration of guest evidence to a new registered account (future feature).

---

## 8. Open questions for review

| # | Question | Decision (Jun 2026) |
|---|---|---|
| Q1 | Should the recovery prompt show individual recording names / durations? | **Full list with filenames, durations, and dates** — implemented. |
| Q2 | If the user has multiple previous guest scopes, should all scopes be presented? | **Each session shown separately** — implemented. Per-session Keep/Discard. |
| Q3 | Should "Keep" silently merge prior scope into the current session scope? | **Kept as-is** — data stays under original scope/key. No re-keying. The Evidence Locker shows current-session recordings only; multi-scope Evidence Locker display is a future enhancement. |
| Q4 | Is there a maximum number of guest scopes before the registry is considered stale / auto-cleaned? | **No automatic cleaning** — confirmed. Registry entries are never deleted automatically. |

---

## 9. Files to change when implementation is approved

| File | Change |
|---|---|
| `src/women/guestScopeRegistry.ts` | Update JSDoc — no code change needed |
| `src/women/evidenceGC.ts` | Wire `runDeferredGuestGC` / per-scope deletion to explicit call site only |
| `app/(tabs)/evidence-locker.tsx` or new `app/guest-recovery-modal.tsx` | New bottom-sheet component |
| `src/auth.tsx` → `continueAsGuest()` | Add registry check + prompt trigger after scope assignment |
