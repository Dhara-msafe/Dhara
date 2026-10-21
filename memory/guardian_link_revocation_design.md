# Guardian Link Revocation & Re-Invitation — Design Doc

Date: 21 Oct 2026 (session continuation)
Scope: `backend/api/journey_router.py`, `backend/api/alerts_router.py`,
`backend/api/trusted_circle_router.py` (read-only investigation, no change
needed), `frontend/app/women/guardian-share.tsx`,
`frontend/app/women/trusted-circle.tsx`.

Both GPS/location feature flags (`EXPO_PUBLIC_GO1B_GPS`,
`EXPO_PUBLIC_TRUSTED_CIRCLE_RECIPIENT`) remain **OFF**. No build, deploy,
or real SMS was triggered while producing this change.

---

## 1. Is the Guardian URL shared across recipients, or issued per-recipient?

**Shared. One token per journey, not per recipient.**

- `POST /api/journey/status` (journey_router.py) mints exactly **one**
  `token` per journey and stores it on a single `safety_journeys` document.
- `guardian-share.tsx::sendSMS` builds **one** SMS body containing that
  **one** `statusUrl`, and sends it via `Linking.openURL('sms:{phones}?body=...')`
  where `phones` is a **comma-joined list of every selected contact at once**
  — i.e. one native SMS composer intent, N recipients, identical link.
- The public page `GET /api/journey/status/{token}` (journey_router.py) is
  **fully anonymous** — it checks only: does the token exist, has it
  expired (`expires_at`, 24h TTL), and the journey's `status`/
  `sharing_revoked_at`. It never looks at `trusted_circle_links` or any
  permission record.
- `recipient_link_ids` *does* exist on the journey document, but it is
  consumed **only** by the separate, currently-flag-gated (OFF) in-app
  Alerts channel (`_notify_linked_recipients` → push + `safety_alerts`
  records, sanitized per-recipient by `alerts_router.py`). It has **no**
  relationship to the public status page/URL.

**Consequence:** there is no way today to distinguish "the person I meant
to send this to" from "anyone who received a forwarded copy of the link"
— both see identical content, because the token itself is the only check.
Any revocation that only closes the link for *one* of several recipients
is **not possible** without a different (per-recipient-token) architecture.

---

## 2. What is shipped in this pass (Tier 1 — zero migration)

**New concept: "withdraw sharing"**, distinct from "I arrived safely"
(`mark_safe`). It says "stop showing anyone anything new via this link",
with no claim about arrival — useful when plans change or the user simply
wants the link dead without lying about having arrived.

### Backend (`journey_router.py`)
- New field on `safety_journeys`: `sharing_revoked_at: Optional[str]`
  (ISO datetime, `None` by default). Kept **separate** from `status` so
  "safe" and "owner revoked" remain distinguishable states (different
  guardian-facing banner — see below) and so no existing `status == "safe"`
  check anywhere in the codebase silently changes meaning.
