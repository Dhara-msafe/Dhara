# DHARA CT-1 — Round 4 Execution Report

- Starting SHA for every task: `ce60af8` (`main`).
- Owner: Emergent (main agent), except where a task is marked FOUNDER or QA.
- Changes are uncommitted until the platform's auto-commit. The commit reference is the next auto-commit after `ce60af8`.

---

## P0: Credential exposure (security incident)

| Item | Finding |
|---|---|
| Credential | `ADMIN_KEY`: DHARA's own operator key for `/api/admin/*` (CSV export of all users and chats, flags, evidence vault admin). Not a third-party service. Checked by `dependencies.py::check_admin_key` and `api/safety_router.py:230`. |
| Still valid? | **Yes.** The hard-coded value equals the current preview (test-slot) `backend/.env` value, compared by equality without printing. The live (production) slot value can't be read from here, so assume it's the same until rotated. |
| Where it was exposed (working tree) | `backend/tests/test_evidence_vault_b5.py:19`, `backend/tests/test_refusal_analytics.py:19`, `test_reports/iteration_60.json` (testing-agent report) |
| Git history | First added in `e52893f` (2026-08-20), again in `edf3c62` (2026-10-10). It is still in every later commit's history. |
| Pushed copies | This workspace has no git remote and no record of a push. The platform's GitHub mirroring can't be verified until T-01 access exists, so **treat it as exposed**. |
| Build/artefacts | Not in `backend/webdist` (the tracked web bundle) or `frontend/dist`. Test files are not bundled into the Expo app. |
| Fixed now | All 3 occurrences replaced. The tests now read `os.environ["ADMIN_KEY"]`, injected only by `tests/qa/run_isolated.sh`. The report file is redacted. `git grep` finds no other copies in the working tree. |
| Rotation | Requested through the secure secrets card (preview and production slots). The old value stops working as soon as both slots are replaced, because the server checks only the current env value, so revocation happens automatically. Production needs a **re-publish** for the new live value to take effect. |

**History-cleanup plan (not executed; needs approval and coordination):**
1. Rotate first. After rotation the leaked value is useless, which lowers the urgency of rewriting history.
2. Freeze pushes. Run `git filter-repo --replace-text` with the literal value mapped to `[REDACTED]` on a fresh mirror clone of `Dhara-msafe/Dhara`.
3. Force-push all branches and tags. Every collaborator re-clones, since rebasing old clones would re-introduce the value.
4. Ask GitHub Support to purge cached views and PR diffs, and check forks.
5. Add secret scanning (GitHub push protection) to block a repeat.

### Other secrets scan findings (classified, not changed)
- `frontend/google-services.json`: Firebase Android API key. It is public by design, but it should be **restricted** to the package name and SHA-1 in Google Cloud Console (owner action).
- `src/analytics/index.ts`: PostHog `phc_` project key. Public by design.

---

## TASK A: QA safety switch (implemented)

### Design
- **Backend:** `OUTBOUND_MODE`. Only the exact value `live` sends. Anything else is simulate.
- **App:** `EXPO_PUBLIC_OUTBOUND_MODE`, with the same rule.
- The server **refuses to start** unless `OUTBOUND_MODE` is exactly `live` or `simulate`. This is the deployment validation.
- Preview now has `simulate` in both env files.
- **Production action for the founder:** set `OUTBOUND_MODE=live` and `EXPO_PUBLIC_OUTBOUND_MODE=live` before the production build or publish. If they are missing, the backend will not start; it does not fall back to sending.

