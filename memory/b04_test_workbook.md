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