- New helper `_sharing_closed(rec) -> bool` = `status == "safe" OR
  sharing_revoked_at is set`. Used everywhere a journey needs to be
  treated as "no further updates should leave this record":
  - `update_location` (PATCH from the traveller's device) — now rejects
    further GPS pushes once closed (previously only checked "safe").
  - `report_missed_checkin` — now also skips once closed.
  - `report_help_requested` — **deliberately NOT gated by this.** "Need
    help" is a safety escape hatch; a user who revoked passive sharing
    earlier must still be able to summon help. This is intentional, not
    an oversight.
  - `journey_status_page` (public HTML) — withholds the location/map
    block whenever `_sharing_closed(rec)` is true, and renders a new,
    distinct status banner ("Sharing turned off by traveller", neutral
    grey/lock icon) instead of either "Arrived safely" (false claim) or
    "overdue" (alarming, wrong).
- New endpoint `POST /api/journey/status/{token}/revoke` (authenticated,
  owner-only, same auth shape as `mark_safe`). Idempotent. Fans out the
  previously-defined-but-never-used `"sharing_ended"` alert type to any
  accepted in-app Trusted Circle recipients for this journey.

### Backend (`alerts_router.py`)
- `_sanitize_location`'s journey-closed check now also treats
  `sharing_revoked_at` as closed (previously only `status == "safe"`), so
  the **in-app Alerts channel** gets the identical guarantee as the public
  page: once revoked, no last_location is served on **any** subsequent
  read (`GET /alerts`, `GET /alerts/{id}`), even for an alert that already
  existed with a raw location value baked in at creation time. Read paths
  always re-check the *live* journey record — never a cached value.

### Frontend (`guardian-share.tsx`)
- New "Withdraw sharing for this link" button (shown after SMS is sent,
  alongside "I have arrived safely"; hidden once either action is taken).
  Calls the new `/revoke` endpoint and shows a confirmation banner.

### What this does NOT do
- It does **not** add per-recipient revocation. Because the link is
  shared, "revoke" always closes it for **every** current holder at once
  — there is no way, with today's data shape, to revoke just one of
  several recipients while the others keep seeing live location. See §3.

---

## 3. Tier 2 (NOT implemented) — true per-recipient tokens

Required only if the owner needs to cut off **one** of several recipients
while the others continue seeing location. File-level plan, for approval
before any implementation:

- **`backend/api/journey_router.py`**
  - `create_journey`: accept a list of recipient descriptors (phone number
    for SMS contacts, or `link_id` for in-app Trusted Circle recipients)
    and mint **one token per recipient**, stored as a child array on the
    journey doc: `recipient_tokens: [{recipient_ref, token, revoked_at}]`.
    Keep a single parent "journey" (one `mark_safe`/`missed-checkin`/`help`
    event still applies to the whole journey — those are about the
    traveller's state, not about any one recipient).
  - `journey_status_page`: look up by token across
    `recipient_tokens[].token` (not just the legacy top-level `token`);
    check that specific sub-token's `revoked_at` **in addition to** the
    journey-level `_sharing_closed` check.
  - New endpoint: `POST /api/journey/status/{token}/recipients/{recipient_ref}/revoke`.
- **`frontend/app/women/guardian-share.tsx`**
  - The current UX — one multi-recipient SMS via
    `Linking.openURL('sms:{phones}?body=...')` — is **incompatible** with
    per-recipient links: each contact needs a *different* URL in a
    *different* SMS body. This means **one native SMS compose intent per
    contact** instead of one shared compose intent for all contacts — a
    real, user-visible UX change (N taps/confirmations instead of 1) that
    is an OS-level SMS-app limitation, not something that can be worked
    around. Needs explicit product sign-off before building.
  - `frontend/app/women/head-out.tsx`: the existing (currently dormant,
    flag-gated) `recipient_link_ids` plumbing would need extending to
    request/display one link per selected Trusted Circle recipient.
- **Migration implications**
  - `_TTL_HOURS = 24` means there is **no permanent legacy data** — any
    single-token journey in flight when this ships self-expires within
    24h. No destructive migration script is needed.
  - The only requirement during the ≤24h rollout window is that the
    GET-by-token lookup supports **both** shapes at once: the legacy
    top-level `token` field, and the new `recipient_tokens[].token`
    array. After the window, legacy-shape handling can be deleted.
  - This is strictly additive; existing already-sent links keep working
    exactly as before until they naturally expire.
- **Effort/risk:** materially larger than Tier 1 (new data shape + a real
  SMS-sending UX change + new tests). Recommended as a separate follow-up
  once Tier 1 is confirmed working, not bundled into this pass.

---

## 4. "Do not reuse a revoked token" — how this is guaranteed

- **Guardian journey tokens:** Tier 1 never mints a new token for an
  existing journey — revoking just flips `sharing_revoked_at` on the
  *same* record. A brand-new journey (new "Head out" / new SMS share)
  always calls `_new_token()`, which draws fresh `secrets.choice()`
  characters — never derived from, or equal to, any previous token.
- **Trusted Circle invite links:** `POST /trusted-circle/invite` always
  calls `str(uuid.uuid4())` for a new `link_id` — confirmed by reading
  `trusted_circle_router.py::invite()`. Re-inviting the same phone number
  after a revoke/decline creates an entirely new document; the old
  revoked/declined document is left untouched for history and never
  reactivated or reused.

---

## 5. Re-invitation bug — root cause and fix

**Root cause: frontend-only.** `trusted_circle_router.py::invite()` has
no uniqueness constraint and happily creates a new invite for a phone
number that already has a `revoked`/`declined` record — the backend was
never broken. The bug was entirely in
`frontend/app/women/trusted-circle.tsx`: once `inviteFor(ct)` resolved to
a `declined` or `revoked` record, the component rendered a dead-end
`<Text>` with no action — there was no way to trigger a new invite from
that screen.

**Fix:** both `declined` and `revoked` branches now render the existing
notice text **plus** an "Invite {name} again →" link that re-opens the
same permission-selection panel already used for first-time invites, and
calls the same `sendInvite(ct)` → `POST /trusted-circle/invite`. This
creates a fresh `pending` record with a fresh `link_id`; permissions are
re-chosen from scratch (old permissions are never silently carried over).
No backend changes were required.

---

---

## 6. Maps-key validation — does it run in Emergent's real Publish path?

The local Node simulation (see prior session) proves the `app.config.js`
function's *logic* is correct for all `platform` values. It does **not**
prove Emergent's managed Publish pipeline actually resolves config with
`platform: 'android'` set — that depends on how Emergent's build service
invokes Expo's config resolution internally (whether it calls
`expo prebuild --platform android` / `eas build -p android`, both of which
pass `platform` into `ConfigContext` per Expo's documented contract, vs.
some other invocation that might not). This could not be confirmed without
an actual Publish run, which is out of scope for this pass per explicit
constraints (no build/deploy/activation). A follow-up `deployment_agent`
check ran a general static scan (no blockers found) but did not have
visibility into this specific internal pipeline detail; `support_agent`
confirmed no Android signing keystore/SHA-1 exists yet for this project —
one is only generated on the first real Publish → Android build (safe, no
rotation since nothing exists yet), and the SHA-1 itself is only
obtainable afterward via an Emergent Support ticket referencing the build
job id, not queryable from this sandbox. **Flagged as a remaining,
unverifiable-without-a-real-build blocker.**

---

## 7. Addendum (second pass) — AsyncStorage persistence investigation, and revoke/mark_safe independence fix

### 7a. Persistence bug — root cause

Reproduced separately, using a real authenticated browser session (not raw
script injection) against the web preview:

- **Raw browser storage mechanics work correctly** on this web preview:
  `localStorage.setItem/getItem` survive full page reloads, client-side
  navigation, and origin stayed stable (`http://localhost:3000`) throughout
  — ruled out as a generic iframe/storage-partitioning problem.
- **The Language Onboarding Modal blocking automated clicks was the proximate
  cause of the earlier false "persistence failure" report**: on a FRESH
  session (no `lang_onboarded_v1_{uid}` key yet), the modal renders as a
  full-screen overlay; a scripted click that doesn't first dismiss it
  properly lands on the overlay, not the form underneath — so "Add to
  circle" never actually fires, which looks identical to "the write didn't
  persist." Once the modal is dismissed via its real Continue button first,
  **both** the language flag and Trusted Circle contacts save and persist
  correctly across refresh, navigation, and sign-out/sign-in as the same
  account (all re-verified live, see §7c).
- **Data is NOT lost** — it was **not restored to the UI in the test
  environment** because the write call never ran, not because a successful
  write vanished afterward.

### 7b. Real bug found and fixed — account-switch data leak (Trusted Circle + siblings)

While reproducing the above, a genuine, confirmed, reproducible bug was
found: `src/women/api.ts` stored Trusted Circle contacts (`ws_trusted_circle`),
safety-plan answers (`ws_safety_plan`), the check-in toggle
(`ws_checkin_enabled`), and the Silent Alert evidence preference
(`ws_silent_alert_evidence_pref`) under **flat, device-global AsyncStorage
keys** — not scoped per account — and `auth.tsx::logout()` never cleared
them. Live-verified: signing in as Account B after Account A had saved a
contact showed Account A's contact to Account B (screenshot captured).

**Fix (smallest change, no new schema/DB):**
- Added `getActiveUserId()` to `src/auth.tsx` — reads the same `gk_user`
  AsyncStorage key already written on every login/persist.
- `src/women/api.ts`: all four keys are now namespaced by the active
  account id (`${key}_${uid}`, falling back to a shared `guest` bucket only
  when nobody is signed in at all — an inherent limit of unauthenticated
  local storage, not fixable without requiring login). **Zero call-site
  changes** — `getCircle()`/`saveCircle()`/etc. keep the same signatures;
  only the internal key is now resolved per-account.
- One-time, self-guarding migration copies whatever was under the OLD flat
  key into whichever account reads it FIRST after this ships (matches prior
  behaviour for that one account, preserves existing data) and never runs
  again afterward (no leak to subsequent different accounts).
- This stays entirely **local/preference data** — it was never the
  authoritative store for accepted relationships, permissions, or
  revocation; those remain exactly where they already were, in
  `trusted_circle_links` on the backend, untouched by this fix. No new
  database or schema was introduced or needed.
- **Not fixed in this pass (flagged, same pattern):** `codePhraseStore.ts`'s
  `expo-secure-store` key is similarly device-global, not account-scoped.
  Out of the explicit scope of this request (code phrase, not Trusted
  Circle/contacts) — noted for a future pass if desired.

### 7c. Verification — web preview (native-device verification NOT performed, see below)

All of the following were verified live, in one continuous authenticated
browser session (not across separate/isolated automation runs, which would
incorrectly look like data loss due to fresh browser-context isolation,
not an app bug):
- Add contact → refresh page → contact still present. ✅
- Navigate to Head Out → back to Trusted Circle → contact still present,
  Head Out's "trusted circle is empty" warning correctly absent. ✅
- Sign out → sign back in as the **same** account → contact still present. ✅
- Sign in as a **different** account → previously, the first account's
  contact was visible (confirmed bug, screenshot captured) → **after the
  fix**, requires a fresh regression pass (see testing_agent call for this
  round) to confirm the leak is closed.

**Native-device verification was NOT performed** — this sandbox only has
access to the web preview via headless browser automation; a real
iOS/Android build was explicitly out of scope this session (no APK build
per your constraint). `AsyncStorage` on a real device uses SQLite/file
storage directly (unrelated to any browser storage mechanism), so this fix
should behave identically there, but that has not been device-verified.

### 7d. Revoke ↔ mark_safe — corrected to be independent (this supersedes §2's original wording)

The first version of this change made `mark_safe` a no-op after
`sharing_revoked_at` was set ("symmetric guard"). **This was wrong** and has
been reverted: a traveller who withdrew sharing must still be able to mark
themselves safe — revoking never claimed anything about arrival, so there
is nothing to protect by blocking it. Corrected design:
- `mark_safe` and `revoke_sharing` are now fully independent — either can
  be called in either order, each only guarded against being repeated on
  itself (idempotent), never against the other.
- `journey_status_page` has a dedicated **combined-state** label when both
  flags are set: *"Arrived safely (sharing had already been turned off —
  no location was shown for this update)"* — states both true facts
  instead of one overwriting the other.
