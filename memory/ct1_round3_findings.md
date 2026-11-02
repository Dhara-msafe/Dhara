# DHARA CT-1: Round 3 Findings and Bounded Proposals (no product code changed)

- Starting SHA for all tasks: `275651273a1b23fd3c50b4e3d8e9d2939b149c40` (`main`)
- Owner for all investigations: Emergent (main agent)
- Read-only for app code. Only this report file was added.

---

## TASK 1: QA Safety Switch (proposal only; needs approval)

### Today's outbound actions
See `ct1_security_and_intercepts.md` §1. Only Head Out has a code-level intercept.

### Proposed architecture: "QA Outbound Guard"
**One switch per side, failing closed.**
- Backend: `OUTBOUND_MODE`.
- Frontend: `EXPO_PUBLIC_OUTBOUND_MODE`.
- Values: `live` | `simulate`.
- **Fail-closed rule:** anything other than the exact string `live` (missing, misspelt, empty) means `simulate`.
- Production must set `live` explicitly. A deployment that omits it can only under-send, never over-send.

**Backend: a single choke point per provider.**
- `backend/services/outbound_guard.py` (new, about 40 lines) provides:
  - `outbound_live()`
  - `record_simulated(kind, target_hash, meta)`, which writes to the `qa_outbound_log` collection.
- `push.py::send_push`, `register_device`, `unregister_device`: in simulate mode, log and return. No HTTP call to the relay.
- `mailer.py::send_email`: in simulate mode, no Resend call.
  - The full email is written to `qa_outbound_log`. This is the "synthetic test inbox".
  - A QA-only endpoint `GET /api/qa/outbox?to=` reads it back. It exists only when `OUTBOUND_MODE != live` and requires `ADMIN_KEY`.
  - Password-reset OTP testing reads the code from there. No real mailbox is touched.
- `services/alerts.py` (ops email and Slack): same guard.
- `push_jobs.py::run_push_jobs_loop`: in simulate mode the loop **does not start** (guarded in `server.py:1874`).
  - The jobs are also guarded internally, so a manual call to `_run_daily_nudge` cannot send either.
- Trusted Circle invites and alerts (`trusted_circle_router.py:115`, `alerts_router.py:211`) go through `send_push`, so the guard covers them automatically. No router changes are needed.
- `/api/health` exposes `"outbound_mode"` so QA can check the mode before testing.

**Frontend: a single choke point for native actions.**
- New `src/outbound.ts` with:
  - `isOutboundLive()`
  - `openOutbound(url, kind)`, which handles `tel:`, `sms:` and `mailto:`
  - `composeSms(...)`
- Every `tel:`, `sms:` and `expo-sms` call site is routed through it. In simulate mode it shows an Alert: **"Simulated — nothing sent"**, plus the number and message for verification.
- Call sites: 18 files.
  - `src/women/helpActions.ts` (Silent Alert, `openPhone`)
  - `app/women/guardian-share.tsx`
  - `app/women/head-out.tsx` (replaces `ALERT_SIMULATION_MODE` and keeps the same label)
  - `app/women-shield.tsx`
  - `app/emergency.tsx` via `helpActions`
  - `app/action-plan.tsx`
  - `app/alerts/[id].tsx`
  - `app/fir-draft/index.tsx`
  - `app/fraud-checklist.tsx`
  - `app/missing/index.tsx`
  - `app/missing/result.tsx`
  - `app/visitor/emergency.tsx`
  - `app/visitor/intent.tsx`
  - `app/visitor/lost-passport.tsx`
  - `app/(tabs)/index.tsx`
  - `src/visitor/WorkflowScreen.tsx`
  - `src/components/ConsentPublicHelp.tsx`
  - `src/components/SOSButton.tsx`
  - `src/women/PrivacyCover.tsx`
- Push device registration (`src/push.ts`) is skipped in simulate mode.
- **Lint rule:** a static test fails if any `Linking.openURL(\`tel:|sms:` or `SMS.sendSMSAsync` appears outside `src/outbound.ts`. This stops new bypasses.
- A permanent "QA MODE: nothing is sent" banner is shown when not live.

**Production unchanged.**
- With `live`, every guarded function runs its current code path byte-for-byte.
- The only change in production is that `OUTBOUND_MODE=live` must be added to the production env.
- This is a deployment-checklist item. Without it, production fails safe by not sending.

### Test strategy
- Backend unit tests: the guard matrix (`live` / `simulate` / missing / garbage) × push / email / jobs / ops alerts.
  - The HTTP client is monkeypatched to assert **zero** outbound calls in simulate mode, and exactly one in live mode.
- Backend integration on the Gate-1 QA instance: forgot-password, then read the OTP from `/api/qa/outbox`, then reset succeeds.
  - Trusted Circle invite and alert are logged and never sent.