### Backend files
| File | Change |
|---|---|
| `services/outbound_guard.py` (new) | `outbound_mode`, `outbound_live`, `validate_outbound_config`, `record_simulated` (writes to `qa_outbox` in the current DB) |
| `server.py` | Validation at boot; push-jobs loop started **only** when live; `/api/health` shows `outbound_mode`; `GET /api/qa/outbox` (admin key, returns 404 when live) |
| `push.py` | `send_push`, `register_device`, `unregister_device` are simulated. Trusted Circle invites, safety alerts, missed check-in (F1 worker) and self-test all go through `send_push`. |
| `mailer.py::send_email` | Password-reset, account-deletion OTP and ops emails go to the QA inbox (`qa_outbox`). No Resend call. |
| `services/alerts.py` | Ops Slack and email simulated |
| `push_jobs.py::_run_daily_nudge` | Returns early unless live, as a second guard |

### App files
- `src/outbound.ts` (new) is the **only** place allowed to call `Linking.openURL`, `SMS.sendSMSAsync` or `Share.share`:
  - `openExternal(url)`: tel, sms, smsto, mms, mailto, WhatsApp and intent links are simulated; normal https links still open.
  - `composeSms(...)`
  - `shareExternal(...)`
- 31 screens and components were switched to these functions (mechanical swap; the full list is in `git status`).
- `src/women/helpActions.ts`: Silent Alert and `openPhone` return "Simulated — nothing sent…".
- Head Out keeps its own `ALERT_SIMULATION_MODE` preview, and its SMS path is now also guarded.
- Guardian share SMS is guarded.

### Tests
- `tests/test_outbound_guard.py`: 34 tests.
  - The HTTP clients are replaced with a stub that fails on any call.
  - 9 non-live values × push / email / ops / daily nudge → **0 real calls**.
  - Startup is refused for missing or invalid values.
  - Live mode still calls the provider, so production behaviour is unchanged.
- `src/__tests__/outboundGuard.test.mjs`: 4 tests, including a static scan that fails if any direct dialler, SMS or share call appears outside `outbound.ts`.
- **Web check:** on `/emergency`, tapping "112 Tap to call" showed "Simulated — nothing sent … tel:112". The URL did not change and no dialler opened.

### Remaining risks
- `EXPO_PUBLIC_*` values are fixed at build time. A build made with `simulate` never dials, including 112, so the CT-1 build value must be decided deliberately by the founder.
- A user can still dial 112 manually outside the app; that is by design.
- `Share.share` is now simulated in QA, so the draft and scan "Share" buttons show the notice.

### Independent QA acceptance
On a device build with `simulate`, every row of the external-action table must show the notice. No SMS app, dialler or share sheet may open, and `/api/qa/outbox` must list each simulated email or push.

---

## TASK B: Immediate-danger fix (implemented)

### `api/chat_router.py`
- `_emergency = _is_immediate_danger(body.message)` is now the **first statement** of `chat_stream`. The later recomputation was removed.
- The guest C1 counter adds `and not _emergency`.
- The SOS fast-path becomes `FEATURE_C1… and not _emergency and is_bare_distress(...)`.
- The event_gen gates were already guarded.

### Recognition
`_is_immediate_danger = (DANGER and THREAT) or _ACUTE_DANGER_RE`. The new acute pattern covers:
- an armed person ("he/someone has/pulled out a knife/gun/weapon/acid")
- "I am being followed/stalked/chased" (but not "followed up")
- "someone is following/chasing me"
- "maar dega/degi/denge/dalega", "jaan se maar", "mujhe bachao", "मुझे बचाओ", "मार डालेगा", "mala vachva", "मला वाचवा"

### Decision order
1. Danger check
2. Guest quota (danger messages are never free C1 turns)
3. Paywall
4. SOS fast-path, only if not danger and bare distress
5. Retrieval and LLM prompt; when danger, the emergency prompt is added and DV acts are filtered
6. C1 fallbacks, guarded by `not _emergency`
7. Refusal or LLM
8. 112 banner prepended when danger

### Gujarati
In the SOS template, `કલાਕ` was changed to `કલાક` (U+0A15 → U+0A95).

