# DHARA Voice — AT01–AT48 Acceptance Test Matrix (V1 Correction Batch)

Generated: 2026-10-30  
Batch: V1 correction and verification (commits a396260..277ba66 + ba17351)  
Total tests: **48** (unique IDs, no duplicates)

Legend:
- ✅ PASS  — verified in this batch (test evidence below)
- ⚠ CHANGE REQUIRED — code must change before this can pass
- 🔲 NOT RUN — requires native device build / live environment
- 🔍 BOUNDARY-INSPECTED — outbound paths confirmed intercepted; UI not reachable via web automation
- 📋 SOURCE-VERIFIED — verified by source-code inspection (no runtime)

---

## AT01–AT10: Language Detection and Hint Routing

| ID   | Description | Status | Evidence |
|------|-------------|--------|----------|
| AT01 | 9 proxy-rejected Indian codes (bn/te/gu/ml/pa/or/as/sa/sd) produce first Whisper call with NO language kwarg | ✅ PASS | BR-1..BR-9 in test_stt_engine.py (63 tests pass) |
| AT02 | 7 probe-verified codes (hi/en/mr/kn/ur/ne + ta-IN→ta) produce first call with correct language hint | ✅ PASS | BR-10..BR-16 in test_stt_engine.py |
| AT03 | BCP-47 normalisation: "ta-IN" → "ta" before hint-set lookup | ✅ PASS | B-9/TA-1..TA-3 in test_stt_engine.py |
| AT04 | Language-hint rejection (unsupported_language) triggers exactly ONE retry | ✅ PASS | BR-17 in test_stt_engine.py |
| AT05 | Retry (second) call strips the language hint — never repeats it | ✅ PASS | BR-18 in test_stt_engine.py |
| AT06 | Unexpected 400 without "language" in message → no retry, exception propagates | ✅ PASS | BR-19 in test_stt_engine.py |
| AT07 | Rejected-code auto-detect path never retries even on a language-flavoured 400 | ✅ PASS | BR-20 in test_stt_engine.py |
| AT08 | Both Whisper attempts fail → exception propagates to caller | ✅ PASS | B-8/TA-9 in test_stt_engine.py |
| AT09 | Tamil BCP-47 variants (ta-IN, ta-LK, TA) all normalise to "ta" hint | ✅ PASS | TA-1..TA-4 in test_stt_engine.py |
| AT10 | Non-language Tamil error (audio_too_short) does NOT trigger retry | ✅ PASS | TA-10 in test_stt_engine.py |

---

## AT11–AT20: Audio Session and Microphone Arbitration

