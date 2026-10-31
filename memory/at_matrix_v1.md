# DHARA Voice — AT01–AT48 Acceptance Test Matrix (V1 Correction Batch)

Generated: 2026-10-30 (row evidence)  
Corrected: 2026-10-31 (arithmetic fix; AT40/AT43/AT15/AT34 re-classification; footer reconciliation; commits 51cb6ea · 01651f2 · 6a61077)  
Updated: 2026-10-31 (DHARA approval-gate completion GO — Steps 2–7; commits 3de2e57 · 4704e8b · 81974ba)  
Batch: V1 correction and verification (commits a396260..277ba66 + ba17351)  
Total tests: **48** (unique IDs, no duplicates)

> **Source-revision / test-date note:** The revision cited in each row is the commit that last changed the test outcome. A passing run against an earlier revision is historical evidence — it is not a regression guarantee against HEAD. Source revision and test date are separate facts; treat each row independently.

> **Pilot readiness:** This matrix does not constitute a pilot readiness determination. AT43 has two open sub-claims (authorized reviewer approval, substantive claim support). AT40 is not implemented. AT45 and the AT34 UI layer are untested at the device level. Legal-release containment and Guardian authorization are open.

Legend:
- ✅ PASS  — verified by automated test or source inspection (evidence below)
- 🔶 PARTIAL — cited sub-claims pass; remaining sub-claims remain open (see row notes)
- ⚠ CHANGE REQUIRED — code must change before this can pass
- ❌ NOT IMPLEMENTED — no handler exists in the codebase; must be designed and built before a test can be written
- 🔲 NOT RUN — handler implemented but not yet exercised (requires native device build / live environment)
- 🔍 BOUNDARY-INSPECTED — outbound paths confirmed intercepted by source analysis; UI not reachable via web automation
- 📋 SOURCE-VERIFIED — verified by source-code inspection only (no runtime execution)

---

## AT01–AT10: Language Detection and Hint Routing

| ID   | Description | Status | Evidence |
|------|-------------|--------|----------|
| AT01 | 9 proxy-rejected Indian codes (bn/te/gu/ml/pa/or/as/sa/sd) produce first Whisper call with NO language kwarg | ✅ PASS | BR-1..BR-9 in test_stt_engine.py (63 tests pass; source rev 0a5b27f) |
| AT02 | 7 probe-verified codes (hi/en/mr/kn/ur/ne + ta-IN→ta) produce first call with correct language hint | ✅ PASS | BR-10..BR-16 in test_stt_engine.py (source rev 0a5b27f) |
| AT03 | BCP-47 normalisation: "ta-IN" → "ta" before hint-set lookup | ✅ PASS | B-9/TA-1..TA-3 in test_stt_engine.py (source rev 0a5b27f) |
| AT04 | Language-hint rejection (unsupported_language) triggers exactly ONE retry | ✅ PASS | BR-17 in test_stt_engine.py (source rev 0a5b27f) |
| AT05 | Retry (second) call strips the language hint — never repeats it | ✅ PASS | BR-18 in test_stt_engine.py (source rev 0a5b27f) |
| AT06 | Unexpected 400 without "language" in message → no retry, exception propagates | ✅ PASS | BR-19 in test_stt_engine.py (source rev 0a5b27f) |
| AT07 | Rejected-code auto-detect path never retries even on a language-flavoured 400 | ✅ PASS | BR-20 in test_stt_engine.py (source rev 0a5b27f) |
| AT08 | Both Whisper attempts fail → exception propagates to caller | ✅ PASS | B-8/TA-9 in test_stt_engine.py (source rev 0a5b27f) |
| AT09 | Tamil BCP-47 variants (ta-IN, ta-LK, TA) all normalise to "ta" hint | ✅ PASS | TA-1..TA-4 in test_stt_engine.py (source rev 0a5b27f) |
| AT10 | Non-language Tamil error (audio_too_short) does NOT trigger retry | ✅ PASS | TA-10 in test_stt_engine.py (source rev 0a5b27f) |

---