### Tests
`tests/test_danger_order_and_recognition.py`: 70 tests.
- The 4 Round-3 gap messages and 6 other danger messages are detected.
- 11 ordinary messages are not, including "my RTI application is being followed up", "punishment for carrying a knife" and "my husband has a job abroad".
- All 43 earlier bare phrases keep the SOS shortcut.
- Greetings keep their replies.
- Static ordering checks and a Gujarati single-script check.

`test_h1_legal_gates_contract` ordering and the Gujarati script test now pass.

### Remaining risks
- Pattern-based detection can never be complete.
- A **guest who has hit the question limit** still gets "create an account" before the danger check; this is pre-existing. A separate fix is proposed: let danger messages bypass the guest limit.

**QA:** a tester sends each phrase in en, hi, mr and gu and confirms the 112 banner or the SOS reply.

---

## TASK C: Backend test reconciliation (isolated)

- Command: `cd backend && bash tests/qa/run_isolated.sh`
- What it does:
  - DB `dhara_qa_g1`, port 8002, `OUTBOUND_MODE=simulate`.
  - Seeds synthetic users and resets the guest and synthetic-user daily caps in the QA DB only. The seed script refuses any DB name not starting with `dhara_qa_`.
  - Checks the registry and mapping md5 before and after.
- **All 80 test files are now included.** `lang_check.py` is a script, not a test.

| Group | Resolution |
|---|---|
| 21 voice/transcribe (missing `/tmp` m4a) | Test now generates WAV fixtures itself |
| Guest 429 ×3, daily cap 429 ×14 | Environment only; reset by the QA seed |
| testuser@gandhikar.in | Added to the synthetic seed |
| 4 Layer-M fixtures | Fixture given `approved_at` and artefact fields (required since 9e0a9b2); reason code renamed to `revoked_approval`; distinct `approval_id` in 214. Gate logic unchanged. |
| Stream test (1) | Updated to the citation-after-answer contract (18e7881): buffered `final` frame, then citations. It still asserts citations exist. |
| 14 + 7 Guardian public-page tests | Rewritten to assert the **PR-1B1 privacy contract** via `tests/_guardian_contract.py`: identical page for any token, no status, location, map or refresh, no token echo, `no-referrer`. Journey state is asserted through the owner API responses instead. **Nothing was restored to the public page.** |
| Per-type permission fixture | Asserts non-location payload visible and destination still stripped |
| 15 shared-DB files | Read `DB_NAME`, `CORPUS_DB_NAME`, `EXPO_BACKEND_URL`, `MONGO_URL` and `ADMIN_KEY` from env first; hard-coded `gandhikar_db`, `localhost:8001` and the key removed |
| p0_hotfix / shield2 event loop | `asyncio.get_event_loop()` replaced with `asyncio.run()` (Python 3.11) |
| p1_grounding corpus | `legal_sections` is read from the corpus DB |
| evidence_vault_b5 auth | Logs in a synthetic user (E1 hardening requires auth) |

### Still failing (not hidden; see the final numbers in the summary)
- **Expected fail-closed (legal withheld):**
  - `test_layer_m_golden` 301/303/308
  - `test_bugs_review_jan2026` ×2
  - `test_p1_grounding_fix::test_response_never_declares_section_invalid`
  - These prove the unapproved BNS 199 content is withheld.
- **Real defect, not fixed (legal-engine ranking change needs review):**
  - The RTI "ignored" query returns RTI §6/§3, although `corpus.py:942` (RTI 18) and RTI 19 exist with matching "ignored" text.
  - Affects `iteration_13` ×1 and `iteration_15` ×2.
- **Config:** `test_evidence_vault_b5` returns 503 "Evidence vault cloud features are not enabled on this server". The feature flag is off in this environment, so the tests need the flag on in QA.
- **Config/test:** `test_pro_samples_and_paywall` pricing assertions expect ₹50, but the env `PRO_PRICE_LABEL` is ₹99. Owner decision on the correct price.
- **Investigate:**
  - `test_refusal_analytics` ×3: refusal query no longer refuses.
  - `test_qa_brief_jan2026` IT Act 66A: answer did not flag it as struck down. This is a legal-content risk.

