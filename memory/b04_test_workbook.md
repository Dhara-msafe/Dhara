# B-04 Safety-Before-Gates — Test Workbook

Status: **IMPLEMENTED + AUTOMATED TESTED** — *not* ANDROID VERIFIED.
Android/real-device safety verification is still outstanding.

## Scope
- B-04a — guest at free-question quota (pre-existing).
- B-04b — expired guest session (401 gate).
- B-04c — exhausted Pro samples (402 gate).

Implementation: `backend/api/chat_router.py` — helper `_gate_safety_stream()` +
two call sites inside `chat_stream`. Committed in `40ff2d9`; unchanged since
(verified: `git diff 40ff2d9 HEAD -- backend/api/chat_router.py` is empty).

## B-04 automated test results

| File | Tests | Result |
|---|---|---|
| `backend/tests/test_b04bc_gate_safety.py` | 6 (HTTP end-to-end) | 6 passed |
| `backend/tests/test_b04bc_llm_spy.py` | 9 (in-process spy, state, flag, B-04a) | 9 passed |

Total **15 passed**, repeat run **15 passed**, post-run DB residue sweep across
11 user-linked collections: **0 rows**.

Covered:
1. Expired guest + immediate danger → deterministic 112 banner.
2. Expired guest + bare distress → SOS reply.
3. Exhausted Pro + immediate danger → deterministic 112 banner.
4. Exhausted Pro + bare distress → SOS reply.
5. Expired guest + ordinary message → still 401.
6. Exhausted Pro + ordinary message → still 402 (+ paywall audit row intact).
7. `FEATURE_C1_CONVERSATIONAL_REPLIES=off` → distress is not a bypass; danger still is.
8. B-04a SSE shape preserved (112 / SOS / `guest_limit_reached`).
9. Spy self-check — an unblocked user DOES trip the spy, so the
   "LLM never called" assertions are non-vacuous.

Side-effect assertions on all four safety paths: `guest_question_count`,
`pro_samples_used`, `blocked_paywall` message count and total message count
all unchanged.

Test-only hardening committed in `6ef44e5` (both test files, no source files).

## Unrelated pre-existing failures — NOT B-04 regressions

**8 failures across 3 categories** (full run of the regression set):

| # | Test | Category | Cause |
|---|---|---|---|
| 1 | `test_pro_samples_and_paywall.py::test_pricing_new_amounts_and_providers` | A — stale price expectation | expects `₹50`, config is `₹99` |
| 2 | `test_pro_samples_and_paywall.py::test_razorpay_config_returns_calviltech_link` | A | same stale `₹50` expectation |
| 3 | `test_pro_samples_and_paywall.py::test_pro_mode_samples_then_paywall` | A | 402 payload correct (`paywall`, `reason`, `samples_used=5`); fails only on `₹50` label |
| 4 | `test_safety_go1a.py::TestValidation::test_preset_radii_accepted` | B — accumulated test data | `/api/safety/places` 400 "Maximum 10 saved places reached" |
| 5 | `test_safety_go1a.py::TestValidation::test_custom_radius_accepted` | B | same saved-places cap |
| 6 | `test_safety_go1a.py::TestCRUD::test_create_and_list` | B | same saved-places cap |
| 7 | `test_safety_go1a.py::TestCRUD::test_edit_label_and_radius` | B | same saved-places cap |
| 8 | `test_c1_sos_distress_and_adaptive_chips.py::TestGuestCounterDistress::test_bare_distress_does_not_consume_guest_question` | C — environmental rate limit | `POST /api/auth/guest` → 429 "Too many guest sessions started from this network today" (daily per-IP cap exhausted by repeated runs) |

Category A evidence: identical 3 failures on pre-change baseline `52bee90`
(pre-change `chat_router.py` restored, backend restarted, suite re-run).
Category B: `/api/safety/places` router — no `chat_stream` involvement; the suite
reuses fixed accounts (`crud01`) whose 10-place cap is full from earlier runs.
Category C: passed earlier in the same session before the daily IP cap was hit;
the B-04b fixture was changed to stop depending on `/api/auth/guest` for this reason.

