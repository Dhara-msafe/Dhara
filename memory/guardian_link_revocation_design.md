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
constraints (no build/deploy/activation). Flagged as a **remaining
blocker** — see summary sent to the user for the `deployment_agent` /
`support_agent` follow-up on this specific point.