- Coordinates/map stay hidden in **every** combination — driven solely by
  `_sharing_closed()` (status=="safe" OR sharing_revoked_at set), untouched
  by this fix.
- `guardian-share.tsx`: the "I have arrived safely" button is now always
  available (removed the incorrect `!revoked` hide-condition); the
  "Withdraw sharing" button still hides once used or once already marked
  safe (no functional value there — location is already hidden).

### 7e. Missed-check-in escalation — documented consequence, now surfaced in UI

Confirmed **intentional**: `report_missed_checkin` already skips once
`_sharing_closed(rec)` is true, including the revoke case — withdrawing a
link that can show nothing further also withdraws the passive
missed-check-in safety net tied to that same link. `report_help_requested`
(SOS/"Need help") is explicitly NOT gated this way and remains unaffected.
This is now called out explicitly in `report_missed_checkin`'s docstring,
and the **"Withdraw sharing" button in guardian-share.tsx now shows an
inline warning before the tap**: *"Note: if you withdraw sharing, your
guardian will NOT be notified even if you miss your check-in — the
missed-check-in alert is tied to this same link."* The post-action banner
also reiterates this and points out `mark_safe` is still available.

### 7f. Family-pilot plan — Tier 2 stays deferred; public links are NOT selectively revocable

Re-confirming §3: for the first family pilot, **authenticated in-app
recipients** (the existing, flag-gated `trusted_circle_links` +
`recipient_link_ids` channel) is the right model to extend with
per-recipient revocation if/when needed — that channel already has a real
per-recipient identity (`link_id`) to key off of. **Public SMS-shared
status links must continue to be presented to users as all-or-nothing**
(one shared link, one owner-level "withdraw sharing" switch) — they must
never be described in-app as selectively revocable per recipient, since
that is not true of the current architecture and would mislead a user
about what revoking actually does. No UI copy in this app claims otherwise
today; this is recorded here to guide future copy/feature decisions.