## Outstanding for B-04
- Real-device (Android build) verification of the 112 banner / SOS reply on the
  expired-guest and exhausted-Pro paths → required before ANDROID VERIFIED.

---

# B-16 Login Attempt Protection — Test Workbook

Status: **IMPLEMENTED + AUTOMATED TESTED (backend) + UI VERIFIED (web preview)** —
*not* ANDROID VERIFIED.

Approved behaviour: progressive delay on every failure; lock after 5 failures in
a 15-minute window with auto-unlock; counted per account AND per client IP;
clear 429 message with the wait time; email/password login only.

## Files
- `backend/services/login_guard.py` (new) — Mongo-backed counters, TTL index,
  atomic per-document increments (multi-worker safe), progressive delay.
- `backend/api/auth_router.py` — `POST /auth/login` gate only.
- `backend/server.py` — one idempotent TTL-index call at startup.
- `frontend/src/auth.tsx` — `_extractError` now reads a structured
  `detail {code, message, retry_after_seconds}` object (one block).
- `backend/tests/test_b16_login_attempt_protection.py` (new) — 10 tests.

## Backend results — 10/10 passed
1. 4 failures → 401, 5th → 429 with `retry_after_seconds` + `Retry-After` header.
2. Locked account refuses even the CORRECT password → gate runs before `check_pw`.
3. Lock persisted in MongoDB (`failures`, `lock_until`, `expires_at`), not memory.
4. Per-IP record written alongside the account record.
5. Successful login clears BOTH counters; next wrong password is 401, not 429.
6. Unknown email counted but response byte-identical to a known-email failure
   (no user enumeration).
7. Progressive delay measurably grows across attempts.
8. Ageing the window past 15 minutes auto-unlocks (correct password → 200).
9. The per-IP key is the forwarded client address, never the shared in-cluster
   pod IP (see finding below).
10. 5 failures sprayed across 5 different accounts from one address trips the
    per-IP lock, which the account counter alone would never catch.

## Finding during implementation — shared proxy IP (fixed before sign-off)
`request.client.host` inside this cluster is the ingress pod address (10.9.x.x),
which **every user shares** and which rotates between pods per request. The
playbook's "use request.client.host, never trust X-Forwarded-For" rule would
therefore have (a) locked out the entire user base after any 5 failures and
(b) leaked attempts across rotating pod IPs. Observed headers confirm the edge
sets `x-forwarded-for: <real client>,<cloudflare>,<gclb>`. `client_ip()` now
takes the left-most forwarded entry and returns `None` (IP dimension skipped)
when no forwarded header exists. Trade-off recorded in the module docstring: a
spoofed left-most entry only evades the per-IP counter, while the per-account
counter still stops the brute force.

## Frontend results (testing agent, report `/app/test_reports/iteration_73.json`)
All 6 requested checks passed: tries 1–4 show "Invalid credentials" with
growing delay (1.1s → 1.6s → 2.6s → 4.6s); try 5 shows exactly "Too many failed
sign-in attempts. Please try again in 15 minutes." (not the generic fallback);
correct password while locked is refused identically; message readable and
wrapped; normal sign-in unaffected; guest and Google buttons unaffected.

## Open items from the frontend pass — NOT B-16 regressions, not fixed
- **Medium:** on a 375px-wide screen the floating Help button overlaps the
  show/hide-password eye icon on the login screen; tapping the eye opens Help.
- **Minor:** the 8.6s delayed 5th attempt shows only a dimmed button — a spinner
  would stop it reading as a hang.
- **Minor:** the Google sign-in path reads `(await r.json()).detail` directly
  instead of `_extractError`, so a structured error there would render
  "[object Object]". Not reachable today.

## Outstanding
- Real-device (Android build) verification of the lockout message.
- 15-minute auto-unlock is covered by backend test 8 only; not observed in UI.
