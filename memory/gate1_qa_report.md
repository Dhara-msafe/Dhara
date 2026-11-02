# Gate 1 — Isolated QA Run Report (CT-1)

Date: 2 Nov 2026 · Repo HEAD `dc5f783` + test-only change to `destinationMapPicker.logic.test.mjs`

## Isolation method
- Second backend instance on `127.0.0.1:8002` with `DB_NAME=dhara_qa_g1` (env overrides .env; `load_dotenv` does not override).
  Shared preview DB `gandhikar_db` NOT touched. Corpus DB is shared **read-only** (no test writes to it).
- QA DB seeded with `seed_women_shield.py`, `seed_women_cards.py`, `seed_journeys.py` (note: the cards seed self-labels LEGAL_REVIEWED — QA-only).
- Synthetic users registered in QA DB only: voicetest2026@example.com, fir-test-user2@example.com, testpass_alpha@msafe.in, protest@gandhikar.in (same passwords as test_credentials.md).
- 15 test files excluded because they hardcode `localhost:8001`, `gandhikar_db`, or read DB_NAME from backend/.env (would hit shared data):
  lang_check, test_at43_bns_probe_verification, test_dhara_shield2_final_acceptance, test_evidence_vault_b5, test_evidence_vault_e2a2,
  test_head_out_places_autocomplete, test_p0_hotfix_live_verification, test_p1_grounding_fix, test_p1_map_authorization_boundaries,
  test_pro_samples_and_paywall, test_qa_brief_jan2026, test_refusal_analytics, test_safety_go1a, test_trusted_circle_permissions_revoke,
  test_women_shield_sprint_a. → To include them, they must be parameterised on env vars (follow-up task).
- Integrity: `data/approval_evidence_registry.json` and `ipc_bns_mapping.json` md5 unchanged after the run.
- Restart QA backend: `cd /app/backend && DB_NAME=dhara_qa_g1 python -m uvicorn server:app --host 127.0.0.1 --port 8002`
- Run: `DB_NAME=dhara_qa_g1 EXPO_PUBLIC_BACKEND_URL=http://127.0.0.1:8002 EXPO_BACKEND_URL=http://127.0.0.1:8002 python -m pytest <65 files>`

## Results
- Frontend: 7/7 test files pass (map test fixed — stale assertion after commit 9e737b9). `yarn test:voice` 108/108.
- Backend: **1,254 passed · 50 failed · 1 error · 3 skipped** (65 files, 1,308 tests, 5 m 27 s).

## Failure classification
| Group | Count | Class | Notes |
|---|---|---|---|
| Voice transcribe tests | 21 | ENV | Missing fixture `/tmp/test_audio.m4a` — tests depend on a file outside the repo |
| `testuser@gandhikar.in` login | 1 err | ENV | Account not in synthetic set |
| IPC §166A → BNS §199 approved-path tests (`test_layer_m_golden` 201/202/206/214, 301/303/308; `test_bugs_review_jan2026` ×2) | 9 | EXPECTED-FAIL-CLOSED / INVESTIGATE | Gate returns `invalid_approved_at` — consistent with "ship withheld"; 4 tests use their own fixture records, so confirm they are not failing on a date/clock issue |
| Guardian / journey public HTML page (`TestRevokeSharing` ×6, `TestJourneyStatus` ×3, `TestHTMLStatusPage` ×2, `TestGuardianPageMapRendering` ×2, `test_p1_per_type_permission_enforcement` ×1) | 14 | **REAL — INVESTIGATE (P1)** | Expected text ("Journey in progress", "Last known area", leaflet map, coordinates) missing from the served page. Guardian Share is ON for CT-1 |
| Gujarati SOS reply contains a Gurmukhi letter (U+0A15) | 1 | **REAL BUG (P1, EASY)** | `conversational_intents.py` `distress_sos` gu template |
| Danger check must run before C1 gate (`test_h1_legal_gates_contract`) | 1 | **REAL — SAFETY ORDERING (P0 investigate)** | Static ordering check in `chat_router.py` now fails |
| RTI §18 retrieval (`iteration_13`, `iteration_15` ×2) | 3 | REAL — retrieval ranking (P2) | Returns RTI 6/3 instead of 18 |
| Chat stream emits no citation/delta frames (`test_language_enforcement`, `TestChatStreamSanity`) | 2 | INVESTIGATE (P1) | Stream ends with `final` only |