- Frontend unit tests: `outbound.ts` mode resolution, plus the static bypass scan across `app/` and `src/`.
- Device (QA person): every action in the table shows "Simulated — nothing sent". The dialler and SMS app never open.

### Acceptance criteria
1. In simulate mode, there are zero calls to the push relay, Resend, Slack, `tel:`, `sms:` or `expo-sms`, proven by tests.
2. The daily-nudge loop is not started in simulate mode.
3. A missing or misspelt flag behaves as simulate.
4. Live-mode tests show unchanged behaviour.
5. No `tel:` or `sms:` call remains outside `outbound.ts`.

- **Effort:** MEDIUM (about 22 files, mostly one-line call-site swaps).
- **Limitation:** OS-level actions outside the app, such as the user dialling 112 manually, cannot be intercepted.

---

## TASK 2: Immediate-danger check order (investigation)

### Files and functions
- `backend/api/chat_router.py::chat_stream` (line 324)
- `_is_immediate_danger` (153)
- `engine/conversational_intents.py`:
  - `is_bare_distress` (152)
  - `_BARE_DISTRESS_PHRASES` (43 phrases)
  - `is_denylisted`
  - `classify_conversational_intent`

### Actual decision sequence in `chat_stream`
1. Guest expiry and quota (337–397).
   - At 376–385 a `_c1_pre` check decides only whether to **count** a guest question. It does not route the message.
2. Pro paywall (412–449).
3. Session and user message saved (451–476).
4. **SOS fast-path (483–530).** `is_bare_distress()` returns the canned SOS template and **returns before `_emergency` is ever computed.**
5. Pre-retrieval, LLM prompt build, ... **`_emergency = _is_immediate_danger()` (1253).** This adds `_EMERGENCY_PROMPT` and filters DV acts.
6. Inside `event_gen`:
   - Bare-distress fallback, guarded by `not _emergency` (1461).
   - Then the C1 greeting gate, guarded by `not _emergency and not is_denylisted` (1475).
   - Then refusal, then the LLM.

### Reproduction (offline, functions called directly)
- All 43 `_BARE_DISTRESS_PHRASES`: **0** are also immediate-danger.
- Examples (bare / danger):
  - "help": True / False
  - "help me": True / False
  - "bachao": True / False
  - "बचाओ": True / False
  - "sos": True / False
  - "i need help": True / False
- Danger messages are never bare. For example:
  - "help me he is going to kill me": bare False / danger True / deny True. This goes to the full pipeline with the emergency prompt.
  - "help me i am in danger": bare False / danger True.
- Greeting gate: every danger message tested is deny-listed or not a C1 intent, so it never receives a canned greeting.

### Root cause
- **CONFIRMED (structural):** the SOS fast-path (483) runs before the danger check (1253). This was added in `0665482` / `ee5f972` (2026-11-01). This is exactly what `test_h1_legal_gates_contract` detects.
- **Behavioural bypass: NOT PROVEN.**
  - Bare phrases are whole-message, short and contain no threat term, so `_is_immediate_danger` is False for all of them.
  - The SOS reply itself lists 112 / 100 / 1091 / 181 / 1930.
  - The greeting gate is correctly ordered.

### Separate finding: danger-detection coverage gaps (not an ordering issue)
These go to the LLM path without the emergency prompt:
- "help me he has a knife"
- "help me i am being followed"
- "bachao maar dega" (romanised Hindi)
- "मुझे बचाओ"

The cause is that `_DANGER_RE` requires a time or state phrase in addition to `_THREAT_RE`.

### Smallest correction (proposal)
- Compute `_emergency = _is_immediate_danger(body.message)` once, before line 483.
- Guard the fast-path with `and not _emergency`, mirroring line 1461.
- No change to replies.

### Regression tests
- Keep the h1 ordering contract.
- Add a parametrised test: for every bare phrase the fast-path returns `c1_sos`. For a synthetic phrase that is both bare and danger (via monkeypatch), the fast-path is skipped.
- Coverage-gap tests are a separate decision (danger regex widening is a safety-content change).

---

## TASK 3: Guardian status page (investigation)

### The 14 failures (all inside the 53+1 below)
| Group | Tests |
|---|---|
| `test_guardian_link_revocation_and_reinvite::TestRevokeSharing` | 6 |
| `test_journey_status::TestJourneyStatus` (in_progress, arrived_safely, not_found) | 3 |
| `test_go1b_gps_journey::TestHTMLStatusPage` (last_known_area, not_found) | 2 |
| `test_p1_map_integration::TestGuardianPageMapRendering` (leaflet, referrer) | 2 |
| `test_p1_per_type_permission_enforcement` (payload visible) | 1 |