| ID   | Description | Status | Evidence |
|------|-------------|--------|----------|
| AT11 | Mic arbiter: claim from unknown owner fails closed (Evidence Locker not displaced) | ✅ PASS | H1/arbiter tests (h1VoiceScaffolding.test.ts) |
| AT12 | Mic arbiter: released claim cannot be reused by a forged handle | ✅ PASS | H1/arbiter — isActive=false after release |
| AT13 | Mic arbiter: preempted owner must re-claim (release does not restore it) | ✅ PASS | H1/arbiter tests |
| AT14 | Mic arbiter: a rejected claim leaves holder and audio mode untouched | ⚠ CHANGE REQUIRED | H1/arbiter: test `a rejected claim leaves the holder and the audio mode untouched` fails — arbiter fix pending separate GO |
| AT15 | isMicHeldByEvidenceLocker fails closed when guard ON, arbiter OFF | ⚠ CHANGE REQUIRED | H2b/Fix2 test fails — same arbiter fix |
| AT16 | DHARA declines to speak while Evidence Locker holds the mic | ⚠ CHANGE REQUIRED | H1/speech test fails — depends on arbiter fix |
| AT17 | Speech declined under privacy cover (Women's Shield forces Quiet) | ✅ PASS | H1/speech test passes |
| AT18 | SOS phrase check runs before privacy cover in chat send() path | ✅ PASS | H1/order test passes |
| AT19 | No voice module starts a recorder at import time | ✅ PASS | H1/order test passes |
| AT20 | Voice companion + arbiter flags OFF unless env var is exactly "true" | ✅ PASS | H1/flags tests pass |

---

## AT21–AT30: Speech Gate Logic

| ID   | Description | Status | Evidence |
|------|-------------|--------|----------|
| AT21 | AppState 'inactive' sets interruptedNotResumed=true | ✅ PASS | V1-B/gate test + V1-B/integration test |
| AT22 | AppState 'background' behaves identically to 'inactive' | ✅ PASS | V1-B/integration (background) test |
| AT23 | Two consecutive interruptions do not toggle flag back to false | ✅ PASS | V1-B/integration (no-toggle) + V1-B/gate multiple test |
| AT24 | maySpeakOn() returns speak=false when interruptedNotResumed=true | ✅ PASS | V1-B/gate maySpeakOn test |
| AT25 | Foregrounding alone (AppState 'active') does NOT resume TTS | ✅ PASS | V1-B/integration: `active alone does NOT resume` assertion |
| AT26 | Only explicit user resume (resume_requested) clears interrupted flag | ✅ PASS | V1-B/integration: Step 3 assertion |
| AT27 | resume_requested allows maySpeakOn() to return speak=true | ✅ PASS | V1-B/integration: afterResume.speak=true |
| AT28 | index.tsx AppState listener imports and calls noteAudioInterruption() | ✅ PASS | V1-B/source test (source inspection) |
| AT29 | Voice companion flag OFF: canSpeakNow() returns true (inert) | ✅ PASS | H1/flags: voice companion flag test |
| AT30 | speechGate initialises from persisted Quiet preference | 📋 SOURCE-VERIFIED | initSpeechGate() reads AsyncStorage on load |

---

## AT31–AT40: Safety Interruption and Hardware Events

| ID   | Description | Status | Evidence |
|------|-------------|--------|----------|
| AT31 | Incoming phone call triggers AppState 'inactive' → gate blocks TTS | ✅ PASS | V1-B/integration: inactive simulation |
| AT32 | App backgrounded triggers AppState 'background' → gate blocks TTS | ✅ PASS | V1-B/integration: background simulation |
| AT33 | stopCloudTTS() and stopNativeTTS() called on any non-active AppState | ✅ PASS | V1-B/integration: stopTTSCalled assertion |
| AT34 | Head Out alert simulation — no SMS/call/push sent; UI shows "Simulated — nothing sent" | 🔍 BOUNDARY-INSPECTED | B1..B10 all pass (see node inspection log). Auth gate prevents web-preview UI test. Code path proven: ALERT_SIMULATION_MODE=true → setSimPreview() → return (Linking never reached). UI text "Simulated — nothing sent" confirmed in JSX (B4). |
| AT35 | Silent Alert screen opens SMS composer only — no auto-send | 📋 SOURCE-VERIFIED | composeAlert() uses Linking.openURL('sms:') which requires user tap in native SMS app; web preview has no native SMS |
| AT36 | Evidence recording gate: EXPO_PUBLIC_SILENT_ALERT_EVIDENCE_V1 flag controls trigger | 📋 SOURCE-VERIFIED | safetyTriggerCoordinator.ts flagOff path verified |
| AT37 | onLockedCancel() called when AppState becomes non-active | ✅ PASS | V1-B/integration: cancelCalled assertion |
| AT38 | WHISPER_HINT_SET comment does not claim unverified international codes | ✅ PASS | WHISPER_HINT_SET comment updated (commit 0a5b27f predecessor) |
| AT39 | Diagnostic log sanitised: startRecording catch logs class name only (DHARA/W12) | ✅ PASS | Slice/v1-logging commit 8554b33 — no e.message in catch block |
| AT40 | Headphone disconnect (AUDIO_BECOMING_NOISY / AVAudioSession route change) | 🔲 NOT RUN | Requires physical Android/iOS device build; not surfaced by Expo JS audio layer |

---

## AT41–AT48: Legal Gate, Compliance, and Account Isolation

| ID   | Description | Status | Evidence |
|------|-------------|--------|----------|
| AT41 | B002-C Option 3: same cold-start session preserves cover (BC-1) | ✅ PASS | privacyCoverState.test.mjs BC-1 (43 tests pass) |
| AT42 | B002-C Option 3: new cold-start (different session ID) rejects stale guest cover (BC-2) | ✅ PASS | privacyCoverState.test.mjs BC-2 |
| AT43 | AT43 — Legal release gates: BNS articles linked from Rights Cards verified against official text | ⚠ CHANGE REQUIRED | Legal release gates are open. Multiple Rights Card entries reference BNS sections not yet individually probe-verified against the official 2023 BNS PDF. Remains CHANGE REQUIRED until probe-verification and a second legal review pass are completed. Voice output of unverified content is blocked by output_guard.py; UI Rights Cards remain accessible. |
| AT44 | B002-C Option 3: no session ID set (pre-mount) → no session check applied (BC-3) | ✅ PASS | privacyCoverState.test.mjs BC-3 |
| AT45 | Incoming phone call on-device: AppState listener fires, gate blocks, TTS stops | 🔲 NOT RUN | Unit gate proof in AT21–AT28; end-to-end device test open (requires physical build) |
| AT46 | Auth scope bypass: session ID check does not affect authenticated users (BC-4) | ✅ PASS | privacyCoverState.test.mjs BC-4 |
| AT47 | Account isolation: guest cover not visible in auth scope; auth cover not visible in guest scope | ✅ PASS | B002-A/B tests in privacyCoverState.test.mjs |
| AT48 | Greeting "hey dhara, good evening" routes to conversational reply, not legal fallback | ✅ PASS | TestSalutationTimeOfDayGreetings (50 c1 tests pass); backend restarted |

---

## Summary

| Result | Count |
|--------|-------|
| ✅ PASS | 37 |
| ⚠ CHANGE REQUIRED | 4 (AT14, AT15, AT16, AT43) |
| 🔲 NOT RUN (native device required) | 2 (AT40, AT45) |
| 🔍 BOUNDARY-INSPECTED | 1 (AT34) |
| 📋 SOURCE-VERIFIED | 3 (AT30, AT35, AT36) |
| **Total** | **48** |

### AT43 Detail
AT43 remains **CHANGE REQUIRED** because legal release gates (BNS Rights Cards content)
are open. DHARA's `output_guard.py` blocks voice output of unverified content, preserving
the Legal Truth Engine contract. The gate will close when:
1. Each BNS article linked from Rights Cards is individually probe-verified against the
   official 2023 BNS PDF.
2. A second legal review pass is completed by a qualified advocate.
A separate GO command is required to authorise that verification work.

### AT34 Detail
AT34 is marked **BOUNDARY-INSPECTED** (not BLOCKED).
All 10 outbound boundaries confirmed intercepted by code analysis:
- SMS: `ALERT_SIMULATION_MODE=true` guard fires before `Linking.openURL('sms:...')`
- Location: `GO1B_GPS_ENABLED=false` → `journeyToken=null` → `lastGaspUpload` is no-op
- Calls: no `tel:` URL in this flow
- Push: no FCM/Notifications call in this flow
- Invitations: not present in this flow

The UI simulation modal (`testID="headout-sim-preview-modal"`, text "Simulated — nothing sent",
"No SMS, call, or notification has been sent to anyone") is confirmed present in JSX.
Web-preview UI automation was blocked by the consent/auth gate; a native build
would allow full UI-layer AT34 validation.

---

## Open Items After This Batch

1. **AT14/AT15/AT16** — Mic arbiter failing tests. Requires a separate GO to fix
   the `rejectClaim` return value so the holder and audio mode are preserved.
2. **AT40/AT45** — Native device build required (physical Android/iOS).
3. **AT43** — Legal release gates. Separate GO + legal review pass required.
4. **AT34 UI layer** — Full UI-layer test (tap button, see modal) requires a native
   build or a test account that bypasses the consent gate.