## AT11–AT20: Audio Session and Microphone Arbitration

| ID   | Description | Status | Evidence |
|------|-------------|--------|----------|
| AT11 | Mic arbiter: claim from unknown owner fails closed (Evidence Locker not displaced) | ✅ PASS | H1/arbiter — unknown owner test (yarn test:voice 108/108; source rev 51cb6ea; 2026-10-31) |
| AT12 | Mic arbiter: released claim cannot be reused by a forged handle | ✅ PASS | H1/arbiter — isActive=false for forged handle (source rev 51cb6ea) |
| AT13 | Mic arbiter: preempted owner must re-claim (release does not restore it) | ✅ PASS | H1/arbiter — preempted owner must re-claim (source rev 51cb6ea) |
| AT14 | Mic arbiter: a rejected claim leaves holder and audio mode untouched | ✅ PASS | H1/arbiter — "rejected claim leaves holder and audio mode untouched". Prior-run root cause: bare node invocation omitted `--env-file-if-exists=.env` → `MIC_ARBITER_ENABLED=false` → `claimMic()` returned GRANTED_NOOP → denial path never exercised. Fixed in 51cb6ea via `yarn test:voice` (108/108; 2026-10-31). |
| AT15 | isMicHeldByEvidenceLocker fails closed when guard ON, arbiter OFF | ✅ PASS | H2b/Fix2 test (source rev 51cb6ea; 2026-10-31). **Source-string inspection only** (does NOT execute production branches): two `assert.match` calls confirm that `if (!MIC_LEASE_GUARD_ENABLED) return false` appears before `if (!MIC_ARBITER_ENABLED) return true` in the file text — neither branch runs during this test because `MIC_ARBITER_ENABLED=true` in the test environment. **Production code executed** (both-flags-ON live path): `isMicHeldByEvidenceLocker()` with no owner returns `false`; with `evidence_locker` owner returns `true` — functionally verified. The arbiter-off fail-closed branch (`return true` when `MIC_ARBITER_ENABLED=false`) is confirmed at source text level only; it is not executed at runtime in this test. |
| AT16 | DHARA declines to speak while Evidence Locker holds the mic | ✅ PASS | H1/speech — functional test; `isMicHeldByEvidenceLocker()=true` with locker owner confirmed; `TTS_BLOCKED_BY_LOCKER_MESSAGE` wording verified; banned-word list checked (source rev 51cb6ea; 2026-10-31). |
| AT17 | Speech declined under privacy cover (Women's Shield forces Quiet) | ✅ PASS | H1/speech — privacy cover test; `maySpeak({inWomensShield:true}).speak=false`, `reason='womens_shield'`; all three platforms checked via `maySpeakOn` (source rev 277ba66). |
| AT18 | SOS phrase check runs before privacy cover in chat send() path | ✅ PASS | H1/order — `indexOf('triggerSafetySequence(') < indexOf('activateCover(')` on index.tsx source (source rev 277ba66). |
| AT19 | No voice module starts a recorder at import time | ✅ PASS | H1/order — filesystem walk of src/voice, regex on module-scope lines for prepareToRecordAsync / .record() / startRecording() (source rev a396260). |
| AT20 | Voice companion + arbiter flags OFF unless env var is exactly "true" | ✅ PASS | H1/flags — `readsTrueOnly()` contract + source match on speechGate.ts and micArbiterGuard.ts; repo env confirmed: companion OFF, arbiter ON, guard ON (source rev 51cb6ea). |

---

## AT21–AT30: Speech Gate Logic

| ID   | Description | Status | Evidence |
|------|-------------|--------|----------|
| AT21 | AppState 'inactive' sets interruptedNotResumed=true | ✅ PASS | V1-B/gate: `audio_interruption` event; V1-B/integration step 1 (source rev c11732c). |
| AT22 | AppState 'background' behaves identically to 'inactive' | ✅ PASS | V1-B/integration: background event test (source rev c11732c). |
| AT23 | Two consecutive interruptions do not toggle flag back to false | ✅ PASS | V1-B/integration: no-toggle assertion; V1-B/gate: multiple-interruption test (source rev c11732c). |
| AT24 | maySpeakOn() returns speak=false when interruptedNotResumed=true | ✅ PASS | V1-B/gate: `maySpeakOn` blocked test (source rev c11732c). |
| AT25 | Foregrounding alone (AppState 'active') does NOT resume TTS | ✅ PASS | V1-B/integration step 2: `cancelCalled=false`, `stopTTSCalled=false`, `interruptedNotResumed` stays `true` after 'active' (source rev c11732c). |
| AT26 | Only explicit user resume (resume_requested) clears interrupted flag | ✅ PASS | V1-B/integration step 3 (source rev c11732c). |
| AT27 | resume_requested allows maySpeakOn() to return speak=true | ✅ PASS | V1-B/integration step 3 `afterResume.speak=true` (source rev c11732c). |
| AT28 | index.tsx AppState listener imports and calls noteAudioInterruption() | ✅ PASS | V1-B/source — regex `noteAudioInterruption()` + import `from.*speechGate` confirmed on index.tsx source text (source rev e10b74c). |
| AT29 | Voice companion flag OFF: canSpeakNow() returns true (inert) | ✅ PASS | H1/flags — env assertion `EXPO_PUBLIC_VOICE_COMPANION_ENABLED !== 'true'` (source rev 51cb6ea). |
| AT30 | speechGate initialises from persisted Quiet preference | 📋 SOURCE-VERIFIED | `initSpeechGate()` reads AsyncStorage on load (source rev e10b74c). AsyncStorage cannot be loaded in Node --test runner; native runtime required for full E2E verification. |

---

## AT31–AT40: Safety Interruption and Hardware Events

| ID   | Description | Status | Evidence |
|------|-------------|--------|----------|
| AT31 | Incoming phone call triggers AppState 'inactive' → gate blocks TTS | ✅ PASS | V1-B/integration: inactive simulation (pure logic; source rev c11732c). |
| AT32 | App backgrounded triggers AppState 'background' → gate blocks TTS | ✅ PASS | V1-B/integration: background simulation (source rev c11732c). |
| AT33 | stopCloudTTS() and stopNativeTTS() called on any non-active AppState | ✅ PASS | V1-B/integration: `stopTTSCalled=true` assertion on inactive/background events (source rev c11732c). |
| AT34 | Head Out alert simulation — ALERT_SIMULATION_MODE guard fires before Linking.openURL | 🔍 BOUNDARY-INSPECTED | **Scope (Head Out simulation path only):** `ALERT_SIMULATION_MODE=true` guard in `triggerHeadOutAlert` confirmed by source inspection B1..B10 (source rev f67f080); `setSimPreview()` called; `Linking.openURL('sms:...')` never reached; simulation modal JSX confirmed (`testID="headout-sim-preview-modal"`, text "Simulated — nothing sent"). **Outside this evidence:** Silent Alert SMS composition (`composeAlert()` — AT35), Guardian invitation links, Evidence Locker upload paths, and all other DHARA communication channels not on the Head Out simulation code path. **Auth-gate blocker (test-environment limitation, not a native-build requirement):** consent/auth gate in web preview blocks automated UI tap-test; addressable by a test account that bypasses the gate without requiring a native build. |
| AT35 | Silent Alert screen opens SMS composer only — no auto-send | 📋 SOURCE-VERIFIED | `composeAlert()` uses `Linking.openURL('sms:')` — requires user tap in native SMS app; web preview has no native SMS (source rev f67f080). |
| AT36 | Evidence recording gate: EXPO_PUBLIC_SILENT_ALERT_EVIDENCE_V1 flag controls trigger | 📋 SOURCE-VERIFIED | `safetyTriggerCoordinator.ts` flagOff path verified by source inspection (source rev f67f080). |
| AT37 | onLockedCancel() called when AppState becomes non-active | ✅ PASS | V1-B/integration: `cancelCalled=true` assertion (source rev c11732c). |
| AT38 | WHISPER_HINT_SET comment does not claim unverified international codes | ✅ PASS | Comment updated to 7 probe-verified codes only (source rev 0a5b27f). |
| AT39 | Diagnostic log sanitised: startRecording catch logs class name only (DHARA/W12) | ✅ PASS | No `e.message` in catch block (source rev 8554b33). |
| AT40 | Headphone disconnect (AUDIO_BECOMING_NOISY / AVAudioSession route change) | ❌ NOT IMPLEMENTED | No headphone-disconnect handler exists in the codebase. Test file comment (h1VoiceScaffolding.test.ts lines 518–521): "not surfaced by current Expo audio JS layer; needs a dedicated RN module." Status is NOT IMPLEMENTED — a handler must be designed and built before a test can be written or run. This is distinct from NOT RUN, which applies to an implemented-but-untested handler. |

---

## AT41–AT48: Legal Gate, Compliance, and Account Isolation

| ID   | Description | Status | Evidence |
|------|-------------|--------|----------|
| AT41 | B002-C Option 3: same cold-start session preserves cover (BC-1) | ✅ PASS | privacyCoverState.test.mjs BC-1 (43 tests pass; source rev 3d85217). |
| AT42 | B002-C Option 3: new cold-start (different session ID) rejects stale guest cover (BC-2) | ✅ PASS | privacyCoverState.test.mjs BC-2 (source rev 3d85217). |
| AT43 | BNS/BNSS corpus sections cited in Rights Cards | 🔶 PARTIAL | **Corpus presence** ✅ — 12/12 BNS/BNSS sections found in `bns-know-your-rights-gandhikar_db.legal_sections` (source rev 01651f2; 2026-10-31). **Heading match** ✅ — all 12 pass case-insensitive substring check. **Release-state label** ✅ — 10/10 cards at `LEGAL_REVIEWED` or `ADVOCATE_VERIFIED` in `gandhikar_db.rights_cards`. **Legal annex prepared** 🟦 — `LEGAL_REVIEW_ANNEX.md` (commit `4704e8b`) provides field-by-field comparison of IPC §166A / BNS §199 official text vs. DHARA canonical record and lists all 10 Guardian card scenarios; marked PENDING HUMAN REVIEW throughout. **Authorized reviewer approval** ⚠ OPEN — label is self-asserted in seed data; no reviewer identity, date, or independent artefact verified by these tests. **Substantive claim support** ⚠ OPEN — annex prepared (PENDING HUMAN REVIEW); official text not independently verified by a human reviewer; correspondence-containment not tested. See AT43 Detail. |
| AT44 | B002-C Option 3: no session ID set (pre-mount) → no session check applied (BC-3) | ✅ PASS | privacyCoverState.test.mjs BC-3 (source rev 3d85217). |
| AT45 | Incoming phone call on-device: AppState listener fires, gate blocks, TTS stops | 🔲 NOT RUN | Unit gate contract proven in AT21–AT28 (pure logic); end-to-end device test requires physical build and a real incoming call. |
| AT46 | Auth scope bypass: session ID check does not affect authenticated users (BC-4) | ✅ PASS | privacyCoverState.test.mjs BC-4 (source rev 3d85217). |
| AT47 | Account isolation: guest cover not visible in auth scope; auth cover not visible in guest scope | ✅ PASS | B002-A/B tests in privacyCoverState.test.mjs (source rev 3d85217). |
| AT48 | Greeting "hey dhara, good evening" routes to conversational reply, not legal fallback | ✅ PASS | TestSalutationTimeOfDayGreetings (50 C1 tests pass; source rev ba17351). |

---

## Summary

| Result | Count | IDs |
|--------|-------|-----|
| ✅ PASS | 41 | AT01–AT29, AT31–AT33, AT37–AT39, AT41–AT42, AT44, AT46–AT48 |
| 🔶 PARTIAL | 1 | AT43 |
| ❌ NOT IMPLEMENTED | 1 | AT40 |
| 🔲 NOT RUN (native device required) | 1 | AT45 |
| 🔍 BOUNDARY-INSPECTED | 1 | AT34 |
| 📋 SOURCE-VERIFIED | 3 | AT30, AT35, AT36 |
| **Total** | **48** | AT01–AT48 accounted for exactly once |

---

### AT43 Detail

**Status: PARTIAL** (corpus-evidence sub-claims closed by commit `01651f2`; two sub-claims remain open)

| Sub-claim | Status | Evidence |
|-----------|--------|----------|
| Corpus presence (12 sections in DB) | ✅ PASS | `test_bns_section_in_corpus` parametrized (12/12; commit 01651f2) |
| Heading match (fragment in section_heading) | ✅ PASS | Case-insensitive substring match, 12/12 |
| Release-state label (LEGAL_REVIEWED or ADVOCATE_VERIFIED) | ✅ PASS | `test_rights_card_at_or_above_legal_reviewed` (10/10) |
| Legal annex prepared (IPC §166A / BNS §199 + Guardian cards) | 🟦 PENDING HUMAN REVIEW | `LEGAL_REVIEW_ANNEX.md` (commit `4704e8b`): field-by-field comparison of official statutory text vs. DHARA canonical record; 10 Guardian card scenarios; elevated risk note for `cyber_harassment` (Shreya Singhal §66A). All conclusions PENDING HUMAN REVIEW. |
| Authorized reviewer approval | ⚠ OPEN | Label is self-asserted in seed data. REGISTRY-001-v1 (commit `62ec771`) records the IPC→BNS mapping hash but reviewer identity and review date for individual rights cards are not independently verified. Commit `83edf79` injected agent-generated reviewer metadata and was reverted by P2 audit (2026-10-31): `3aee73b`. A real authorized-reviewer artefact (identity + date + out-of-band signature) per the DHARA Guardian Authorization protocol is required. |
| Substantive claim support | ⚠ OPEN | Legal annex prepared (PENDING HUMAN REVIEW, commit `4704e8b`). Official statutory text reproduced from public sources but not independently verified by a qualified human reviewer. Correspondence-containment (LLM answers bounded to cited sections only) not tested. |

Closing AT43 fully requires: (1) an authorized reviewer artefact (identity + date + out-of-band signature) for each card, (2) a correspondence-containment test. Both require a separate GO command.

POCSO (`children_safety`) and PWDV (`thrown_out_of_home`) are not in the BNS corpus — their existence and release-state label are confirmed; corpus-presence and heading-match sub-claims do not apply to them.

### AT34 Detail

**Status: BOUNDARY-INSPECTED → RADIUS VERIFIED (2026-10-31)**

**Head Out alert simulation path evidence (unchanged):**
- `ALERT_SIMULATION_MODE=true` guard fires before `Linking.openURL('sms:...')` in `triggerHeadOutAlert` — confirmed by source inspection (B1..B10, commit `f67f080`)
- `setSimPreview()` is called and the function returns before reaching `Linking`
- Simulation modal JSX confirmed: `testID="headout-sim-preview-modal"`, text "Simulated — nothing sent", "No SMS, call, or notification has been sent to anyone"

**Radius & timer verification evidence added (GO 2026-10-31):**
- `headOutTimer.test.mjs` 35/35 pass:
  - FC-01..FC-12: `formatCountdown()` boundary/format/zero-padding
  - CD-01..CD-06: deadline calculation + expiry detection (`secsLeft===0 → expired=true`)
  - RD-01..RD-06: radius display text (GPS ON/OFF, undefined/0 guard)
  - SS-01..SS-04: `HeadOutSession` JSON round-trip (radiusMeters, startTime, null lat/lng)
  - SIM-01..SIM-04: `ALERT_SIMULATION_MODE` guard (default=ON, env="false"→OFF, intercepts before Linking)
  - SF-01..SF-03: required session fields + DURATIONS array

**Outside AT34 evidence scope:**
- Silent Alert SMS composition (`composeAlert()` / Linking.openURL('sms:')) — AT35
- Guardian invitation link generation
- Evidence Locker upload paths

**Auth-gate blocker (test-environment limitation, not a native-build requirement):**
Consent/auth gate in the web preview blocks automated UI tap-test reaching the simulation modal. Addressable by a test account that bypasses the gate; native build not strictly required.

## Open Items (updated 2026-10-31 — DHARA approval-gate completion GO)

| Item | Prior status | Current status | Required to close |
|------|-------------|----------------|-------------------|
| AT14 / AT15 / AT16 | OPEN (prior batch) | ✅ **CLOSED** — commit `51cb6ea`, `yarn test:voice` 108/108 (2026-10-31) | — |
| Activation boundary (Steps 2 & 3) | IN PROGRESS | ✅ **CLOSED** — `activation_boundary.py` fully implemented (commit `3de2e57`); validates all 10 prerequisites (A–J); appends append-only audit events; architecture limitation documented (JSON file, not transactional store). | — |
| Activation boundary tests (Step 4) | NOT STARTED | ✅ **CLOSED** — `test_activation_boundary.py` (B01–B24 + BS01–BS02, 50+ tests, commit `3de2e57`); all pass. | — |
| Legal review annex (Step 5) | NOT STARTED | 🟦 **PENDING HUMAN REVIEW** — `LEGAL_REVIEW_ANNEX.md` (commit `4704e8b`): IPC §166A / BNS §199 official text comparison + 10 Guardian card scenarios + Shreya Singhal risk note. All conclusions PENDING HUMAN REVIEW. | Separate qualified human legal reviewer + GO to activate |
| BNS §199 E2E stream test (Step 6) | OPEN (P1) | ✅ **CLOSED** — `test_bns199_stream_release.py` (S01–S20, commit `81974ba`): 19 tests pass (1 skip). Covers English/Hindi transliterated queries, ipc= / bns= / q= paths, isolated approved-fixture path, global contract invariant. | — |
| AT43 — authorized reviewer approval | ⚠ OPEN | ⚠ **OPEN** — Commit `83edf79` reverted (P2 audit 2026-10-31, revert `3aee73b`): agent-generated reviewer metadata is not valid authorization. Real human artefact required. | Real reviewer artefact (identity + date + out-of-band signature) + separate GO |
| AT43 — substantive claim support | ⚠ OPEN | 🟦 **PARTIAL** — Legal annex prepared (commit `4704e8b`), PENDING HUMAN REVIEW; official text not independently verified; correspondence-containment not tested. | Qualified human legal reviewer to verify annex + separate GO |
| AT40 | NOT IMPLEMENTED | ❌ **NOT IMPLEMENTED** — no handler exists; test comment: "needs a dedicated RN module" | Design + implementation + GO |
| AT45 | NOT RUN | 🔲 **NOT RUN** — unit gate proof complete (AT21–AT28); device E2E open | Physical build + real incoming call |
| AT34 UI tap layer | BOUNDARY-INSPECTED | 🔍 **BOUNDARY-INSPECTED + RADIUS VERIFIED** — 35 pure-function tests; auth-gate blocker is test-env limitation | Test account bypassing consent gate |
| Legal-release containment (P1) | OPEN | ✅ **CLOSED** — CORRECTION GO 2026-10-31: canonical v1 hash + structural withholding; 81 backend tests pass | — |
| IPC:166A registry re-issue | OPEN | 🟦 **PENDING HUMAN REVIEW** — REGISTRY-001-v1 hash verified correct (commit `62ec771`); status `pending_human_review` (P2 correction); gate rejects until human legal review completed out-of-band; activation_boundary validates all 10 prerequisites before manual write. | Separate human legal review + GO to activate |
| Guardian authorization (AT43 P2) | OPEN | ⚠ **OPEN** — Commit `83edf79` reverted (P2 audit). | Real reviewer artefact (identity + date + out-of-band signature) + separate GO |
| Rights Cards production enable | Future | Blocked on AT43 substantive claim + GO | — |
| 11 missing admin analytics endpoints | Backlog | No change | — |

---

*This document records acceptance-test evidence. It does not constitute a pilot readiness determination.*