### Expected vs actual
- Tests expect "Journey in progress", "Arrived safely", "Last known area", coordinates, a leaflet map, 404 for unknown tokens, and `Referrer-Policy: strict-origin`.
- Actual: one identical static privacy page for every token, HTTP 200, no DB query, and `Referrer-Policy: no-referrer`.

### Root cause
**Intentional product change, not a regression.** Commit `c8569ec` (2026-10-25, "PR-1B1 Guardian Anonymous Metadata Containment"; docstring at `journey_router.py:546–575`) removed all journey data from the anonymous page and made unknown or expired tokens indistinguishable. The 13 HTML tests predate it and were not updated.

Remaining items:
- Referrer: the header is stricter than the test expects. But the page's `<meta name="referrer">` still says `strict-origin` (`journey_router.py:707`). That is an inconsistency and should be aligned to `no-referrer`.
- Per-type test: its fixture payload is only `{"destination": "QA"}`. PR-1B-A (`alerts_router.py:119–129`) now treats destination as location data and strips it when `temp_location=False`, so `{}` is correct behaviour. The test is stale.

### Access model now in place
- **Anonymous page:** nothing disclosed.
- **In-app guardian view** (`GET /api/journey/{token}/guardian`): login, accepted recipient and per-permission checks, all failing closed.
- **Journey token in alerts:** disclosed only with live `temp_location` consent.
- Risk in `ct1_security_and_intercepts.md` §2 is reduced, because the anonymous page no longer exposes data.
- Remaining risk: the token is shared per journey and appears in nginx logs. The in-app path is gated by login.

### Proposal
- Do **not** restore details.
- Update the 14 tests to assert the PR-1B1 contract: static page, no data, 200 for any token, `no-referrer`.
- Align the meta tag.
- Guardian stays out of CT-1 scope (`EXPO_PUBLIC_GUARDIAN_SHARE=false` for the build), pending founder security sign-off.

---

## TASK 4: Voice upload validation (proposal only)

### Endpoints
- `POST /api/voice/transcribe` (`chat_router.py:1782`, login required)
- **`POST /api/advocate/intake/{token}/transcribe` (`server.py:1416`, PUBLIC, token-scoped, cost billed to the advocate)**

Both call `whisper_transcribe`, which does `await audio.read()` with no size or type limit. nginx uses `client_max_body_size 0`, which means unlimited.

### Provider
OpenAI `whisper-1` (`engine/stt_engine.py:135`):
- Hard limit 25 MB.
- Accepts flac, m4a, mp3, mp4, mpeg, mpga, oga, ogg, wav, webm.

### Clients produce
- Native: `RecordingPresets.HIGH_QUALITY`, which is m4a/AAC at about 1 MB/min.
- Web: `audio/webm` or `audio/mp4`.

