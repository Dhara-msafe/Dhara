# DHARA — Open items

Repo-tracked follow-ups that are explicitly **not** being built now. Nothing in
this file is approved for implementation until a separate, scoped request.

## NF-SAFETY-01 (14 Nov 2026) — outbound-guard follow-ups

### 1. Frontend outbound profile has no build-time guard (open)
`backend/services/outbound_guard.py` now refuses to **start the server** if
`DEPLOYMENT_ENV` is missing, or if `DEPLOYMENT_ENV=preview` and the effective
`OUTBOUND_PROFILE` isn't `internal_qa` (see `validate_outbound_config()`,
tested in `backend/tests/test_deployment_env_guard.py`). There is no
equivalent for the frontend: `EXPO_PUBLIC_OUTBOUND_MODE` and
`EXPO_PUBLIC_OUTBOUND_PROFILE` (`frontend/src/outbound.ts`) are baked into the
JS bundle at Expo build time — there is no server process to refuse to start,
so the same fail-closed pattern doesn't transfer directly.

**Rule (documented, not yet enforced by tooling):** a production/release
build must set `EXPO_PUBLIC_OUTBOUND_MODE` and `EXPO_PUBLIC_OUTBOUND_PROFILE`
*deliberately* — never by leaving preview's values in place.

Why no build-time check was added today: the only hook point available
(`frontend/app.config.js`, which runs in Node at build/bundle time) can
confirm a value is *present*, but cannot distinguish a value someone set on
purpose for this release from a value simply left over from preview — both
look identical at that point. A check that can only produce a weak, possibly
misleading guarantee wasn't built today rather than making one that looks
safe without being complete.

Options for a scoped follow-up request, if wanted:
- A one-line assertion in `app.config.js` that **fails the build** unless a
  new, release-specific variable (e.g. `EXPO_PUBLIC_RELEASE_CONFIRMED=1`) is
  also set alongside a non-`internal_qa` profile — forces a human to touch
  something new for every real release, instead of silently inheriting
  whatever preview had.
- A pre-build checklist step in the deploy pipeline (human-checked, not code).

### 2. Could not verify — client-side dispatch history before 14 Nov 2026
Client-composed dialler/SMS/share calls (`frontend/src/outbound.ts`) happen
entirely on-device; there is no server log for them. Whether anyone tapped a
real "Call"/"Send" button from the Expo Go app on a physical phone while this
preview was configured `EXPO_PUBLIC_OUTBOUND_MODE=live` /
`EXPO_PUBLIC_OUTBOUND_PROFILE=production` (true before today, fixed today —
see `frontend/.env`) **cannot be verified** from the code or any log
available in this environment.

### 3. Could not verify — backend logs before 2026-11-03
`/var/log/supervisor/backend.err.log` only retains entries back to
2026-11-03. Every startup line in that window reads
`OUTBOUND_MODE=simulate profile=internal_qa` (0 occurrences of
`profile=production`/`profile=closed_testing`), and the `qa_outbox`
collection's oldest entry is 2026-11-04 with 0 `decision=live` documents out
of 751 — but nothing before 2026-11-03 could be checked.

### 4. Production deployment requirement — read before deploying this backend change
`backend/services/outbound_guard.py`'s `validate_outbound_config()` now requires
`DEPLOYMENT_ENV` to be set. **Before this backend change reaches production,
production's real configuration must set `DEPLOYMENT_ENV=production`** (not
`preview`) — if it's missing, the production server will refuse to start.
This is a deploy-time checklist item, not something changeable from preview.

### 5. Test helpers changed by the DEPLOYMENT_ENV guard (for review)
Two pre-existing test files called `validate_outbound_config()` without the
now-mandatory `DEPLOYMENT_ENV` variable, which would otherwise fail them for
an unrelated reason (the new guard, not what they were testing). Both were
pinned to `DEPLOYMENT_ENV=production` — the value that adds no extra
restriction — so their original intent still holds:
- `backend/tests/test_outbound_guard.py` — `_set(monkeypatch, value)` helper.
- `backend/tests/test_outbound_policy.py` — `_env(monkeypatch, mode=None, profile=None, email_key=None)` helper.