---

## 7g. Third pass — ownership-safe quarantine, fail-closed identity, codePhraseStore fix

The migration strategy in §7b was revised again after further review: no
longer "copy legacy data to whoever reads it first" (rejected as unsafe
ownership-guessing) but **quarantine-only** — legacy flat-key data moves,
once, into a private `*_legacy_unclaimed_v1` key that no `get*()` function
ever reads and no screen ever displays; preserved, not deleted, not
assigned to anyone. Live-verified: neither the first account to read nor
any other account auto-receives it.

Identity capture was hardened: `getActiveUserIdSync()` (a synchronous,
in-memory cache in `auth.tsx`, updated the instant `persist()`/`logout()`
run, before their own AsyncStorage I/O) replaced the earlier async
AsyncStorage re-read — closing a theoretical race where a save initiated
as one account could land under a different account's key if a fast
switch happened mid-write. Missing identity now fails closed with **no
shared "guest" bucket at all** (previously there was one): reads return
empty, writes are silently skipped.

`codePhraseStore.ts` was brought in line with the same pattern and a real
bug was found and fixed: its write path (`storePhrase`/`clearPhrase`) was
missing the try/catch its own read path already had, so saving on web
(where `expo-secure-store` has no implementation at all) crashed the
screen with an uncaught error. Fixed by mirroring the existing defensive
pattern, plus a new inline notice telling web-preview users this specific
feature needs the mobile app. **This feature is fundamentally untestable
for real persistence on web** — even same-account, same-session reads
return empty after any reload (`window.ExpoSecureStore === undefined`);
only a native build can verify actual cross-account isolation for the
code phrase.

Full frontend test matrix (9 scenarios × up to 4 preferences) executed by
`testing_agent` — 8/9 fully pass with live browser + localStorage
ground-truth evidence; the 9th (code-phrase) was blocked by the crash
above, now fixed and manually re-verified (crash gone, web notice shows).
Native/device behaviour remains **NOT RUN** — no physical device access in
this sandbox; do not assume it matches the browser.
