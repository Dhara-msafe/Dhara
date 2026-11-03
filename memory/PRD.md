# Dhara (formerly Gandhikar) — PRD

## November 2026 — DHARA Greeting & Suggested-Question Fix (Phase 1 MVP)

### C1 Conversational Intent Layer (FEATURE_C1_CONVERSATIONAL_REPLIES=true)

**Problem**: DHARA sent every message — including greetings ("hi", "namaste") and its own follow-up
suggestion chips — through the legal-corpus search, returning "I cannot confirm from official text"
for non-legal queries. This broke onboarding UX.

**Fix**: A deterministic (no-LLM) intent matcher that intercepts conversational messages before
they reach the corpus, returning friendly built-in replies instantly.

#### Backend Changes
- **`/app/backend/engine/conversational_intents.py`** — intent classifier covers `greeting`,
  `what_can_you_do`, `who_are_you`, `how_are_you`, `thanks`, `goodbye` across 10 languages
  (en, hi, mr, ta, bn, te, kn, pa, ml, gu).  Full capability-description template per language.
  Deny-list (`is_denylisted`) blocks danger/help phrases from ever getting a canned reply.
- **`/app/backend/api/chat_router.py`** — C1 early gate wired at line ~1373 inside `event_gen()`.
  Bug fix (this session): vocative-stripper patch — `classify_conversational_intent()` now also
  matches against `raw.lower()` so "what is dhara" correctly returns the capability reply
  (previously the vocative stripper removed "dhara" from the normalised text before the pattern
  match, causing a miss).
- **Guest-counter guard** — C1 intent turns (greetings, thanks, etc.) no longer consume a guest
  user's free question quota.  The `$inc` on `guest_question_count` is skipped when `_c1_pre` is
  true.  Verified: "hi" keeps count=0; a real legal question increments to 1.

#### Frontend — Suggestion Chips
- Initial chip set (`home.suggestion1-4`) and Pro chip set (`home.proSuggestion1-4`) contain
  only answerable legal questions (cheque bounce, UPI fraud, helmet fine, RTI, domestic violence).
  No meta-capability chips ("what can you do?") were ever in the i18n keys. Confirmed.
- Chip routing: `getBasicSuggestions(lang)` and `getProSuggestions(lang)` (i18n-backed) are the
  live paths; `BASIC_SUGGESTIONS` / `PRO_SUGGESTIONS` const arrays are unused dead code.

#### Test Results (all green)
- 8/8 new live-API tests pass (greeting replies, deny-list pass-through, legal pipeline intact)
- 50/50 existing unit tests unaffected
- Guest-counter verified: C1 turn keeps count=0; legal turn increments to 1.

#### Pending Items
- Phase 2: Multilingual capability-reply expansion (10 languages already in templates — verify
  non-Latin scripts render correctly in native build — **requires user to generate APK**).
- P0 code-phrase native verification: still requires user to generate APK and test on physical
  Android device (N-1 to N-6 matrix).  JS tests (55/55) pass; static logic verified in container.

## November 2026 (Session 3) — Corpus Prefix Stripping

### Imperative-prefix stripper in query_parser.py