---

## TASK D: Voice upload (final proposal; not implemented)

### Provider limits
OpenAI `whisper-1` (`engine/stt_engine.py:135`):
- **25 MB** maximum.
- Formats: flac, m4a, mp3, mp4, mpeg, mpga, oga, ogg, wav, webm.

### Product
- There is no recording time limit in the app today.
- Native records `RecordingPresets.HIGH_QUALITY` m4a/AAC, about 1 MB per minute. Web records webm/opus, about 0.25–0.5 MB per minute.
- Voice questions are typically under 1 minute. The FIR narration and intake can run longer.
- **10 MB is validated:** about 10 minutes of native audio, 2.5× under the provider limit, and it leaves margin for multipart overhead.

### Implementation
In `chat_router.py::whisper_transcribe`, which covers both upload points:
1. Read the stream with a cap of `MAX = 10 * 1024 * 1024`, reading `MAX + 1` bytes.
   - Over the cap: **413** "Recording is too long (max 10 MB). Please record a shorter message."
2. Under 1 KB: **400** "Recording was empty or too short."
3. Check the declared type against the allow-list and the file's leading bytes:

| Format | Signature |
|---|---|
| m4a/mp4 | `ftyp` at offset 4 |
| webm | `1A45DFA3` |
| ogg | `OggS` |
| mp3 | `ID3` or `FF Ex/Fx` sync |
| wav | `RIFF....WAVE` |
| flac | `fLaC` |

   - Mismatch: **415** "This audio format isn't supported."
4. **Billing only after validation:** move `meter_llm_use(...)` in both `/voice/transcribe` and `/advocate/intake/{token}/transcribe` to after the checks.

### App
In `src/voice/stt.ts` and `app/(tabs)/index.tsx`:
- Check the size before upload and show the same messages.
- Auto-stop recording at 9 minutes.

### Tests
- 0 B, 999 B, exactly 10 MB, 10 MB + 1.
- PNG and EXE bodies labelled `audio/m4a`.
- Valid headers for each format.
- Meter counter unchanged after a rejection.
- Intake endpoint with an expired token returns 400 and no meter change.

### If the public advocate intake is out of CT-1 scope
Add a server flag `INTAKE_VOICE_ENABLED` (default false) checked at the top of `intake_transcribe`, returning **503** "Voice input is not available for this form." This blocks old builds and direct calls; hiding the button alone would not.

---

## TASK E: TypeScript fixes (diffs prepared; NOT applied)

**E1. `frontend/app/_layout.tsx:225`**
- `addNotificationTapListener` returns an `EventSubscription`.
- Calling `remove?.()` on it throws "remove is not a function" when the screen closes.

```diff
-    let remove: (() => void) | undefined;
+    let sub: { remove: () => void } | undefined;
     import("@/src/push").then(({ addNotificationTapListener }) => {
-      remove = addNotificationTapListener((actionUrl) => {
+      sub = addNotificationTapListener((actionUrl) => {
         if (actionUrl) router.push(actionUrl as any);
       });
     }).catch(() => {});
-    return () => remove?.();
+    return () => sub?.remove();
```

**E2. `frontend/app/guardian/[token].tsx:230`**
- The press event was passed as `silent`, so "Try again" refreshed without its loading state.

```diff
-              <Pressable style={styles.outlineBtn} onPress={fetchJourney} accessibilityRole="button">
+              <Pressable style={styles.outlineBtn} onPress={() => fetchJourney()} accessibilityRole="button">
```

**E3. `frontend/app/women-shield.tsx:283`, Campus security → "Ask DHARA"**
- **Exact target:** route group `(tabs)`, index screen (`app/(tabs)/index.tsx`, Ask DHARA).
- That screen reads only `draft`, `entry`, `voiceHint`, `autostartMic` and `topicId` (`index.tsx:342`, applied at `517–521`).
- The current `q` param is **ignored**, so the question would not be prefilled even if the route resolves. `"/(tabs)/index"` is also not a typed route.
- The fix follows the established pattern in `app/all-help.tsx:106` and `app/(tabs)/home.tsx:163`.