### Recommended limits
| Item | Value |
|---|---|
| Max size | **10 MB** (about 10 min, well beyond voice questions; under the provider's 25 MB) |
| Min size | 1 KB (reject empty uploads before spending) |
| Allowed types | m4a/mp4, webm, ogg, mp3, wav. The declared `content_type` must be in the allow-list **and** the magic bytes must match |

Magic-byte signatures:
- `ftyp` at offset 4: m4a/mp4
- `1A 45 DF A3`: webm
- `OggS`: ogg
- `ID3` or `FF Fx`: mp3
- `RIFF....WAVE`: wav

### Backend
- Read in chunks up to 10 MB + 1 byte.
- Over the limit: **413** "Recording is too long (max 10 MB). Please record a shorter message."
- Bad type or signature: **415** "This audio format isn't supported."
- Applied in `whisper_transcribe`, so both endpoints are covered.
- Usage metering happens **after** validation, so rejected files cost nothing.

### Frontend
- Before upload, check the blob or file size and the MIME type, and show the same messages.
- Optional auto-stop of recording at 9 minutes.

### Tests
- 0-byte, 999-byte, 10 MB exact, 10 MB + 1.
- A renamed `.exe` declared as m4a, a PNG, a valid m4a/webm/ogg/wav header.
- A public intake endpoint with an expired token.
- Confirm no Whisper call or meter increment on rejection.

### If excluded from CT-1
- Safest disablement: a server-side flag `VOICE_UPLOAD_ENABLED=false` that returns 503 from both endpoints. This works even against old app builds.
- Plus `EXPO_PUBLIC_STT_PROVIDER=none` to hide the mic.
- A UI-only hide is insufficient, because the public intake endpoint stays callable.

---

## TASK 5: Backend test reconciliation (re-run at the starting SHA)

### How it was run
1. `cd /app/backend && DB_NAME=dhara_qa_g1 setsid python -m uvicorn server:app --host 127.0.0.1 --port 8002 &`
2. `DB_NAME=dhara_qa_g1 EXPO_PUBLIC_BACKEND_URL=http://127.0.0.1:8002 EXPO_BACKEND_URL=http://127.0.0.1:8002 python -m pytest $(cat /tmp/qa_files.txt) -q -p no:cacheprovider --junitxml=/tmp/qa_g1.xml`
   - `/tmp/qa_files.txt` is the 65 `tests/test_*.py` files minus the 15 exclusions below.

### Result
**1251 passed · 53 failed · 1 error · 3 skipped (331.9 s).**
- Run 1 was 50 failed. The 3 extra failures are the guest per-IP daily limit (429) triggered by repeating the run on the same day.
- The registry and mapping md5 hashes were unchanged afterwards. The QA server was stopped.

### By class
| Class | Count |
|---|---|
| Environment | 25 |
| Stale test (PR-1B1 / PR-1B-A) | 14 |
| Expected fail-closed (withheld legal content) | 5 |
| Test fixture (stricter gate since 9e0a9b2) | 4 |
| Implementation, structural (Task 2) | 1 |
| Implementation defect (Gujarati SOS text) | 1 |
| NOT PROVEN (RTI ranking ×3, stream final-vs-delta ×1) | 4 |

- Earlier claim corrected: the Layer-M "invalid_approved_at" failures are **not** a clock bug. The fixture has `approved_at=None`.
- No assertion was weakened or changed.

### The 15 excluded files and why
| File | Evidence |
|---|---|
| lang_check.py | `BASE = "http://localhost:8001"` |
| test_at43_bns_probe_verification.py | `client["gandhikar_db"]` and the corpus DB, hard-coded |
| test_dhara_shield2_final_acceptance.py | reads `DB_NAME` from `backend/.env` |
| test_evidence_vault_b5.py | **hard-coded production `ADMIN_KEY` in the test source (secret in repo, security finding)** |
| test_evidence_vault_e2a2.py | localhost:8001 + `load_dotenv(.env)` |
| test_head_out_places_autocomplete.py | falls back to the preview URL `dhara-shield-2.preview…` |
| test_p0_hotfix_live_verification.py | reads `DB_NAME` from `.env` |
| test_p1_grounding_fix.py | `load_dotenv(.env)`, so it uses the shared DB |
| test_p1_map_authorization_boundaries.py | reads `DB_NAME` from `.env` |
| test_pro_samples_and_paywall.py | preview URL fallback + `"gandhikar_db"` |
| test_qa_brief_jan2026.py | `BASE_URL = "http://localhost:8001"` |
| test_refusal_analytics.py | `DB_NAME = "gandhikar_db"` |
| test_safety_go1a.py | localhost:8001 + `.env` |
| test_trusted_circle_permissions_revoke.py | `_load_backend_url()` reads the frontend `.env`, which is the preview URL |
| test_women_shield_sprint_a.py | reads `/app/frontend/.env` and `/app/backend/.env` |

### Full failure list
| # | Test | Kind | Feature | Classification |
|---|---|---|---|---|
| 1 | `test_h1_legal_gates_contract::test_c1_conversational_matcher_never_runs_before_the_danger_check` | FAIL | Chat safety order | IMPLEMENTATION (structural) — see Task 2 |
| 2 | `test_layer_m_golden.TestSectionCorrespondenceApprovalGate::test_201_approved_with_valid_record` | FAIL | Legal approval gate | TEST-FIXTURE — fixture lacks approved_at/artifact fields made mandatory in 9e0a9b2 (2026-10-31); 206 expects old reason 'revoked' (now 'revoked_approval'); 214 duplicate approval_id now 'conflicting_registry_records' |
| 3 | `test_layer_m_golden.TestSectionCorrespondenceApprovalGate::test_202_recheck_on_same_call_still_approved` | FAIL | Legal approval gate | TEST-FIXTURE — fixture lacks approved_at/artifact fields made mandatory in 9e0a9b2 (2026-10-31); 206 expects old reason 'revoked' (now 'revoked_approval'); 214 duplicate approval_id now 'conflicting_registry_records' |
| 4 | `test_layer_m_golden.TestSectionCorrespondenceApprovalGate::test_206_revoked_status_fails_closed` | FAIL | Legal approval gate | TEST-FIXTURE — fixture lacks approved_at/artifact fields made mandatory in 9e0a9b2 (2026-10-31); 206 expects old reason 'revoked' (now 'revoked_approval'); 214 duplicate approval_id now 'conflicting_registry_records' |
| 5 | `test_layer_m_golden.TestSectionCorrespondenceApprovalGate::test_214_multiple_records_only_one_valid_still_approves` | FAIL | Legal approval gate | TEST-FIXTURE — fixture lacks approved_at/artifact fields made mandatory in 9e0a9b2 (2026-10-31); 206 expects old reason 'revoked' (now 'revoked_approval'); 214 duplicate approval_id now 'conflicting_registry_records' |
| 6 | `test_guardian_link_revocation_and_reinvite.TestRevokeSharing::test_revoke_strips_location_immediately_old_and_forwarded_url` | FAIL | Guardian page | STALE TEST — public page intentionally static since PR-1B1 c8569ec |
| 7 | `test_guardian_link_revocation_and_reinvite.TestRevokeSharing::test_revoking_one_journey_does_not_affect_another` | FAIL | Guardian page | STALE TEST — public page intentionally static since PR-1B1 c8569ec |
| 8 | `test_guardian_link_revocation_and_reinvite.TestRevokeSharing::test_safe_transition_and_expiry_still_work_unaffected_by_revoke_feature` | FAIL | Guardian page | STALE TEST — public page intentionally static since PR-1B1 c8569ec |
| 9 | `test_guardian_link_revocation_and_reinvite.TestRevokeSharing::test_revoke_then_mark_safe_stays_independent_combined_state` | FAIL | Guardian page | STALE TEST — public page intentionally static since PR-1B1 c8569ec |
| 10 | `test_guardian_link_revocation_and_reinvite.TestRevokeSharing::test_safe_then_revoke_is_a_noop_other_order` | FAIL | Guardian page | STALE TEST — public page intentionally static since PR-1B1 c8569ec |
| 11 | `test_guardian_link_revocation_and_reinvite.TestRevokeSharing::test_concurrent_revoke_and_mark_safe_both_apply_coordinates_stay_hidden` | FAIL | Guardian page | STALE TEST — public page intentionally static since PR-1B1 c8569ec |
| 12 | `test_layer_m_golden.TestBnsIdentifierHypothesisGate::test_301_approved_includes_bns_section` | FAIL | Legal IPC166A→BNS199 | EXPECTED FAIL-CLOSED — production registry pending_human_review (content withheld) |
| 13 | `test_layer_m_golden.TestBnsIdentifierHypothesisGate::test_303_approved_streamed_content_same_as_direct` | FAIL | Legal IPC166A→BNS199 | EXPECTED FAIL-CLOSED — production registry pending_human_review (content withheld) |
| 14 | `test_layer_m_golden.TestBnsIdentifierHypothesisGate::test_308_same_session_follow_up_still_gated` | FAIL | Legal IPC166A→BNS199 | EXPECTED FAIL-CLOSED — production registry pending_human_review (content withheld) |
| 15 | `test_c1_sos_distress_and_adaptive_chips.TestSOSTemplateScripts::test_template_single_script[gu]` | FAIL | SOS reply (gu) | IMPLEMENTATION DEFECT — Gurmukhi ਕ in Gujarati SOS text |
| 16 | `test_voice_transcribe.TestWhisperSupportedSetMismatch::test_proxy_rejected_codes_must_not_500[bn]` | FAIL | Voice STT | ENVIRONMENT — fixture /tmp/test_audio.m4a not in repo |
| 17 | `test_voice_transcribe.TestWhisperSupportedSetMismatch::test_proxy_rejected_codes_must_not_500[te]` | FAIL | Voice STT | ENVIRONMENT — fixture /tmp/test_audio.m4a not in repo |
| 18 | `test_voice_transcribe.TestWhisperSupportedSetMismatch::test_proxy_rejected_codes_must_not_500[gu]` | FAIL | Voice STT | ENVIRONMENT — fixture /tmp/test_audio.m4a not in repo |
| 19 | `test_voice_transcribe.TestWhisperSupportedSetMismatch::test_proxy_rejected_codes_must_not_500[ml]` | FAIL | Voice STT | ENVIRONMENT — fixture /tmp/test_audio.m4a not in repo |
| 20 | `test_voice_transcribe.TestWhisperSupportedSetMismatch::test_proxy_rejected_codes_must_not_500[pa]` | FAIL | Voice STT | ENVIRONMENT — fixture /tmp/test_audio.m4a not in repo |
| 21 | `test_voice_transcribe.TestWhisperSupportedSetMismatch::test_proxy_rejected_codes_must_not_500[or]` | FAIL | Voice STT | ENVIRONMENT — fixture /tmp/test_audio.m4a not in repo |
| 22 | `test_voice_transcribe.TestWhisperSupportedSetMismatch::test_proxy_rejected_codes_must_not_500[as]` | FAIL | Voice STT | ENVIRONMENT — fixture /tmp/test_audio.m4a not in repo |
| 23 | `test_voice_transcribe.TestWhisperSupportedSetMismatch::test_proxy_rejected_codes_must_not_500[sa]` | FAIL | Voice STT | ENVIRONMENT — fixture /tmp/test_audio.m4a not in repo |
| 24 | `test_voice_transcribe.TestWhisperSupportedSetMismatch::test_proxy_rejected_codes_must_not_500[sd]` | FAIL | Voice STT | ENVIRONMENT — fixture /tmp/test_audio.m4a not in repo |
| 25 | `test_iteration_13_state_bookmarks_ni_cyber.TestRegression::test_mv_and_rti_retrieval[how do I complain if my RTI is ignored-RTI\\s*18|Section 18]` | FAIL | RTI retrieval | IMPLEMENTATION or TEST — NOT PROVEN (ranking) |
| 26 | `test_voice_transcribe.TestTranscribeWithLanguageHint::test_supported_language_accepted[en]` | FAIL | Voice STT | ENVIRONMENT — fixture /tmp/test_audio.m4a not in repo |
| 27 | `test_voice_transcribe.TestTranscribeWithLanguageHint::test_supported_language_accepted[hi]` | FAIL | Voice STT | ENVIRONMENT — fixture /tmp/test_audio.m4a not in repo |
| 28 | `test_voice_transcribe.TestTranscribeWithLanguageHint::test_supported_language_accepted[ta]` | FAIL | Voice STT | ENVIRONMENT — fixture /tmp/test_audio.m4a not in repo |
| 29 | `test_voice_transcribe.TestTranscribeWithLanguageHint::test_supported_language_accepted[mr]` | FAIL | Voice STT | ENVIRONMENT — fixture /tmp/test_audio.m4a not in repo |
| 30 | `test_voice_transcribe.TestTranscribeWithLanguageHint::test_supported_language_accepted[kn]` | FAIL | Voice STT | ENVIRONMENT — fixture /tmp/test_audio.m4a not in repo |
| 31 | `test_voice_transcribe.TestTranscribeWithLanguageHint::test_supported_language_accepted[ur]` | FAIL | Voice STT | ENVIRONMENT — fixture /tmp/test_audio.m4a not in repo |
| 32 | `test_voice_transcribe.TestTranscribeWithLanguageHint::test_supported_language_accepted[ne]` | FAIL | Voice STT | ENVIRONMENT — fixture /tmp/test_audio.m4a not in repo |
| 33 | `test_language_enforcement::test_citations_present_and_precede_deltas` | FAIL | Chat streaming | NOT PROVEN — stream used 'final' frame (sanitized path, chat_router.py:1616) not 'delta' |
| 34 | `test_journey_status.TestJourneyStatus::test_html_page_in_progress` | FAIL | Guardian page | STALE TEST — PR-1B1 c8569ec (static page, 200 for all tokens) |
| 35 | `test_journey_status.TestJourneyStatus::test_html_page_shows_arrived_safely` | FAIL | Guardian page | STALE TEST — PR-1B1 c8569ec (static page, 200 for all tokens) |
| 36 | `test_journey_status.TestJourneyStatus::test_html_page_not_found` | FAIL | Guardian page | STALE TEST — PR-1B1 c8569ec (static page, 200 for all tokens) |
| 37 | `test_iteration_15_sos_corpus.TestCorpusRetrieval::test_rti_for_ignored_complaint` | FAIL | RTI retrieval | IMPLEMENTATION or TEST — NOT PROVEN (ranking) |
| 38 | `test_iteration_13_state_bookmarks_ni_cyber.TestChatRetrievalIntegrity::test_rent_query_without_state_emits_state_prompt` | ERROR | Chat retrieval | ENVIRONMENT — testuser@gandhikar.in not in synthetic set |
| 39 | `test_iteration_15_sos_corpus.TestCorpusRetrieval::test_rti_for_ignored_complaint_ORIG` | FAIL | RTI retrieval | IMPLEMENTATION or TEST — NOT PROVEN (ranking) |
| 40 | `test_bugs_review_jan2026.TestBug1And2IPC166ABNS199Grounding::test_ipc_166a_has_dead_law_warning_and_successor` | FAIL | Legal IPC166A→BNS199 | EXPECTED FAIL-CLOSED — same withheld correction |
| 41 | `test_p1_per_type_permission_enforcement.TestPublicAlertRetroactivelyHidesNarrowedPermission::test_same_alert_type_visible_when_permission_is_granted` | FAIL | Trusted Circle alerts | STALE TEST — fixture payload only {'destination'}, stripped by PR-1B-A (destination = location data) when temp_location=False |
| 42 | `test_auth_cors_fix.TestGuestLoginCORS::test_guest_returns_200` | FAIL | Guest mode | ENVIRONMENT — guest-per-IP daily limit (429) hit by repeat runs |
| 43 | `test_auth_cors_fix.TestGuestLoginCORS::test_guest_response_is_json` | FAIL | Guest mode | ENVIRONMENT — guest-per-IP daily limit (429) hit by repeat runs |
| 44 | `test_go1b_gps_journey.TestHTMLStatusPage::test_html_page_shows_last_known_area` | FAIL | Guardian page | STALE TEST — PR-1B1 c8569ec |
| 45 | `test_go1b_gps_journey.TestHTMLStatusPage::test_html_page_not_found` | FAIL | Guardian page | STALE TEST — PR-1B1 c8569ec |
| 46 | `test_p1_map_integration.TestGuardianPageMapRendering::test_guardian_page_renders_leaflet_map_with_marker` | FAIL | Guardian page | STALE TEST — PR-1B1 removed map; header is stricter 'no-referrer' (meta tag still says strict-origin) |
| 47 | `test_p1_map_integration.TestGuardianPageMapRendering::test_guardian_page_sets_strict_referrer_policy` | FAIL | Guardian page | STALE TEST — PR-1B1 removed map; header is stricter 'no-referrer' (meta tag still says strict-origin) |
| 48 | `test_c1_sos_distress_and_adaptive_chips.TestGuestCounterDistress::test_bare_distress_does_not_consume_guest_question` | FAIL | Guest mode / SOS | ENVIRONMENT — guest-per-IP daily limit (429) |
| 49 | `test_c1_sos_distress_and_adaptive_chips.TestGuestCounterDistress::test_legal_help_consumes_guest_question` | FAIL | Guest mode / SOS | ENVIRONMENT — guest-per-IP daily limit (429) |
| 50 | `test_voice_transcribe.TestTranscribeUnsupportedLanguage::test_santali_sat_ignored_gracefully` | FAIL | Voice STT | ENVIRONMENT — fixture /tmp/test_audio.m4a not in repo |
| 51 | `test_voice_transcribe.TestTranscribeUnsupportedLanguage::test_garbage_language_code_ignored` | FAIL | Voice STT | ENVIRONMENT — fixture /tmp/test_audio.m4a not in repo |
| 52 | `test_bugs_review_jan2026.TestBug3MultiTurnCorrespondence::test_multiturn_ipc166a_then_bns_equivalent` | FAIL | Legal IPC166A→BNS199 | EXPECTED FAIL-CLOSED — same withheld correction |
| 53 | `test_voice_transcribe.TestTranscribeBackwardCompat::test_no_language_field_returns_text_shape` | FAIL | Voice STT | ENVIRONMENT — fixture /tmp/test_audio.m4a not in repo |
| 54 | `test_voice_transcribe.TestTranscribeAuth::test_missing_auth_returns_401` | FAIL | Voice STT | ENVIRONMENT — fixture /tmp/test_audio.m4a not in repo |


---

## TASK 6: TypeScript errors (45; `npx tsc --noEmit`; none fixed)

Build-blocking: **none.** The Expo/Metro build does not type-check and there is no `tsc` step in the build.

### A. Potential runtime or navigation impact (priority)
1. **`app/_layout.tsx:225`: CONFIRMED latent bug.**
   - `addNotificationTapListener` returns an `EventSubscription` object.
   - Cleanup calls `remove?.()`, which throws "remove is not a function" on unmount.
   - Dormant in CT-1, because it only runs when `EXPO_PUBLIC_TRUSTED_CIRCLE_RECIPIENT=true` (false).
   - Fix: `sub?.remove()`.
2. **`app/guardian/[token].tsx:230`: CONFIRMED minor.**
   - `onPress={fetchJourney}` passes the press event as `silent`, which is truthy.
   - So "Try again" refreshes without the loading state.
   - Fix: `onPress={() => fetchJourney()}`.
   - Guardian is out of CT-1 scope.
3. **`app/women-shield.tsx:283`: NOT PROVEN.**
   - Pushes `/(tabs)/index` with `q`. Typed routes do not know this path.
   - Runtime resolution of the explicit `/index` segment needs a device or web check.
   - Fix: `pathname: '/(tabs)'`.
   - Affects the "Campus security → Ask DHARA" row.
4. **`app/alerts/[id].tsx:62,79`: type only.**
   - The `permissions` default `{}` is untyped, and `setAlert` spread typing.
   - Runtime is unchanged (optional chaining). Recipient alerts are behind a flag that is off.
5. `app/women-shield.tsx:232`: `label` read from a scenario item without `label`. This renders `undefined` text, and needs a check of which field is displayed.
6. `app/(tabs)/me.tsx:172` and `app/login.tsx:254`: theme keys `errorSoft` and `errorContainer` don't exist, so the style gets `undefined` colour (transparent). Visual only.
7. `src/components/LanguageOnboardModal.tsx:310,392`: `fonts.heading` doesn't exist, so the default font is used. Visual only.

### B. Type-safety issues (no behaviour change expected)
- `photo_url` missing on `User`: me.tsx ×4, edit-profile.tsx ×5. The feature is behind `EXPO_PUBLIC_PROFILE_PHOTO=false`.
- `src/trustedCircle/api.ts` ×17: TS2769 on the request-helper overload.
- `src/analytics/index.ts:218,239`: PostHog props type.
- `src/userProfile.ts:315`: storage value type.
- `src/women/evidenceManifest.ts:34`: `Uint8Array` vs `BufferSource` (TS 5.7 lib change).
- `app/upgrade.tsx:172`: `source` field.
- `app/(tabs)/settings.tsx:521`: implicit any.
- `app/consent.tsx:94`: `lang` prop on SafeAreaView (ignored on native).

### C. Configuration or false positive
- `src/women/__tests__/safetyTriggerCoordinator.test.ts:51,119`: `.ts` import extension. Needs `allowImportingTsExtensions` or exclusion of tests from tsc.

### D. Unused or obsolete
- None identified with certainty. The `photo_url` code is reachable only with a feature flag that is off.

### Bounded fix proposal
- Fix only A1, A2 and A3 (3 one-line changes).
- Acceptance: those 3 errors are gone, the existing tests pass, and the web screenshot shows the campus-security row opening Ask DHARA with the prefilled question.

---

## TASK 7: Previous deliverables and T-01

### Files (in the repo; committed in 6769dec and 2756512)
- `memory/gate1_qa_report.md`
- `memory/release_flag_manifest_ct1.md`
- `memory/closed_test_tester_guide.md`
- `memory/ct1_security_and_intercepts.md`
- this file

**Download:** this environment has no file-download link. Use the platform's code download, or "Save to GitHub" once T-01 access exists.

### T-14 diff (commit 6769dec)
```
-test('PROVIDER_GOOGLE is used on Android via Platform.OS check', () => {
-  assert.ok(src.includes('PROVIDER_GOOGLE'));
-  assert.ok(src.includes("Platform.OS === 'android'"));
-});
-test('provider is undefined on iOS (Apple Maps default)', () => {
-  assert.ok(src.includes(': undefined'));
-});
+test('PROVIDER_GOOGLE is used on all platforms', () => {
+  assert.ok(src.includes('provider={PROVIDER_GOOGLE}'));
+});
+test('app.config.js wires Google Maps keys for both Android and iOS', () => {
+  const cfg = readFileSync('/app/frontend/app.config.js', 'utf8');
+  assert.ok(cfg.includes('googleMaps: { apiKey'), ...);
+  assert.ok(cfg.includes('googleMapsApiKey'), ...);
+});
```

Evidence that this matches the intended provider behaviour:
- `src/women/DestinationMapPicker.tsx:143` is `provider={PROVIDER_GOOGLE}` (unconditional).
- Introduced by commit `9e737b9`, "Google Maps — All Three Platforms Wired".
- `app.config.js` injects `android.config.googleMaps.apiKey` and `ios.config.googleMapsApiKey` (line 62).
- The new test also fails if either key wiring is removed, so it is **stronger** than before, not weaker.

### Commit 6769dec
- Author: platform auto-commit (`Callistus-Revert`).
- Files:
  - `frontend/src/__tests__/destinationMapPicker.logic.test.mjs` (+10/-8)
  - `memory/PRD.md`
  - `memory/closed_test_tester_guide.md`
  - `memory/gate1_qa_report.md`
  - `memory/release_flag_manifest_ct1.md`
- No application source.
- The follow-up `2756512` contains only `memory/PRD.md` and `memory/ct1_security_and_intercepts.md`.

**Pushed? No evidence of any push from this workspace:**
- `git remote -v` is empty.
- No `refs/remotes`.
- No credentials configured.

Whether the platform mirrors commits to GitHub out of band cannot be verified from here.

### T-01 exact remaining step
1. On GitHub: install the **Emergent GitHub App** on the `Dhara-msafe` organisation. Under "Repository access", grant `Dhara-msafe/Dhara` (Contents: read; write is only needed if you later use "Save to GitHub").
   - This needs an org owner, or approval of the install request by an org owner.
2. In Emergent: connect GitHub from the chat's GitHub / "Save to GitHub" control, choose `Dhara-msafe/Dhara`, and tell me the branch.
3. Then I run read-only:
   - `git ls-remote`
   - compare the branch HEAD with local `2756512`
   - `git diff --stat` of any divergence