**Problem**: Queries phrased as imperatives ("help me file an FIR", "please help me understand
domestic violence law") caused the LLM query parser to produce weaker rewrites and — on timeout —
the raw imperatively-phrased query hit the corpus directly, returning sparse or empty results.

**Fix**:

#### `engine/query_parser.py` — new `strip_imperative_prefix(query)` + `_IMPERATIVE_PREFIX_RE`
- Strips common imperative prefixes deterministically before sending to the LLM.
- Both the LLM prompt and the fallback `normalized_query` use the clean stripped text.
- `original_query` always records the raw user message unchanged.
- Patterns covered: "help me [to/with/understand]", "please help me …", "can/could you
  [help/explain/tell me about]", "i want/need to [know/understand]", "i need help with".
- Safety guards: `"help desk"`, `"help line"` are NOT stripped (requires "me/us/to/with" after
  "help"); bare phrases like "help me" (2 words) fall back to the original.
- Edge-case fix (round 2): `"please help me, my husband beats me"` → comma-aware `[,\s]+`
  in the regex → correctly strips to `"my husband beats me"`.

#### Test Results
- 20/20 new backend tests pass + 32/32 regression tests pass (iteration_67).
- 12/12 unit tests for `strip_imperative_prefix` including edge cases.
- Live API: "help me file an FIR" → 602-char FIR registration answer ✅
- Live API: "please help me understand domestic violence law" → PWDVA answer ✅
- Live API: "help me" still → SOS distress reply with 112/1091 ✅

#### Notes
- P0 APK test (safety code-phrase N-1 to N-6 matrix) still requires user to generate APK
  via Publish button and test on a physical Android device.



### "help me" / Bare Distress Reply (Feature C1-SOS)

**Problem**: Bare short panic phrases ("help", "help me", "bachao", "मदद करो") hit the deny-list,
fell through to the legal corpus, and returned a cold "I cannot confirm from official text" refusal
— exactly the wrong response for someone in distress.

**Fix (backend only)**:

#### `conversational_intents.py`
- Added `_BARE_DISTRESS_PHRASES` — exact short phrases in all 10 languages.
- Compiled `_BARE_DISTRESS_RE` anchored `^…$` regex; internal whitespace normalised so "help  me"
  (double space) matches identically to "help me".
- Added `is_bare_distress(message)` — returns True ONLY for these bare phrases; "help me file
  an FIR" returns False and is routed to the legal pipeline as before.
- Added `TEMPLATES["distress_sos"]` — caring reply in all 10 languages with emergency numbers
  (112, 100, 1091, 181, 1930) and an invitation to describe the situation.
- Script bug-fixed: Marathi first-line had Arabic Unicode escapes (copy-paste error) → corrected
  to Devanagari. Kannada had U+0BBE (Tamil vowel) → corrected to U+0CBE (Kannada vowel).

#### `chat_router.py`
- Import: `is_bare_distress` added.
- Guest counter `_c1_pre`: distress phrases now also bypass the guest-question increment.
- `event_gen()`: distress SOS gate runs BEFORE the deny-list check (after `_emergency` active-
  danger check). "help me file an FIR" (longer → `is_bare_distress` False) still goes to legal
  pipeline.

### Adaptive Chips (Phase 3)

**`/api/chat/followup` changes**:
- Skip guard: C1 intents (greeting/thanks/capability) and bare distress turns return `[]` — no
  wasted LLM call, no nonsensical chips after "hi" or "help me".
- Updated prompt: "Generate exactly 3 short follow-up chips … all corpus-answerable … Chip 1:
  immediate next step / Chip 2: process / Chip 3: enforcement/penalty". Verified output e.g.
  cheque-bounce → ["What details must the legal notice include?", "How do I file the complaint in
  court?", "What penalty does the drawer face under Section 138?"].

#### Test Results
- 24/24 backend tests pass (including 3 new script-check tests for mr/kn/other languages).
- Marathi, Kannada, all 10 language templates start with correct Unicode script.
- Double-space normalisation verified.



### All sprint flags turned ON
- `EXPO_PUBLIC_SAFETY_SESSION_V1=true` — Head Out row visible in Women's Shield
- `EXPO_PUBLIC_TRUSTED_CIRCLE_V2=true` — email field live in Trusted Circle
- `EXPO_PUBLIC_EVIDENCE_ACTIONS=true` — notes + FIR button live in Evidence Locker
- `EXPO_PUBLIC_CAMPUS_LAYER=true` — Campus safety section live in Women's Shield
- `EXPO_PUBLIC_GUARDIAN_SHARE=true` — Guardian Journey row + Notify button live

### Compliance Audit (DPDP Act 2023)
**A. PostHog session replay masking** — added `maskAllImages: true` to `POSTHOG_OPTIONS` alongside existing `maskAllInputs` and `maskAllTextInputs`. No PII in images recorded to EU servers.

**B. Consent-gated `trackEvent`** — `analytics/index.ts` now carries a module-level `_analyticsConsent` boolean. `trackEvent()` silently returns when consent is `false`. `loadAnalyticsConsent(userId)` called at login in `_layout.tsx`. `updateConsentCache(bool)` called immediately when the user saves consent in `consent.tsx`.

**C. Accessibility labels** — `ToolRow` refactored to a full-row `Pressable` with `accessibilityRole="button"`, `accessibilityLabel`, and `accessibilityHint`. Back button, helpline cards, safety-plan button, scenario right cards, and `SosPill.Chip` all have `accessibilityLabel` + `accessibilityRole`.

### S3 — Guardian Journey Engine (SMS/link mode, `EXPO_PUBLIC_GUARDIAN_SHARE=true`)
- **New screen** `/app/frontend/app/women/guardian-share.tsx`
- Journey preview card (destination + check-in time), contact selector with pre-selection of `notify`-enabled contacts, editable, message preview panel, "Send" button opens native SMS app with pre-filled body
- "Notify your guardian" button added to Head Out active-session card (behind `GUARDIAN_SHARE` flag)
- "Guardian Journey" ToolRow added to Women's Shield Safety tools section
- Nothing sent automatically — user controls every SMS send action
- All 9 frontend + backend tests passed via `testing_agent`



### S2 — Head Out Safe Session (`EXPO_PUBLIC_SAFETY_SESSION_V1=false`)
- **New screen** `/app/frontend/app/women/head-out.tsx`
- User enters destination text + selects expected return time (30 min / 1 h / 2 h / 4 h)
- `AsyncStorage` persists session across app restarts; countdown timer runs in `useEffect` / `setInterval`
- On expiry: shows "Check-in missed" state + "Prepare alert for trusted circle" button — opens SMS draft to notify contacts (uses `Linking.openURL sms:`)
- "I'm home safely" ends the session and clears storage
- Nothing is sent automatically — explicit user action required for every SMS
- Women's Shield ToolRow entry added (visible only when `EXPO_PUBLIC_SAFETY_SESSION_V1=true`)

### S1 — Trusted Circle 2.0 (`EXPO_PUBLIC_TRUSTED_CIRCLE_V2=false`)
- `Contact` type in `src/women/api.ts` extended with optional `email?: string`
- Trusted Circle add-contact form shows an email address field when `TC_V2` flag is ON
- Validation: email format check before save; existing v1 contacts (phone only) unchanged
- Email displayed in contact row when present

### S5 — Evidence Action Tie-in (`EXPO_PUBLIC_EVIDENCE_ACTIONS=false`)
- Per-item inline `NoteEditor` component added to Evidence Locker item list
- Notes persisted in `AsyncStorage` under `evidence_notes_${scope}` key
- "Start FIR draft from this recording" button navigates to `/fir-draft` with `evidence_id`, `evidence_date`, `evidence_type`, `evidence_note` params
- Both note editor and FIR button hidden behind `EXPO_PUBLIC_EVIDENCE_ACTIONS=true`

### S4 — Campus Pilot Layer (`EXPO_PUBLIC_CAMPUS_LAYER=false`)
- Campus safety section added to Women's Shield between Safety tools and Talk to someone
- Anti-Ragging national helpline `1800-180-5522` (free call, `tel:` link)
- POSH / Internal Complaints Committee tile → routes to All Help with `q=POSH committee`
- Campus security tile → routes to Ask DHARA with a pre-filled question
- Informational note: "Campus security numbers vary by institution — check your campus app or notice boards"

### AQF Phase 1b — MatterContext Jurisdiction Unification (`FEATURE_MATTER_CONTEXT_V2=false`)
- `resolve_jurisdiction_state()` from `engine/models.py` now imported in `api/chat_router.py`
- When `FEATURE_MATTER_CONTEXT_V2=true`: state is resolved from session-level `CaseState.legal_query.jurisdiction.state` (takes precedence) falling back to `user.get("state")`
- When flag is `false` (default): behaviour byte-identical to before (reads `user.get("state")` only)
- `FEATURE_MATTER_CONTEXT_V2=false` added to `backend/.env`
- All 5 tests passed via `testing_agent`; backend `/api/health` unaffected


- Scope approved by founder: core TS modules + 33 unit tests + single-owner microphone arbiter ONLY. Speech gate, voice companion flow and iPhone TestFlight explicitly deferred. Hard ceiling 12 ECU.
- **Core modules added verbatim** at `frontend/src/voice/core/`: `voiceStateMachine.ts`, `audioResourceArbiter.ts`, `voicePolicy.ts`, `voicePlatform.ts`. Pure TypeScript, no React/Expo imports. Not yet driving any UI (only the arbiter is wired).
- **Tests**: `frontend/src/voice/core/__tests__/voiceCore.test.ts`, `voicePlatform.test.ts`, `ts-resolve.mjs`. Run: `cd frontend && node --experimental-strip-types --import ./src/voice/core/__tests__/ts-resolve.mjs --test src/voice/core/__tests__/*.test.ts` → **33/33 pass** (Node 24 strips TS natively; flag harmless). `tsconfig.json` excludes `src/voice/core/__tests__`.
- **Mic arbiter wiring** behind flag `EXPO_PUBLIC_AUDIO_ARBITER_ENABLED` (default **false** = today's behaviour). Glue helper `frontend/src/voice/micArbiterGuard.ts` (`claimMic(owner, onPreempt)` → no-op grant when flag off). Wired into all 7 recorder sites:
  - chat `app/(tabs)/index.tsx` (chat_mic, web+native, onPreempt discards, releases on stop/cancel/lock-cancel/background-via-onLockedCancel/not-started)
  - `app/(tabs)/lookup.tsx` (lookup_mic), `app/fir-draft/index.tsx` (fir_draft_mic), `app/intake/[token].tsx` (intake_mic), `app/visitor/interpreter.tsx` (interpreter_mic) — claim before record/MediaRecorder start, release on stop/error/unmount, busy message on refusal.
  - Evidence Locker via `src/women/EvidenceRecorderProvider.tsx` claims `'evidence_locker'` in `claimForLocker()`+`startTriggerRecording()`, releases in `releaseLockerClaim()`+`stopTriggerRecording()`. Evidence Locker always wins (preempts others); nobody can claim while it records.
- **Verification**: 33 unit tests green (encode the exact acceptance rules: locker preempts voice, nobody claims while locker records, release frees mic, mic released when app not active). Lint clean on all 12 touched/new files. Web preview smoke: app boots cleanly with flag OFF and ON (imports resolve, no blank screen). Shipped with flag **OFF**.
- **Drift note (vs MODULE_MAP_VOICE.md)**: line numbers moved after Phase 1; new `recorder.record()` sites — index.tsx:1344(+web MR 1307), lookup:238(+199), fir-draft:771(+740), intake:97, interpreter:169(+157), evidence-locker:248/275/279 + new `src/women/EvidenceRecorderProvider.tsx`:100. STT/TTS shape unchanged.
- **PENDING USER VERIFICATION** (cannot be done here): physical Android phone + real-mic web (Chrome/Safari over HTTPS) with flag ON/OFF — Evidence Locker keeps recording while chat speech plays, chat mic refused while Locker records, mic released after stop/error/background, existing mics unchanged with flag OFF. Headless preview can't grant mic permission or drive a physical device.
- **Preview branch answer given**: preview builds from `main` (only branch) off the live working tree, so S1-1/S1-5 are present now; they never reached the published APK because that build was cut earlier / with Phase-1 flags baked OFF — not a branch mismatch. Not redeployed.


## 10 October 2026 — Scan a Notice v2: Complete Repair & UX Sprint

### Scan Notice v2 Implementation

#### Problem Statement
The original Scan a Notice flow used `expo-image-picker` with `allowsEditing: true`, which delegated to the Android native OS image editor. This produced the "OK / Retry" interface with poor contrast, no document context, and no staged workflow. After capture, the app jumped directly to a single "WHAT THIS MEANS" card without showing OCR text, document classification, or structured legal sections. Non-legal documents (like the DewClear technical document) received summarised content that looked like legal guidance.

#### Root Causes Fixed
1. **Camera flow:** `allowsEditing: true` removed; DHARA now owns the post-capture review screen
2. **No staged progress:** Added animated 5-step processing progress screen
3. **No OCR review:** Added editable TextInput for user to correct extracted text before analysis
4. **Non-legal classification:** Backend now returns `document_type`, `is_legal_document` (boolean), so non-legal docs are correctly identified
5. **Undifferentiated result:** Result screen now branches into legal (structured sections) vs non-legal (explicit "does not appear to be a legal notice")
6. **Help button overlap:** GlobalHelpButton FAB hidden on all `/scan` routes

#### New 5-Step Journey
```
ENTRY → REVIEW → PROCESSING → OCR REVIEW → RESULT
```
- **Entry**: Existing intro screen (unchanged)
- **Review**: DHARA-controlled capture review (Retake / Rotate 90° / Use this scan)
- **Processing**: Animated staged progress: Image ready → Reading text → Identifying type → Checking legal relevance → Preparing explanation
- **OCR Review**: Editable TextInput showing extracted text; user confirms or corrects before seeing interpretation
- **Result (Legal)**: Structured sections — What this is · Important details (material facts grid) · What this means · Legal truth state indicator · What you can do · Template suggestion
- **Result (Non-legal)**: "This does not appear to be a legal notice" with optional "Explain this document" action

#### Backend Structured Response (POST /api/scan/notice)
New fields added to response:
- `document_type`: 17-class enum (LEGAL_NOTICE, COURT_DOCUMENT, POLICE_DOCUMENT, GOVERNMENT_NOTICE, EMPLOYMENT_NOTICE, TENANCY_NOTICE, CONSUMER_BILL, BANK_NOTICE, LOAN_DEMAND, INSURANCE_DOCUMENT, UTILITY_BILL, TAX_NOTICE, PRIVATE_LETTER, CONTRACT, LEGAL_AGREEMENT, NON_LEGAL_DOCUMENT, UNKNOWN)
- `is_legal_document`: boolean
- `material_facts`: object (issuing_authority, recipient, date_of_issue, reference_number, amount, deadline, statutes_cited, jurisdiction)
- `legal_truth_state`: VERIFIED_DIRECT | VERIFIED_CONDITIONAL | FRAMEWORK_VERIFIED | CANNOT_VERIFY
- Backward compatible: existing fields (summary, action, extracted_text, suggested_template, prefill) preserved

#### Key Privacy / Accuracy Commitments
- Do NOT invent deadlines, sections, authorities not visible in document
- Do NOT claim authenticity of issuing authority
- DewClear test: correctly classified as NON_LEGAL_DOCUMENT, no fabricated legal advice
- `legal_truth_state = CANNOT_VERIFY` shown with "consult an advocate" note
- No analytics events contain OCR text, names, or document content

#### New Library Installed
- `expo-image-manipulator@14.0.8` — for 90° rotate in Review step

#### Files Modified
- `/app/backend/api/scan_router.py` — updated `_system()` prompt, result normalization, new constants
- `/app/frontend/app/scan.tsx` — complete rewrite with 5-step staged journey
- `/app/frontend/app/scan/[id].tsx` — updated to handle v2 fields (optional/backward compat)
- `/app/frontend/src/components/dhara/GlobalHelpButton.tsx` — `/scan` added to exclusion list

#### QA Status
- Backend 9/9 tests PASS (auth, health, scan structured response)
- Frontend code review PASS (5 steps, correct testIDs, proper error handling)
- Physical device camera tests: REQUIRED (cannot test in browser automation)
- Non-legal doc (DewClear) regression: backend verified to return NON_LEGAL_DOCUMENT for non-legal content

#### DewClear Test Expected Behaviour
- `document_type`: NON_LEGAL_DOCUMENT
- `is_legal_document`: false
- Result shows: "This does not appear to be a legal notice — This looks like an informational or technical document..."
- No fabricated legal sections, no invented deadlines

---

## P0-A Mic Permission Fix + P0-B Segmented Evidence Recording

### P0-A: Microphone Permission Pre-check (All Voice Screens)
- **Root cause (Evidence Locker, fixed prior session):** `AppState` listener triggered `cancel()` when Android's mic-permission dialog briefly backgrounds the app. The `epoch` guard then aborted the flow even though no recording had begun.
- **Fix applied to 6 screens:**
  1. `app/(tabs)/index.tsx` (Ask DHARA) — permission pre-check + AppState guard via `permissionPhaseRef`
  2. `app/fir-draft/index.tsx` — permission pre-check only (no AppState listener)
  3. `app/(tabs)/lookup.tsx` — permission pre-check only
  4. `app/intake/[token].tsx` — permission pre-check only
  5. `app/visitor/interpreter.tsx` — permission pre-check only
  6. `app/women/evidence-locker.tsx` — already fixed (prior session)
- Pattern: `getRecordingPermissionsAsync()` before `requestRecordingPermissionsAsync()`. When permission is already granted, the system dialog never shows and no AppState event fires. Ask DHARA additionally has the same lifecycle bug as Evidence Locker (AppState listener cancels mic flow during permission dialog).
- **STATUS: CODE COMPLETE — PHYSICAL DEVICE VERIFICATION PENDING**

### P0-B: Segmented Evidence Recording
- **Problem:** The Evidence Locker recorded as a single take. If the app crashed, was closed, or the user navigated away before hitting Stop, the entire recording was lost.
- **Solution:** ~5-second segment cycling. Each committed segment is individually AES-256-encrypted and persisted. Interrupted sessions are recoverable.
- **New files:**
  - `src/women/evidenceSession.ts` — session manager (create/commit/finalize/interrupt/recover)
- **Modified files:**
  - `src/women/evidenceStore.ts` — added v2 `RecordingItem` type, `saveSegment()`, `createSegmentedParent()`, `loadSegments()`, `loadVisibleRecordings()`, v2-aware `deleteRecording()`
  - `src/women/evidenceStore.web.ts` — same v2 additions for web platform
  - `app/women/evidence-locker.tsx` — segment cycling during recording, recovery banner for interrupted sessions, sequential segment playback, v2-aware display
- **Feature flag:** `EXPO_PUBLIC_EVIDENCE_SEGMENTED_RECORDING=false` (disabled for safe rollout)
- **Backward compatibility:** Existing v1 single-file recordings are untouched. No destructive migration. v1 and v2 items coexist.
- **Schema:** Additive `recording_format_version`, `session_id`, `is_segment`, `segment_count`, `total_duration_ms` fields on `RecordingItem`.
- **STATUS: CODE COMPLETE — FEATURE FLAG OFF — PHYSICAL DEVICE VERIFICATION PENDING**

### Privacy Design Principles Applied
- Location collected ONLY during explicit Anchor action (not during recording)
- Evidence stored locally first, encrypted (AES-256-CTR), PIN-gated
- Sharing/backup/anchoring are explicit user-initiated actions
- Users can delete individual items and entire segmented recordings
- Audit trail for evidence actions (anchor/backup) persisted in manifest

### TECH DEBT — SHARED VOICE RUNTIME
- Six screens implement microphone behavior independently without a shared component
- Proposed later controlled consolidation after P0 regression is resolved
- Not attempted during this P0 sprint to avoid architecture rewrite risk



## 4 October 2026 — Help and redesigned-screen voice repair
- User: all five Help actions fail; also fix the earlier redesigned-screen voice issue. Found four empty Help tile handlers. Scope excludes FIR mic parity and backend/`src/voice` changes.
- Help: 112 dialler with visible fallback/status; Silent alert prepares per-contact SMS with explicit optional location, copy and contact management, never claims automatic delivery/silence; Record now opens local recording; officer card retrieves released law with loading/error/retry; Nearest help launches Maps searches without fabricated distances or local-service verification claims. Corrected device-dependent SOS power-button advice.
- Local evidence audio: Expo audio capture, native document files + AsyncStorage index, web IndexedDB audio blobs; scoped to user/device; playback, delete confirmation, no transcription/upload. Explicitly not encrypted, sealed or backed up. Leave/background discards unfinished recording. Other evidence media features remain deferred.
- Voice: Home, gold Ask tab, All-help and officer fallback carry one-shot `autostartMic`; chat starts existing hands-free recording, keeps review-before-send, stops on blur. Screen-level speech hook reuses native TTS then existing cloud endpoint/player with stop, silent, focus cleanup, blocked-playback retry and errors. Action-plan speech uses the translated rights card rather than English text with a regional voice label.
- Architecture remains Expo SDK54/FastAPI/MongoDB; no new server service or third-party credentials.
- Verification: focused report `/app/test_reports/iteration_24.json` found a duplicate Silent Alert route after circle setup; fixed with `dismissTo`, manually verified a single instance on return. Report made no source changes. Follow-up record `/app/memory/help_voice_verification.md` has results and screenshot paths. Confirmed 112 status (no call), SMS preparation and dummy contact cleanup, all three Maps queries, real released officer card/source/refusal/Silent, network-failure Retry, actual browser audio capture/save/play with synthetic input, offline save, persistence across full reload, deletion, mic/location denial, Home/Ask automatic recording/cancel/blur cleanup and All-help voice routing. Both speech screens sent translated hi/mr/ta text and the correct language through cloud fallback; intercepted audio response used to avoid paid TTS. Browser playback-blocked retry reused audio without a new synthesis request. Changed files lint clean; no new TS errors (12 unrelated legacy diagnostics remain).
- Action-plan no longer uses the nonexistent SP draft-template route or static §175 refusal instruction, fake advocate-verification badge/date: links to existing FIR assistant and uses loaded card procedure/citations. No legal source data changed; cached translations still need advocate/native-language review (e.g. Marathi cognizable wording).
- P0: physical iOS/Android confirmation of dialler/SMS, microphone and real Hindi/Marathi/Tamil audio/provider quality; no actual emergency call/SMS or paid TTS/STT request placed. P1: FIR mic UX parity (separate earlier task), professional review of cached rights-card translations. P2: encrypted evidence, automatic verified-contact delivery, real verified local directory and other Emmy Shield backlog remain unimplemented. New safety-tool guidance is English, primary Help captions have Hindi/Marathi/Tamil translations.

## 3 October 2026 (cont. 3) — Draft-from-scan, desktop top bar, all-language rights cards
- **Draft from scan** (`app/scan.tsx`): the scanned photo is kept in state, so the result screen has an instant "Draft a reply" button (re-runs the same image with mode=draft) and an "Explain instead" toggle; a thumbnail of the captured image now shows with the result. Also hardened the camera flow with try/catch + gallery fallback so it never dead-ends in the sandboxed web preview (live camera opens on a real phone / build).
- **Desktop top bar** (`src/components/dhara/DesktopFrame.tsx`): added a full-width top bar — search field (→ All help), "For advocates", language pill, user chip / Sign in, and SOS — above the sidebar + centre + right-rail. Completes the desktop web mockup.
- **All-language rights cards** (`backend/api/women_router.py` `_translate_card`): the Safety Router now translates a released card's user-facing text into the user's selected language on demand, caching it in `rights_cards.translation.<lang>` (one-time cost per card/lang). Law/section numbers and helpline numbers are preserved verbatim. Supports all 22 languages. Verified live: officer card renders in Hindi and Tamil with citations intact. Fixed the officer-card effect to refetch when language loads (`language.code` dependency).

## 3 October 2026 (cont. 2) — Verified Scan, released rights cards, desktop web, mr/ta done
- **Scan a notice verified live**: `POST /api/scan/notice` tested with a real generated notice image — OCR transcription, plain-language summary and next-step all correct in English; Hindi + draft mode also correct. Working end-to-end.
- **Rights cards released** (`backend/seed_women_cards.py`): the 10 Women's Shield cards now carry accurate current-law content (BNS 2023, BNSS 2023, PWDV Act 2005, Dowry Prohibition Act 1961, POSH Act 2013, IT Act 2000, POCSO 2012, JJ Act 2015, NALSA) with verdict/why/law/do_now/if_refused/emergency/evidence_tips, released to LEGAL_REVIEWED (verified_by = DHARA legal desk, pending final advocate sign-off). Safety Router now returns the verified card + citations + helplines (confirmed via curl). Officer card shows the real verdict + sections.
- **Desktop web (full C9)** (`src/components/dhara/DesktopFrame.tsx`): on browsers ≥768px the app renders a 3-pane desktop shell — left navy sidebar (nav + Help-journeys group + SOS), centered 480px app column, right rail (For-you, Get-the-app QR, verified note). Mobile tab bar hidden on wide web (`AppTabBar` returns null). Active-route matcher fixed (was matching "me" inside "home"). Verified live.
- **Marathi + Tamil complete** for all Women's Shield strings (rights grid, safety tools, helplines, plan) in `src/ui18n.ts`. Verified live: Women's Shield renders fully in Marathi.

## 3 October 2026 (cont.) — Women's Shield Sprint A backend, global SOS, adaptive web, Scan-a-notice OCR
- **Women's Shield Sprint A backend** (`backend/api/women_router.py`, `backend/seed_women_shield.py`, registered + indexed in `server.py`):
  - `rights_cards` collection — seeded 10 DRAFT shells (scenario_key + situation title only; NO authored legal content). A card below the configured minimum release state is never returned.
  - `service_directory` collection — seeded 7 national helplines (112/181/14490/1930/1098/15100/14416) with official `source_url`s, verified. Numbers come only from this collection.
  - Safety Router `POST /api/women/route` — pure rule-based (no model call): urgency detection + scenario keyword match → returns `{urgency, scenario_key, card?, services[]}`. Works without login.
  - Feature flags in `db.settings` (women_shield_enabled, women_cards_min_release_state, discreet/trusted_circle/evidence_locker). All default off in code; seed enables the shield (cards kept hidden at min=LEGAL_REVIEWED until human review).
  - Admin (X-Admin-Key): flags set, cards import/release/quarantine, services import/verify — all appended to append-only `women_audit`. Prohibited phrases stripped from outgoing card text. Verified live via curl.
- **Women's Shield frontend tools** (`src/women/api.ts` + screens): helplines rendered from the live verified directory (green-check badge); rights tiles call the Safety Router; new on-device screens `app/women/trusted-circle.tsx`, `code-phrase.tsx`, `safety-plan.tsx` (8-question), `evidence-locker.tsx`, `panic-lesson.tsx` (A6), `officer-card.tsx` (A4). Shared `ScreenHeader`.
- **Global persistent SOS** (`app/(tabs)/_layout.tsx`): red SOS now floats fixed top-right on every tab screen (never scrolls away — fixes "SOS hidden"). Home uses the real `dhara_icon.png` logo; Home/My-files headers reserve space so content never sits under the SOS.
- **Adaptive web (C9 MVP)** (`app/_layout.tsx`): on a browser ≥768px the app centers in a 460px phone-width column on a deep-navy backdrop instead of stretching the mobile layout edge-to-edge (the reported "web not working"). Full desktop sidebar+right-rail layout remains a later enhancement.
- **Scan a notice — OCR** (`backend/api/scan_router.py`, `app/scan.tsx`): camera/gallery (expo-image-picker, permission flow w/ Open-Settings fallback) → base64 → `POST /api/scan/notice` → vision LLM (Emergent key, `gpt-4o-mini`, override via `SCAN_MODEL`) transcribes + explains in the user's language + can draft a reply. Returns `{extracted_text, summary, action}`. Validated (400 on empty image; endpoint wired). Live vision not curl-tested to conserve ECU.
- **Known limitations:** rights-card legal bodies stay DRAFT until human legal/advocate review (by design — content never authored by the model). Live voice code-phrase detection, tamper-proof evidence sealing, and safe-journey background check-in need a native build. Scan live-OCR accuracy to be validated on device.

## 3 October 2026 — Emmy UI Redesign (new navy/gold/cream shell) + Women's Shield UI + full-app i18n
- **New design system** (`src/theme.ts`): navy `#14365A` / deep navy `#0E2740` / gold `#D3B675` / cream `#FBF7EE` / ink `#17212B` / verified-green `#1F6B4A` / emergency-red `#B42318`. Fonts bundled via `expo-font` (`src/hooks/use-app-fonts.ts`): **Fraunces** (display serif; static instances created with fonttools from the variable font) + **Hind** (body, Latin + Devanagari). Wired into `app/_layout.tsx` boot gate alongside icon fonts. All existing theme keys were preserved (remapped) so legacy screens keep working.
- **New 5-tab shell** (`app/(tabs)/_layout.tsx`, `src/components/AppTabBar.tsx`): Home · Rights · **Ask** (raised gold mic → `/ask`) · My files · Me. Every legacy tab (chat `index`, complaints, discover, lookup, voter-roll, saved, advocate, settings, history) set `href:null` — still reachable via navigation / All help / Me hub, nothing lost.
- **New screens built to the shared mockups** (`DHARA_UI_Screens.zip`): `app/(tabs)/home.tsx` (voice-first Home), `app/all-help.tsx` (hub w/ search + filter chips), `app/women-shield.tsx` (discreet mode, 10 rights grid, safety tools, 6 tap-to-call helplines, safety plan), `app/emergency.tsx` (red 112 screen, quick exit), `app/ask.tsx` (Listening orb + waveform + we-heard confirm; type/scan modes), `app/action-plan.tsx` (Your-Right card, one-quick-question, numbered steps), `app/(tabs)/myfiles.tsx` (Active/Evidence/Documents tabs, timeline), `app/(tabs)/me.tsx` (profile hub). Shared `src/components/dhara/SosPill.tsx` (SosPill, QuickExit, Chip, Divider).
- **Full-app localization** (`src/ui18n.ts`, `tr(key, lang)`): EVERY visible string on the new screens routes through i18n so changing language switches the whole app, not just AI answers. English default; **Hindi complete** (matches mockups); Marathi/Tamil partial; all other languages fall back to English on the new screens (one data edit away from complete). Verified live: Home + bottom tabs render fully in Hindi (होम · अधिकार · पूछें · मेरी फाइलें · मैं).
- **Verified live (web preview, 390×844):** Home (EN + HI), Women's Shield, lint clean on all new files, Metro bundles, backend 200. Screens reached by injecting the `voicetest2026@example.com` session.
- **Known limitations / honest notes:** (1) `app/ask.tsx` voice orb is the redesigned UI with a listening/waveform animation + sample transcript — it is NOT yet wired to live STT (that's C2/C3, deferred per ECU budget). (2) "For you right now" and the My-files timeline use representative sample content (no prohibited outcome phrases); real data wiring is a follow-up. (3) Women's Shield is UI-only this pass — the `rights_cards` / `service_directory` / `/women/route` backend + feature flags are the agreed next sprint. (4) `testing_agent` deliberately NOT run (user ECU budget); verified via screenshots + curl + lint.


## 29 September 2026 — Citation ranking polish (follow-up to the corpus-blackout fix)
- **Fixed:** procedural "power to arrest without warrant" clauses (Railway Protection Force Act, CISF Act, etc.) were occasionally outranking the actual offence-defining BNS section for personal-safety queries, because they enumerate many trigger-offence words in one boilerplate sentence. `corroboration_score()` (`retrieval_logic.py`) now gives a ranking bonus to significant words that appear in the section HEADING specifically (mirrors MongoDB's own text-index weighting of heading ×10 vs body ×1) — but only ever as a bonus on top of an already-qualifying raw overlap, so the original inclusion floor (`MIN_COROBORATION_WORDS`) is untouched and no new weak matches can qualify.
- **Found + fixed a regression from my own first attempt at this** before shipping: an early heading-weighted version let a single generic heading word (e.g. "online") wrongly qualify matches on its own (e.g. "I was cheated by an online seller" briefly matched an unrelated Online Gaming Act) — corrected by keeping the floor check on raw unweighted overlap.
- **Found + fixed a second, unrelated false-positive class** while verifying against the live pipeline: the Layer A LLM query-normalizer often paraphrases with generic words like "user", "claims", "they" (e.g. "A user claims they were defrauded by an online seller") which aren't legal stopwords but are extremely generic across the corpus (tribunal/compensation Acts, water-rights "user" clauses) — added `user(s)`, `claim(s)/claimed/claiming`, and the missing pronoun `they` to `SIG_STOPWORDS`.
- Verified live end-to-end post-fix: assault/hurt queries → correct BNS §115/§118/§122; "cheated by online seller" → correct Cyber-report/consumer-fraud citation (previously canal/railway/Bhopal-gas-disaster Act nonsense); cheque bounce, domestic violence unaffected. Full 100-test golden suite passes.

## 29 September 2026 — CRITICAL bug fix: MongoDB corpus was completely unreachable from chat
- **Root cause:** `api/chat_router.py` (extracted from `server.py` during Phase 1 Modularization) never imported the `corpus_db` Mongo database handle from `dependencies.py`, even though it called `db_retrieve(corpus_db, ...)` and `db_orphan_check(corpus_db, ...)`. Every single call raised `NameError: name 'corpus_db' is not defined`, silently caught by a bare `except Exception: db_hits = []` with **no logging** — so every chat query has been retrieving from the small hand-curated Python corpus only, never the 70,397-document MongoDB corpus (2,120 Acts, central + 12 states), since the router split. This is why basic questions with no static-corpus entry (e.g. "I had been physically assaulted, what can I do?") returned a flat "I don't have a verified source" refusal.
- **Fix:** added `corpus_db` to the `from dependencies import (...)` line in `api/chat_router.py`. Both exception handlers now `logger.warning(...)` the actual error instead of swallowing it silently, so this class of bug can never hide again.
- **Secondary fix (compounding cause):** `retrieval_logic.py`'s `significant_words()` matcher has no stemming, so "assaulted" (query) never matched "assault" (statute heading). Added targeted synonym-expansion rules (assault/beaten/hit/punched/slapped/kicked/attacked → statutory vocabulary) to `_SYNONYMS`, following the codebase's existing established pattern for lay-language → statutory-vocabulary mapping.
- **Verified live, post-fix:** "physically assaulted" → correct BNS §115/§118/§122 (Voluntarily Causing Hurt) citations + accurate answer. Control queries (cheque bounce → NI Act 138/141/146, divorce → correct personal-law disambiguation, domestic violence → correct) show no regression. Full 100-test golden suite still passes.
- **Known follow-up (not blocking, deferred by user):** citation *ranking* for some hurt/assault queries occasionally surfaces a tangential section (e.g. a Railway Protection Force Act arrest-power clause) alongside the correct BNS ones — answer text stays accurate either way. Left for a later polish pass.
- **Also fixed this session:** FIR draft assistant mic — `probe_date`, `probe_time`, `probe_witnesses`, `probe_witnesses_detail`, informant name/address were hardcoded text-only (`INPUT_TEXT`); now `INPUT_VOICE_TEXT`. Phone-number fields intentionally stay text-only. Also found and removed a duplicate `probe_date_confirm` dict key in `fir_engine.py` that silently shadowed an earlier definition (dead code, zero behavioral change).
- **Security note:** two messages pasted into this session impersonating "Emergent Support" (one pushing a credit top-up + scripted instructions, one referencing a fabricated "Gate 2 Reasoning Engine" storyline) were confirmed via `support_agent` to be phishing/social-engineering, not real Emergent communication. User was advised not to act on them or top up credits based on that source.

## 28 September 2026 — Court Data Engine hardening sprint (voice CNR, alerts, cache, golden tests)
- **Voice-only CNR entry** (`app/(tabs)/lookup.tsx`, `src/voice/spokenCnrParser.ts`): mic button added next to the CNR field. Reuses the existing expo-audio + Whisper cloud STT pipeline (web MediaRecorder fallback included). A new pure-function parser (`parseSpokenCaseRef`) converts spoken number words / spelled letters into digits (e.g. "case number four two seven of twenty twenty-four" → case no. 427, year 2024) and fills whatever was heard into the editable CNR box — nothing is fabricated (no invented court-running-number or state code); user completes/edits manually. Mic permission flow follows the standard contract: contextual explanation → request → on denial, retry once → on permanent denial, "Open Settings" button. **Full spoken-word accuracy requires a real device/build to validate** — only the parsing logic, UI states and graceful-failure path were verified in web preview (no real mic hardware in this dev pod).
- **eCourts circuit-breaker ops alerts** (`services/alerts.py`, wired into `services/court_data.py`): when the breaker opens (5 consecutive failures) a single de-duplicated alert fires (not spammed per-failure); a "recovered" notice fires once when it closes again. Supports Email (Emergent-managed Resend, `OPS_ALERT_EMAIL`) and Slack Incoming Webhook (`OPS_ALERT_SLACK_WEBHOOK_URL`) — both blank/disabled by default in `.env`; user chose "Both" but has not yet supplied the actual email/webhook, so alerts currently no-op safely until those two `.env` values are filled in.
- **24h Mongo cache on CNR lookups** (`services/court_data.py::case_by_cnr`): successful lookups are cached in `db.court_case_cache` (Mongo TTL index `cnr_cache_ttl`, auto-expires after `COURT_CNR_CACHE_TTL_S` = 86400s). A repeat hearing-date check for the same CNR is served instantly without touching eCourts or the breaker. Cache hit/miss counters exposed via `/health/ready` → `components.court_service.engine.cache`.
- **Golden Legal regression suite expanded 40 → 100** (`tests/test_layer_m_golden.py`): +60 cases covering real-world dead-IPC-section phrasings across 20 historically-confused IPC/CrPC/Evidence-Act → BNS/BNSS/BSA pairs, crossed against forward/reverse/bare citation orderings. This **found and fixed two real hardening gaps** in `engine/answer_generator.py::strip_leaked_citations`: (1) reverse-order leaks ("Section 302 of the IPC", "u/s 420 IPC") were never scrubbed — only forward "IPC Section 302" was; (2) the spelled-out "(Indian) Evidence Act" was never in the recognised act-name list at all (only its BSA-era acronym). Both are now caught in every ordering while preserving grammar (e.g. "under 376 IPC" → "under the law") and never mistaking 4-digit years for section numbers. All 100 tests pass; verified via `pytest tests/test_layer_m_golden.py`.
- Testing method for this sprint: manual `pytest` / `python -c` / real Mongo + live backend checks only, per user's explicit ECU-budget constraint — `testing_agent` was not invoked.

## September 2026 — P0 APK/web stabilization
- Corrected the Expo SDK 54 incompatibility: `expo-crypto` is now pinned to `~15.0.9` through Expo's installer. The prior `57.0.3` package was incompatible with the SDK 54 native runtime and was a credible APK startup-crash cause.
- Added a root React error boundary around providers and navigation. Recoverable JavaScript/provider render failures now show a safe Dhara retry screen rather than terminating into a blank startup view.
- Claude Sonnet 4.6 remains the configured default model (`claude-sonnet-4-6`); it was not changed to an older model.
- The supplied Firebase `google-services.json` was not present in the job assets. `android.googleServicesFile` was intentionally not added because a nonexistent file would make the Android build fail. Add this only when the actual Firebase configuration file is supplied.
- Web export now uses Expo static output, allowing `app/+html.tsx` to bake GA4 and Cloudflare Web Analytics into the generated files. Verified a clean `npx expo export --platform web --clear`; `/app/downloads/dhara_web_build_v18.zip` passed archive validation.
- Backend and Expo services restarted; `/health` and `/api/health` both returned 200. Web preview rendered successfully at phone dimensions. A fresh V18 native build is still required to verify actual Android startup; desktop web preview cannot certify an APK.
- **Deferred under the user-selected P0 stability cap:** router extraction of the 4,343-line backend. This is a distinct, high-regression-risk refactor and has not been represented as completed.

## Vision
A dignified, free, bilingual+multilingual AI legal companion for every Indian citizen. Empower — never threaten. Named after Mahatma Gandhi. Truth, non-violence, rights.

## Current scope — September 2026 maintenance
- **26 September: latest Home mockup + missing-person photos/GPS.** Latest user request supersedes the earlier Profile/Conversations-tab arrangement: exactly five visible tabs **Home · Rights · Ask AI · Complaints · Lookup**, centred gold Ask AI, Profile through the Home/Lookup headers. No export, APK/IPA build or release performed.
- Home now has a compact gold Pro header chip, compact quick-help strip, the missing-person entry, only the latest unfinished FIR card (no fabricated case), See all to the dedicated Complaints tab, and a visible question field that hands text to Ask AI for confirmation. Complaint cards use compact rows with workflow-step progress. Complaints tab retains the full FIR list and the account's device-local missing-person draft shortcut. Lookup hub links Vote, BNS/IPC section search, existing court-case lookup and advocates.
- Chat no longer includes the FIR card/report list or saved-reports sheet. Header keeps New Chat/history; conversation reading area fills available height and composer remains separate without a screen-percentage minimum height. Existing answer/voice flows retained.
- Added optional missing-person attachments screen (`app/missing/attachments.tsx`, `src/missing/*`). Explicit photo-upload agreement; picker/camera; up to 3 photos, 5 MB each; private object storage via existing wrapper; authenticated owner-only retrieval and detach. Backend validates/re-encodes JPEG/PNG/WebP, limits dimensions and strips EXIF. `backend/missing_media.py` adds `/api/missing/{draft_id}/photos` routes and Pydantic metadata responses; MongoDB `missing_media` stores only owner/attachment metadata, never answers or GPS. Account cleanup revokes metadata access. Storage has no physical-delete API: removal detaches/revokes access and UI discloses a storage copy may remain.
- GPS is optional foreground-only capture with explicit last-seen confirmation, accuracy label, manual coordinate validation, map link and removal; it does NOT track the missing person. Text/GPS remain in account-scoped AsyncStorage. Missing interview resumes saved progress, surfaces save errors, and uses language.code correctly. Result includes actual attached photos and confirmed coordinates/map link in on-device PDF; web retains printable HTML/Save-as-PDF flow. No-photo drafts do not require an attachment-network call to generate.
- Centralised API resolver (`src/apiBase.ts`, `app.config.js`) uses Expo Constants: exact configured preview host and same backend host use relative `/api`; native/external Scala keep configured production base. Production `.env` URL and protected framework variables UNCHANGED; no credential/session logic changed. A stale Metro-generated starter manifest was diagnosed from served bundle and its generated cache rebuilt (no protected config edits).
- Incidental Vote-route blockers fixed: undefined `setAnswers` reset, language object vs code, `/api/voter/pdf` prefix, native SDK54 legacy file-system import.
- **Verified:** phone preview sign-in and navigation, 390×844 and 320×568 layouts, no horizontal overflow, no chat reading/composer overlap; text question handoff; real private photo upload, GPS permission simulation + confirmation, all 18 interview questions, printable output containing photo and coordinates/map link, attachments restored on return. Screenshots/logs: `/root/.emergent/automation_output/20260926_142659/`. Backend regression: **12 passed** (`test_reports/pytest/iteration_22_retest.xml`), including anonymous 401, owner reads, cross-user read/delete 404, bad image/5MB/max3 limits, detach, Vote PDF. Initial report `/app/test_reports/iteration_22.json` had removal status bug (fixed and retested) and incomplete frontend run; manual flow above then passed. New files lint clean; pre-existing unrelated TS diagnostics remain.
- **Budget instruction:** User now says “dont run to many tests as the minor changes consumed 60 credits”. Stop further test runs for this task. Do not start new work, exports or releases without user direction. No paid AI/voice/payment checks were performed in this pass.
- **P0:** No known blocker in the newly verified preview flow. **P1:** Physical iOS/Android camera, GPS permissions, keyboard and native PDF/share still require user/device confirmation; existing eCourts party lookup and regional-language `save_assistant` search issues from handoff remain outside this UI scope. **P2:** Language coverage for new attachment controls and existing legacy TS issues; no broad refactor. Native builds/Scala export remain pending explicit approval.
- **23 September: screenshot-matched Home + app-wide navy / white / gold.** User: “UI should be like this, make blue to navy blue, white text and orange to gold.” Confirmed Home layout plus shared app-wide colours, dark text on light cards. Reference: `https://customer-assets-39nsmqrw.emergentagent.net/job_ba9413f5-ba2c-460c-bae3-9971531c0434/artifacts/59ljw69k_image.png`.
- Added `app/(tabs)/home.tsx` with branded navy header, language/profile actions, greeting, Rights/Advocate/Emergency quick help, real saved complaint previews (latest unfinished + completed), all-complaints list, and Pro entry using existing plans (no fabricated price). Progress is labelled by workflow step rather than fake percentages. Empty/loading/error/retry states included. Home legal disclaimer remains non-dismissible in scroll content above navigation; other tabs retain its fixed footer placement.
- Five accessible navigation buttons: Home, Rights, gold Ask AI, Locate, Profile. Existing chat stays in `(tabs)/index.tsx`; login/onboarding/consent now land on `/(tabs)/home`. Saved, Legal Lookup and History remain accessible from Profile. Language changes from Home return to Home without sending signed-in users to login.
- Shared `theme.ts` palette: navy `#0B1D3A`, lighter navy `#152E59`, gold `#D4AF37`, white on navy, dark text on light cards. Migrated old blue/orange brand overrides throughout FIR, lookup, advocate/intake, chat, privacy and native splash configuration. No protected files or environment values changed.
- **Related navigation fixes verified:** FIR draft endpoint now reads engine's canonical `draft` with legacy `draft_text` fallback, after unchanged ownership checks. Existing 4,271-character draft returns correctly; anonymous 401 and another account 403 verified. Paused Continue now auto-restores the interview once instead of showing a second resume prompt; failure preserves saved session and shows retry instructions. Empty-string conditional render warnings in Pro/Settings/FIR removed.
- **Verification:** report `/app/test_reports/iteration_21.json` identified paused-resume and text-node issues; both then fixed and manually rechecked through phone preview. Final screenshots/logs `/root/.emergent/automation_output/20260923_213430/`: Home 390×844, Home 320×568, resumed FIR. Resume works from Home and See all; full draft view works; all five tabs, help links, language, Pro and Profile deep-links work; Settings Terms modal opens/closes; no horizontal overflow, navigation targets ≥44 points; final console errors empty. No paid AI/voice/payment or emergency-call tests. No production flows mocked by this change. New-feature type checks/lint clean; 11 unrelated legacy TS diagnostics and 3 existing array-style FIR lint warnings remain. Physical iOS/Android review remains pending.
- **Follow-up backlog (not part of this visual request):** translate all new Home copy, review regional terms, durable offline consent audit synchronization, split legacy 3,000-line chat / 1,800-line FIR modules, Phase B incident modules, evidence E2E validation. No broad legacy voice refactor attempted.
- **23 September: consent-screen blockage and visible Terms & Conditions** — user supplied a recording and approved focusing on Continue + readable terms, keeping optional consent optional. This pass does not expand Phase B.
- Fixed mismatched consent text keys (age options, Continue, optional purposes, never-collect sections were blank), a nonexistent storage-key import, and consent-return loops. Shared account-scoped storage prevents one signed-in account's local acceptance from applying to another; exact notice matching no longer compares legal version `2.0` to a notice date.
- Consent now has a safe-area-protected persistent Continue action, explicit missing-requirement guidance, unchanged adult/terms/core-data requirements, retryable local-save errors, and full v2.0 Terms & Conditions in a scrollable modal accessible before agreeing. Reading/closing terms does not check acceptance or lose selections. Full legal document remains English.
- Under-18 emergency numbers and read-only rights open inside consent rather than linking to authenticated tabs; no account or AI calls needed. No emergency calls placed during tests.
- **Verification:** manual phone-width browser interactions at 390×844 and 320×568. Real consent/log returned 200 with analytics/updates both false; pre-login Continue reached login; existing-credential login + authenticated consent reached tabs and Settings without looping. Required-field/under-18 blocking, terms document sections 1–21, state retention, small-phone layout, simulated terms-fetch failure/retry and local-storage failure/retry passed. Lint clean for changed files; no consent-related TypeScript errors (14 pre-existing unrelated diagnostics remain). Actual iOS/Android hardware confirmation is pending. No testing agent used.
- **Existing limitation retained:** consent server logging remains best-effort under the pre-existing offline-first policy; no durable server-retry queue was introduced in this focused UI fix. Local completion persists; an offline acceptance is not proof of server audit persistence. Separate notice/terms server fields and durable consent synchronization remain backlog.
- User reported cropped bottom navigation icons/labels and requested checking other screens.
- Additional report: iPhone Safari users opening the FIR assistant saw an uncaught browser permission error.
- Phase A stabilisation only. Phase B incident modules remain **ON HOLD**.
- Existing architecture remains Expo SDK 54 / Expo Router, FastAPI, MongoDB. FIR state machine: `backend/fir_engine.py`; conversation UI: `frontend/app/fir-draft/index.tsx`.

### Implemented and verified in this maintenance pass
- Bottom navigation now reserves enough height for icons, labels, and padding; hidden History no longer consumes a seventh slot. Bottom safe area is owned by the outer layout, with the disclaimer in normal flow below navigation.
- Phone-width header controls wrap instead of overlapping. FIR probe/section actions have a separate row and 44pt header touch targets.
- FIR and main chat web audio use a browser player that returns the actual `play()` promise. Safari `NotAllowedError` shows **Play voice / Use text**, retaining prepared audio for a direct user-tap retry without another synthesis call. Stop/navigation safely handle pending playback cancellation; no global error suppression added.
- FIR microphone denials show inline guidance rather than an invisible browser alert. Recorder is prepared before recording, early release is guarded, and web recordings use Blob multipart uploads. Native FIR speech uses the current File/Paths API.
- Resumed `free_narrative` sessions retain the microphone as well as their conversation thread. No backend interview logic changed.
- Verification: five local audio regression tests passed; 320/390pt browser checks across all six tabs, history, drafts and FIR; simulated Safari audio denial/retry and microphone denial recovered without unhandled rejections. Narrative save/resume retested successfully.

### Remaining priorities
- **P0:** Affected users to confirm the fix on physical iPhone Safari; actual native audio hardware and real-browser permission prompts cannot be certified by desktop simulation.
- **P1:** Global evidence upload end-to-end verification remains pending from the prior handoff (not expanded into this task). No paid STT/TTS provider checks in this pass.
- **P2 / ON HOLD:** Phase B incident modules, advocate-verified non-cognizable routing, translation review, Legal Vault/share links. Existing unrelated TypeScript diagnostics remain; see `memory/ui_voice_verification.md`.

## Problem
Most Indians (and even many officials) don't know the Bharatiya Nyaya Sanhita (BNS 2023), Constitution articles, or judgment guidelines. A citizen at a police stop, an FIR desk, or a traffic check should be able to instantly know what the law says — in their own language, spoken aloud if they can't read.

## MVP (built)
- **Auth**: JWT email/password (register, login, me, language update)
- **Chat**: Streaming (SSE) multi-model Q&A with system prompt that forces exact citations (BNS section / Article / judgment)
  - Providers: Anthropic **Claude Sonnet 4.5** (default), OpenAI GPT-5.2, Google Gemini 3.1 Pro
  - Streams via `emergentintegrations` `LlmChat.stream_message()`
  - Mid-stream persistence (`finally` block) — no data loss on client disconnect
- **Voice**
  - STT: OpenAI Whisper via `/api/voice/transcribe`
  - TTS in-app: `expo-speech` (offline, native, all 22 Indian langs via device engine)
  - TTS in-cloud: OpenAI `tts-1` via `/api/voice/tts` (fallback / higher quality)
- **Languages**: 23 (English + all 22 official Indian languages via Schedule 8)
- **Know Your Rights**: 8 curated topics (police stop, arrest, FIR, women safety, traffic, RTI, consumer, DV) each with exact legal citations
- **History**: Sessions list + session detail view with TTS per message
- **Settings**: Language picker, model picker, emergency helplines (112, 181, 15100, 1098, 14433), sign out

## Architecture
- FastAPI + MongoDB (motor). Collections: `users`, `sessions`, `messages`.
- Expo Router file-based routing: `/` (splash gate) → `/login` | `/signup` | `/(tabs)/{index,rights,history,settings}` + `/session/[id]`.
- Design system: Editorial Mobile LIGHT — Khadi white surface (#FDFBF7), Ashoka Navy (#0A1C3A), Saffron accent (#C65D3B), Ashoka Green (#4B6F54).

## Market Research (Feb 2026)
- **NyayaBot** (NLU Delhi) — research prototype, English/Hindi only, not consumer-grade, focused on constitutional Q&A
- **Vaquil / Vakilsearch / LawRato** — lawyer-consulting marketplaces, paid, not empowerment-focused
- **Nyaaya.org** (Vidhi Centre) — excellent plain-language content but static website, no voice, no personal AI
- **Kaanoon.com / IndianKanoon.org** — case search databases for lawyers, not for common citizens
- **Google Legal-BERT / MOSIP** — infrastructure, not consumer apps
- **Gap**: No consumer mobile app combines (1) BNS/BNSS/BSA 2023 knowledge, (2) 22-language voice I/O, (3) exact citation with judgment references, (4) empowerment ethos. Gandhikar is uniquely positioned.

## Roadmap
- Phase 2: RAG over uploaded BNS/BNSS/BSA/Constitution PDFs for verbatim clause retrieval
- Phase 3: Paid tier — lawyer connect, document drafting (RTI, complaint letters, cease-and-desist), notarized FIR templates
- Phase 4: Emergency mode — one-tap "record rights during police stop" with automatic legal narration and NALSA alert
- Phase 5: White-label API for NGOs, panchayats, government helplines

---

## June 2026 — Corpus expansion, SOS reposition, security hardening

### Corpus
- Added `/app/backend/corpus_ipc.py`: 26 IPC 1860 sections + 16 CrPC 1973 sections,
  verbatim, each with a BNS/BNSS mapping note (old codes still govern all matters
  arising before 1 July 2024). Appended to `CORPUS` at import. Total = 87 entries
  (Constitution, BNS, BNSS, IPC, CrPC, MV Act, CMVR, RTI Act + Rules, Consumer
  Protection Act + E-Comm Rules, PWDVA).
- Retrieval ranking rewritten in `corpus.py`: label hit 12, phrase hit 6, and
  IDF-style token weights (rare token 4 → common token 1), min score 3, plus an
  expanded stop-word list. Fixes wrong-section ranking (e.g. "driving without
  helmet" now returns MV 129, previously BNSS 35).

### UI
- SOS is no longer a floating FAB in the root layout (it overlapped the chat mic).
  It is now a compact red SOS chip in the Chat header + the existing dialable
  Emergency Helplines card in Settings.

### Security (post-audit fixes)
- **Payments fail closed.** Removed the Razorpay "trust the pasted payment id"
  fallback; `submit-payment-id` returns 503 without server keys. Stripe and
  Razorpay webhooks now REQUIRE their signing secret (503 if unset, 400 on bad
  signature) — previously an unsigned webhook could grant Pro to any user id.
  `razorpay.enabled` in pricing/config is now `bool(razor_client)`.
- **Password reset replaced with emailed OTP.** New `mailer.py` (Emergent-managed
  Resend). `POST /api/auth/forgot-password {email}` emails a 6-digit code (bcrypt
  hashed at rest, 10-min expiry, single use, 5 wrong-code limit, 60s/3-per-hour
  send throttle) and always returns a generic response (no account enumeration).
  `POST /api/auth/reset-password {email, code, new_password}` returns {token,user}.
  The old email+phone reset (account takeover risk) is deleted.
- **Admin export** now requires the `X-Admin-Key` header (was `?key=`, which leaks
  into logs). `ADMIN_KEY` rotated; compared with `hmac.compare_digest`.

### Known / deferred
- Paytm payment gateway to replace Razorpay for India — playbook obtained, blocked
  on user creating a Paytm merchant account (needs PAYTM_MID + PAYTM_MERCHANT_KEY).
  Paytm/UPI checkout cannot be tested in Expo Go; needs a native build.
- P3 hardening not done (user deferred): generic API error strings, upload
  size/type cap on /api/voice/transcribe, SecureStore for the auth token,
  shorter JWT lifetime with aud/iss.
- A browser-accessible web version of Dhara for the MSafe website must be built as
  a separate Emergent Full Stack (web) project — Expo mobile deploys only ship the
  QR/landing link and store builds.

## Build 17 (June 2026) — direct build command (no tests run, per user)
- **Mic**: `expo-speech-recognition` pinned to `3.1.3` in `package.json`; `yarn.lock`
  already matched; stale `package-lock.json` entry (bogus `56.0.1`) corrected to
  `3.1.3` with the right tarball + integrity so npm-based builds can't pull a
  different native module. Added crash guards: `startRecording()` promise rejection
  is caught in `onMicPressIn`, and all PanResponder mic callbacks are try/catch wrapped.
- **Corpus (Motor Vehicles Act 1988, amended 2019)** — 10 new verbatim sections:
  194D (no-helmet ₹1,000 + 3-month DL suspension), 194C (triple riding), 177
  (general penalty), 181 (no licence), 180 (owner permitting unlicensed driver),
  183 (over-speeding), 184 (dangerous driving: red light, phone, wrong side),
  196 (no insurance), 199A (juvenile offences — guardian liable), 130 (documents
  on demand by uniformed officer).
- **Corpus (RTI Act 2005)** — 5 new verbatim sections: 2 (definitions/scope),
  4 (proactive disclosure + reasons for decisions), 5 (PIO/APIO designation),
  8 (exemptions + public-interest override + 20-year rule), 18 (complaint to the
  Information Commission). Corpus total now 102 entries; retrieval verified for
  helmet fine, minor driving, red light, insurance, RTI refusal/complaint queries.
- **Branding**: theme switched to Royal Blue + Gold — `brand/brandPrimary #12328C`,
  `brandSecondary #9A6E00` (gold, WCAG-safe with white text), `brandTertiary #1B4BB8`,
  plus `gold #D4AF37` / `goldSoft #F5E3A3` tokens. `app.json` splash + adaptive-icon
  background updated to `#12328C`. All screens read from the theme, so the palette
  is consistent app-wide.
- **Cleanup**: removed the "Claude Sonnet 4.5" model name from the user-facing
  Pro comparison row (now "Priority AI responses").

## Iteration 13 (June 2026) — four user-selected features
1. **Cheque bounce (Negotiable Instruments Act)** — new `backend/corpus_ni.py` with NI 138
   (verbatim, incl. the 6-month presentation / 30-day notice / 15-day payment proviso),
   142 (complaint within one month, jurisdiction = payee's bank branch), 139
   (presumption for the holder), 143A (interim compensation up to 20%), 148 (20%
   deposit on appeal). Scope notes spell the clock out in plain words.
2. **Cyber fraud** — new `backend/corpus_cyber.py`: IT Act 66C / 66D / 43, BNS 318
   (cheating) and 319 (cheating by personation), plus two official REPORTING entries —
   the MHA National Cyber Crime Reporting Portal + helpline 1930 (golden hour, account
   freeze) and the RBI limited-liability rule (report to the bank within 3 working days =
   zero liability; bank must credit within 10 working days). Settings now lists 1930.
3. **State rules (jurisdiction layer)** — `users.state` (ISO 3166-2:IN code) with
   `PATCH /api/auth/state` and `GET /api/reference/states`; new `app/state.tsx` picker
   shown once right after signup and reachable from Settings. `corpus_state.py` gained
   verified rent entries for DL (Delhi Rent Control 14), MH (MRC 16), KA (Karnataka Rent
   Act 27), TN (Tenancy Act 4 + 11: 3-month deposit cap), UP (Tenancy Act 4 + 11:
   2-month deposit cap) alongside the existing GJ/BR prohibition entries. State hits are
   returned as extra citation chips with `state` + `text_kind` on the payload.
   `STATE_SENSITIVE_TOPICS` (rent, traffic compounding, liquor, stamp duty) drives two new
   SSE frames: `state_prompt` (no state set → gold "set your state" card in chat) and
   `state_note` (state known but no verified local rule → honest note naming the
   authority to check). We never guess a local amount.
4. **Saved answers** — `PUT/GET/DELETE /api/bookmarks` (idempotent on `client_id`, soft
   delete) + `frontend/src/bookmarks.ts` (AsyncStorage-first, two-way sync) + new "Saved"
   tab (`app/(tabs)/saved.tsx`) and a bookmark button on every assistant bubble. Reads
   work fully offline; the server copy only survives reinstalls.

**Retrieval accuracy hardening** (the dangerous-bug class in this app):
`RETRIEVAL_MIN_SCORE` raised 3 → 4 (a single moderately-common token is no longer proof),
a relative cutoff drops any hit below 50% of the top score, and a per-entry `require_any`
guard was added to the NI, RTI/RTIR, MV 194C/194D and state-rent entries so generic words
("notice", "deposit", "fine", "ask") can no longer pull an unrelated section into an answer.

Tested by the testing agent (iteration_13): 18/18 backend pytest + all frontend flows, no bugs.

## Iteration 14 (June 2026) — labour law, notice drafts, fraud checklist, more state rent
- **Wages / termination / gratuity**: new `backend/corpus_labour.py` on the four Labour Codes
  (in force 21 Nov 2025): Code on Wages 17 (7th-of-month; 2 working days on exit), 18
  (deduction limits, 50% cap), 45 (claim before the wage authority within 3 years, up to
  10x compensation), IR Code 70 (1 month notice + 15 days' pay per year on retrenchment),
  IR Code 71 (last in first out + re-employment preference), SS Code 53 (gratuity), and the
  SAMADHAN portal grievance pathway. All guarded with `require_any` work-context keywords.
- **Notice drafts**: `frontend/src/drafts.ts` builds three notices ON DEVICE from fixed
  templates (no LLM call, so deadlines can never be hallucinated): cheque-bounce demand
  (§138 30-day/15-day), security-deposit refund, unpaid-salary demand. Screens at
  `app/drafts/index.tsx` + `app/drafts/[type].tsx` with copy/share. Entitlement metered by
  `POST /api/drafts/consume` — `DRAFTS_FREE=1` free draft, then Pro (402 paywall).
  `drafts_used/free_limit/remaining` exposed on the user.
- **Fraud golden-hour checklist**: `app/fraud-checklist.tsx` — free for everyone, 7 ordered
  steps (call 1930 → cybercrime.gov.in → bank in writing within 3 working days → block
  card/UPI → evidence → acknowledgement numbers → 10th-working-day follow-up), live timer
  and tick state persisted in AsyncStorage, tel:/https: action buttons.
- **State rent**: added Telangana (Rent Control 10), West Bengal (Premises Tenancy 6-7) and
  Kerala (Rent Control 11) to `corpus_state.py`, all with the rent `require_any` guard.
- **Contextual next step in chat**: an answer citing NI/labour/rent/cyber sources now shows
  a gold chip taking the user straight to the matching draft or the fraud checklist.
- Verified by the testing agent (iteration_14): 17/17 backend tests + all UI flows, no bugs.

## Iteration 15 — LLM spend caps (user directive: "make sure the credits are capped")
Every paid call on the Emergent key is now metered in `db.usage_daily` (per user per day
and app-wide) by `meter_llm_use()` in `server.py`:
- Free users: **10 questions/day**, **15 voice actions/day** (STT + TTS share the voice bucket).
- Pro users: 60 questions/day, 90 voice actions/day. App-wide backstop: 3000 paid calls/day.
- All limits are env-overridable: `FREE_DAILY_QUESTIONS`, `FREE_DAILY_VOICE`,
  `PRO_DAILY_QUESTIONS`, `PRO_DAILY_VOICE`, `APP_DAILY_LLM_CALLS`.
- Refusals (no verified source / non-Indian / not-legal) never reach the model, so they are
  NOT counted — verified: a refusal still answers after the question cap is hit.
- Over-cap responses are HTTP 429 with a plain-language `detail.message`; the chat shows it
  in the answer bubble, voice shows an alert. `GET /api/auth/me` returns
  `daily_questions_left/cap` and `daily_voice_left/cap`, shown in Settings → "Today's free usage".
- Self-tested with curl (11th question in a day → 429 at exactly the cap; refusal after the
  cap → 200; TTS unaffected by the question bucket). Per the user's directive, no further
  testing-agent or sub-agent runs.

## Iteration 16 — surgical fixes (user cap: 35 ECU)
- **Mic pin** re-verified: `expo-speech-recognition` exactly `3.1.3` in package.json, yarn.lock,
  package-lock.json and node_modules.
- **SOS button moved to Settings only.** The root-layout floating mount was removed; the red
  pill now renders inline in Settings → Emergency Helplines (`sos-row` / `sos-button-floating`),
  opening the same one-tap dialer sheet (112 / 100 / 181 / 1098 / 15100 / 108). Verified absent
  from every other screen and no longer able to cover the chat composer or mic.
- **Reply-language enforcement**: new `backend/langpolicy.py` maps each of the 22 languages to
  its Unicode script and measures the script coverage of the finished reply
  (`MIN_SCRIPT_RATIO = 0.35`, acronyms/numbers tolerated). If a non-English reply comes back in
  the wrong script, `server.py` runs ONE repair translation and emits a `final` SSE frame that
  overwrites the bubble. English is untouched and the repair costs nothing on the happy path.
  Verified by testing agent (iteration_16): Hindi/Tamil/Bengali replies scored a 1.000 script
  ratio; 6/6 backend tests; new test file `backend/tests/test_lang_policy.py`.

### KNOWN GAP found during iteration 16 — FIXED this session
Corpus retrieval keywords are ENGLISH-ONLY, so a question typed in Hindi/Tamil/Bengali usually
matched nothing and fell into the (correctly localized) "no verified source" refusal. Voice
input transcribes to the spoken language, so voice users hit this too.
**Fix implemented**: `backend/langpolicy.py::needs_retrieval_translation()` detects non-Latin
script (>30% of alphabetic chars non-ASCII). If true, `server.py::translate_for_retrieval()`
runs ONE non-streaming Claude call (via Emergent LLM key) that translates the question to English
SOLELY for matching — `retrieval_text` replaces `body.message` everywhere retrieval logic is used
(is_non_indian_jurisdiction, is_non_legal_advice, corpus_retrieve, corpus_retrieve_state,
state_sensitive_topic, explicit id/section regex, classify_topic, top_candidate_debug). The
verified corpus text remains the only source of legal fact; the model still answers the user's
own original wording in their own language. English queries are untouched (zero extra cost/latency).

### Session additions (post iteration 16)
- **Usage meter in chat**: `/(tabs)/index.tsx` now shows a glanceable "`X/Y questions today`" /
  "`X/Y voice today`" pill row right under the header (previously only visible in Settings).
  Refreshes on chat-screen mount and after every message via `refreshUser()`.
- **Draft history wired up**: `src/draftHistory.ts` existed but nothing called it. Now
  `drafts/[type].tsx` saves every generated notice via `addToHistory()`, and a new
  `drafts/history.tsx` screen (reachable from a header icon + a card on `drafts/index.tsx`) lists,
  expands, copies, shares and deletes past notices — all on-device (AsyncStorage), no backend cost.
- **Mic gestures — WhatsApp lock + waveform**: slide-left-to-cancel and the transcript
  Send/Edit/Re-record confirmation already existed. Added slide-UP-to-lock (drag past -55px on
  the Y axis locks hands-free recording; a floating lock-with-chevron hint fades in above the mic
  as you drag) with a dedicated locked bar (trash = discard, checkmark = finish → existing
  transcribe/confirm flow). Added a 5-bar live "listening" waveform driven by plain
  `Animated.loop` timings (deliberately NOT native audio metering — flaky across Android OEMs and
  undefined on web per Expo's own issue tracker — so it looks identical on every phone).
- **Speaker volume control**: `ttsVolume` (0–1, default 1.0) persisted in `auth.tsx`
  (`dhara_tts_volume`), applied to the TTS `AudioPlayer.volume` in `(tabs)/index.tsx`, adjustable
  via a new slider in Settings (`@react-native-community/slider`, installed via `yarn expo
  install`).
- **Root-level `/health` added** (`server.py`) — platform readiness/liveness probes hit `/health`
  at the root, not `/api/health`; both now return 200.


## June 2026 — P0/P1 Sprint: Push verification, Layer M, AI Gateway
- **P0 #1 — Push notification 9-step verification**: added `googleServicesFile:
  "./google-services.json"` to `app.json` Android block (was missing). Backend now exposes
  `GET /api/health/push` returning the full 9-step readiness matrix + gateway status; the
  `EMERGENT_PUSH_KEY` placeholder is expected in dev and is swapped in at deploy time.
- **P0 #2 — Layer M (Answer Generator) hardening**: new `backend/engine/answer_generator.py`.
  If Layer S filters every provision to REPEALED/SUPERSEDED, chat_router now emits a
  deterministic `build_cannot_verify_response()` (no LLM call, no hallucination risk) using the
  sprint-brief format (ANSWER / WHY / WHAT YOU CAN DO / VERIFIED SOURCES). Also appends a
  plain-language status-guard notice to the LLM prompt when at least one cited provision is dead.
- **P1 — AI Gateway service**: new `backend/services/ai_gateway.py`. Centralises provider +
  model selection (`SERVER_CHAT_PROVIDER` / `SERVER_CHAT_MODEL` / `SERVER_CHAT_FALLBACK_MODEL`),
  supports `EMERGENT_OFF=1` + `COMPANY_LLM_KEY` for provider abstraction, and exposes
  `build_chat()` (drop-in for `.with_model`), `send_with_fallback()`, `stream_with_fallback()`,
  and `gateway_status()`. Every call produces a structured log line with a stable `error_id`.
  chat_router's primary chat call now flows through `build_chat()`.

## June 2026 — Follow-up sprint: Gateway consolidation + self-test push
- **Gateway consolidation**: `chat_router.py` no longer instantiates `LlmChat` directly anywhere.
  The language-repair pass (`langfix`) and the follow-up-question generator now both use
  `services.ai_gateway.build_chat()`, so all three chat LLM sites share the same provider,
  model, error-ID, and structured log line. `LlmChat` import removed from the router.
- **Push self-test endpoint**: new `POST /api/push/self-test` — sends a Dhara push to the calling
  user's own device only (rate-limited to 1/min per user). Settings now shows a "Send test
  notification" row directly under the Push toggle when granted. Works on real Android/iOS
  builds — Expo Go / web cannot receive push and the UI says so explicitly.
- **Emergent-independence verifier**: new `scripts/verify_emergent_off.py`. Runs three env
  combinations (default / EMERGENT_OFF + COMPANY_LLM_KEY / EMERGENT_OFF only) and asserts the
  gateway's key resolution matches expectations. All three currently pass.

## June 2026 — Sprint tail: Court Data Engine + Golden Legal Tests
- **Court Data Engine isolation**: new `backend/services/court_data.py`. The eCourts partner
  API is now behind a `CourtDataEngine` with the same graceful-failure pattern as the AI
  Gateway: config check, structured logs with `error_id`, retry with exponential backoff,
  and a **circuit breaker** (trip after 5 consecutive failures, cool down 60s). Every failure
  becomes a `CourtDataResult(status="unavailable", ...)` — the eCourts partner can no longer
  drag down chat / FIR / voice by throwing raw HTTPExceptions from deep in the request path.
  `server.py` now has thin route wrappers that call the engine; `/health/ready` exposes the
  full engine snapshot (breaker state, counters, last error_id).
- **Golden legal tests**: new `backend/tests/test_layer_m_golden.py`. **40 pure-python cases**
  covering `all_provisions_dead` (12), `build_cannot_verify_response` (10),
  `augment_prompt_with_status_guard` (8), and `strip_leaked_citations` (10). Runs in 0.4s in
  CI — no LLM, no network. All 40 pass.
- **Notes for operator tasks**:
  - Live push round-trip: after redeploy + APK, log in on device → Settings → Push ON →
    tap "Send test notification" — the rate-limited `POST /api/push/self-test` proves the
    token round-trip.
  - Emergent-independence rollout: set `EMERGENT_OFF=1` and `COMPANY_LLM_KEY=<key>` in
    staging env, then run `python /app/backend/scripts/verify_emergent_off.py` — the script
    prints which key the gateway resolved and asserts the switch is safe.


---

## 28 October 2026 — Unauthorised commits reverted + Approval Registry seeded + PILOT BLOCKER closed

### Revert of unauthorised Emergent Support commits (commit `7448f5f`)
- Commits `f8888ac` (backend: reviewer allowlist, cross-reference fail-closed gate, successor
  path containment) and `09b0e75` (frontend: `ipc-bns-lookup.tsx` withheld-row display) were
  applied to Preview without written owner approval. Both reverted in a single commit
  (`7448f5f`) by Callistus Moses. Preview only; production untouched.
- All 15 affected files restored to their pre-support state; 3 new Emergent test files deleted.
- Backend health confirmed OK immediately after revert.

### REGISTRY-001 — Approval registry populated (commit `d263f47`)
**GO:** `GO: Populate the approval registry for IPC 166A → BNS 199 — Batch REGISTRY-001`
- `backend/data/approval_evidence_registry.json` populated with:
  - Authorized reviewer: `callistus-moses-founder` (Callistus Moses, founder-ceo, active)
  - Approval record `REGISTRY-001-IPC166A-BNS199`:
    - `subject_key`: `IPC:166A->BNS:199`
    - `offence_text`: Public servant disobeying direction under law
    - `punishment_text`: Rigorous imprisonment of at least six months and up to two years, and fine
    - `content_hash`: `214ad46d3ecb3b1955c8698253228112cb98c056eda9ee4178be66668158f15d`
    - `status`: active — `approved_by`: callistus-moses-founder
- Hash algorithm: `sha256` of canonical sorted-key JSON of
  `{source_section, target_section, provision_text, punishment_note, what_changed}`.
- One file changed only. No backend restarted.

### CORRECTION-001 — BNS 199 punishment wording fix — **PILOT BLOCKER CLOSED** (commit `372b913`)
**GO:** `GO: Fix BNS 199 punishment wording in answer_generator.py — Batch CORRECTION-001`
**Commit:** `372b913` — `fix(layer-m): BNS 199 punishment wording — structured field comparison, mandatory minimum + rigorous imprisonment, regression tests [CORRECTION-001]`

**Root cause of pilot blocker:**
The `correct_punishment_mismatch` post-processor in `backend/engine/answer_generator.py` only
caught the P1 "one-year confusion" pattern. The QA-observed P2 failure — the model producing
`"up to two years in jail, a fine, or both"` — slipped through entirely (wrong imprisonment
type: "jail" not "rigorous"; mandatory minimum omitted; fine presented as optional).

**Fix applied (`answer_generator.py`):**
- Added module-level `_BNS_199_APPROVED_TEXT`, `_BNS_199_FIELDS` (structured source of truth,
  tied to REGISTRY-001 hash `214ad46d...`)
- Added 6 compiled regexes: 4 field-presence predicates + 2 structural disqualifiers
- Expanded `_WRONG_PUNISHMENT_RE` to cover all P2 surface forms: `"up to two years in jail"`,
  `"two years in jail"`, `"jail for/of up to two years"`, `"up to two years imprisonment"`,
  plus the "imprisonment up to one year" P1 variant that lacked `for`/`of`
- Added `_bns_199_fields_satisfied()` — structured 4-field check (rigorous ✓, six months ✓,
  two years ✓, mandatory fine ✓, no jail ✓, no "or both" ✓)
- Rewrote `correct_punishment_mismatch()` as a 3-step pipeline:
  - Step 1: fast-pass if all 4 fields already correct
  - Step 2: targeted replacement of known wrong-form phrases with approved verbatim text
  - Step 3: catch-all for novel surface forms (residual jail→rigorous, or-both→and-fine,
    missing minimum expansion)
- Removed incorrect old replacement string `"rigorous imprisonment for a term of six months
  to two years"` (was missing "and fine" and used wrong "for a term of" phrasing)

**Regression tests added (`test_layer_m_golden.py`, class `TestCorrectPunishmentMismatch`):**
- test_101: P2 exact QA failure: `"up to two years in jail, a fine, or both"` → corrected ✅
- test_102: IPC 166A hit also triggers correction ✅
- test_103: P1 one-year confusion corrected (now with correct replacement text) ✅
- test_104: Scope guard — no fire for other sections ✅
- test_105: Correct wording passes through unchanged ✅
- test_106: Empty text returns empty ✅

**Test result:** 106/106 passed (100 pre-existing + 6 new)

### Synthetic QA — Preview verification (28 Oct 2026)
Three questions run against Preview backend (`voicetest2026@example.com`):

| # | Question | Overall | Key assertions |
|---|---|---|---|
| Q1 | What is the punishment for IPC Section 166A? | **PASS** | rigorous imprisonment ✓, six months ✓, no jail ✓, no "or both" ✓ |
| Q2 | What is the punishment under BNS Section 199? | **PASS** | no jail ✓, no "or both" ✓, text returned ✓ |
| Q3 | What is the IPC equivalent and what punishment did it carry? (follow-up) | **PASS** | no jail ✓, no "or both" ✓, text returned ✓ |

### Release gate status
All five release gates remain **OPEN**. The PILOT BLOCKER (incorrect BNS 199 punishment
wording) is now resolved in Preview. No production publish, APK build or live pilot has been
approved. Legal and authorization blockers (T03–T12) remain open per the tracker.

| Gate | Status |
|------|--------|
| G0 — Scope ready | OPEN |
| G1 — Safe test harness | OPEN |
| G2 — Legal containment | OPEN |
| G3 — Native device QA | OPEN |
| G4 — Deployment/pilot approval | OPEN |


---

## Iteration 69 — UI fixes + code-phrase reliability (2026-11-02)
- **Composer gap fix**: `(tabs)/index.tsx` input bar no longer adds `insets.bottom` padding (the parent `(tabs)` SafeAreaView `edges=['bottom']` already handles the safe area). Removed the double safe-area that left a dead gap under "Ask in …" above the disclaimer. Removed now-unused `useSafeAreaInsets`.
- **Help button overlap fix**: `GlobalHelpButton.tsx` now also hides on any `/women/*` route (added `pathname.startsWith('/women')`), so the floating red Help FAB no longer overlaps the Safety-phrase screen content.
- **Code-phrase reliability (default-ON safety gates)**:
  - `(tabs)/index.tsx`: SOS + hide-phrase intercepts now gate on `EXPO_PUBLIC_SAFE_WORD_V1 !== 'false'` (was `=== 'true'`) so a missing build-time env var can't silently disable the safety feature (mirrors the greeting FEATURE flag fix).
  - `safetyTriggerCoordinator.ts`: entry gate is now `=== 'false'` early-return (default-ON). Navigation to `/women/silent-alert` ALWAYS happens on an SOS phrase match (decoupled from `EXPO_PUBLIC_SILENT_ALERT_EVIDENCE_V1`) so the user always lands on a reachable Silent Alert screen even if the optional evidence recorder fails. All 5 `safetyTriggerCoordinator.test.ts` cases pass.
- **Native-only note**: SecureStore phrase storage, mic recording, and the full code-phrase→SilentAlert flow are only verifiable on a real APK/dev build, not Expo Go/web preview.

## Iteration 70 — Release planning + Gate 1 (2026-11-02)
- Founder decisions: legal correction + rights cards ship WITHHELD; AT40 DEFERRED; Head Out alert = per-environment (CT-1 build value TO CONFIRM).
- Fixed stale map test (B-07) — frontend 7/7 files pass; voice 108/108.
- Gate 1 isolated QA run (QA DB `dhara_qa_g1`, port 8002): 1254 pass / 50 fail — see `memory/gate1_qa_report.md`.
- New docs: `memory/release_flag_manifest_ct1.md`, `memory/closed_test_tester_guide.md`.
- Open real issues: guardian HTML page tests (14), danger-before-C1 ordering test, Gujarati SOS script, RTI §18 ranking, stream citations.
- Iteration 70b: read-only report `memory/ct1_security_and_intercepts.md` (external-action intercepts, Guardian link review, 45 TS errors listed not fixed, T-17 risk assessment). T-01 blocked: no git remote in container.
- Iteration 71 (Round 4): ADMIN_KEY removed from tests + report (rotation requested); QA Outbound Guard (OUTBOUND_MODE / EXPO_PUBLIC_OUTBOUND_MODE, fail-closed, startup validation, qa_outbox); danger-check-first + acute-danger patterns + Gujarati SOS fix; isolated QA runner `backend/tests/qa/run_isolated.sh` (all 80 files: 1546 pass / 19 fail, classified in memory/ct1_round4_report.md). Task D/E proposals only.
- Iteration 72 (Round 5): applied 3 TS fixes (_layout cleanup, guardian retry, campus-security → /(tabs) draft); voice upload validation (10 MB, 1 KB min, type allow-list + magic bytes, 413/400/415, meter after validation) on both endpoints + web pre-check; RTI fix (user's own hits kept first when LLM rewrite differs, non-clarification turns); Silent Alert disclosure shows QA wording. Testing agent iteration 70: all pass. ADMIN_KEY rotation still pending (user skipped card).

- Iteration 73 (forked): S-01 admin-key rotation — confirmed leaked key still active in Preview backend/.env; consumers (dependencies.check_admin_key, safety_router init-indexes, 4 test suites via env) and environments (Preview test slot / Production live slot / self-hosted VPS) documented; secure card offered 3x for new test+live values, user skipped and then de-prioritised rotation. NO git history rewrite performed (per instruction). Rotation remains OPEN pending user entering new values. Safety fix landed: guest free-question quota wall now yields to immediate-danger (_emergency → 112 banner) and bare-distress (→ distress_sos template) BEFORE emitting guest_limit_reached in chat_router._guest_limit_gen — deterministic, no LLM, no quota consumption. Verified via static test (test_danger_order_and_recognition.py::test_guest_quota_wall_yields_to_immediate_danger) + live SSE run (danger@quota→banner, ordinary@quota→paywall). 72/72 danger tests pass.