```diff
-onPress={() => router.push({ pathname: '/(tabs)/index', params: { q: 'How do I contact campus security or file a complaint?' } })}
+onPress={() => router.push({ pathname: '/(tabs)', params: { draft: 'How do I contact campus security or file a complaint?', entry: Date.now().toString() } } as any)}
```

**Acceptance:** those 3 tsc errors are gone (45 → 42). On web, the Campus security row opens Ask DHARA with the question prefilled.

---

## Guardian security
- **Served page:** header `Referrer-Policy: no-referrer` **and** `<meta name="referrer" content="no-referrer">` (`journey_router.py:613`).
- The `strict-origin` meta exists only in the retired helper `_status_html` (`journey_router.py:707`), which PR-1B1 no longer serves. **No served discrepancy exists.**
- **Recommendation:** keep `no-referrer`. It is the strictest option, and the page loads no third-party resources that would need an origin.
- Optionally delete or align the dead helper in a reviewed change.
- Access model unchanged. Guardian stays out of CT-1.

## Source control (T-01)
- **Local:** `6769dec` → `2756512` → `ce60af8` (HEAD), linear on `main`. There is no remote, so the latest GitHub SHA is unknown.
- **Missing step:** an owner of the `Dhara-msafe` organisation installs the **Emergent GitHub App** with repository access to `Dhara-msafe/Dhara` (Contents: read; write is only needed for "Save to GitHub"), then connects GitHub inside Emergent.
- Then read-only reconciliation: `git ls-remote`, comparing the GitHub HEAD with `ce60af8`, and `git diff --stat`.

---

## Final isolated run (all 80 test files) — `bash tests/qa/run_isolated.sh`

**1546 passed · 19 failed · 5 skipped (442.7 s).** Legal registry and mapping were unchanged. The QA backend was stopped afterwards.

Round 3 had 1251 passed and 53 failed + 1 error, on 65 files only.

| # | Remaining failures | Class |
|---|---|---|
| 3 | `test_bugs_review_jan2026` ×2, `test_p1_grounding_fix::test_response_never_declares_section_invalid` | **EXPECTED FAIL-CLOSED.** The real BNS 199 correction is withheld (registry `pending_human_review`). These keep proving the content is withheld. |
| 3 | RTI "ignored" → expects §18/19, gets §6/§3 (`iteration_13` ×1, `iteration_15` ×2) | **REAL DEFECT**: retrieval ranking. Not changed, because a legal-engine change needs a separate approval. |
| 6 | `test_evidence_vault_b5` (503 "cloud features are not enabled") | **CONFIG**: the evidence-vault cloud flag is off on this server. The test's own flag fixture doesn't enable it in QA. |
| 3 | `test_pro_samples_and_paywall` (expects ₹50, env `PRO_PRICE_LABEL`=₹99) | **CONFIG / OWNER DECISION**: which price is correct |
| 3 | `test_refusal_analytics` | 2 are stale tests (expect streamed `delta`; the guard now buffers into `final`). 1 is a refusal-analytics count that didn't increase → **INVESTIGATE** |
| 1 | `test_qa_brief_jan2026` IT Act 66A not flagged as struck down | **LEGAL-CONTENT RISK, INVESTIGATE**. A dead-law warning is missing for §66A (Shreya Singhal 2015). |

Layer-M 301/303/308 now pass. They use **synthetic in-memory approval records** passed to the gate; the production registry is untouched and still pending.

Frontend:
- 8 node test files pass, including the new `outboundGuard` test (4/4).
- Voice 108/108.
- safetyTriggerCoordinator 5/5.
- tsc still shows 45 errors; no new ones were introduced.
