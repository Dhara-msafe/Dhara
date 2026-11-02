# CT-1 — External-Action Intercepts, Guardian Link Review, TS Errors, T-17 Risk Assessment

Read-only analysis · 2 Nov 2026 · HEAD `6769dec` (platform auto-commit containing only the iteration-70 docs + map test)

## 1. External actions and how (or whether) they are intercepted in QA
| Action | Where | Who triggers | QA intercept today | Gap |
|---|---|---|---|---|
| Head Out missed check-in SMS | `app/women/head-out.tsx:278` | User tap | **Yes:** `EXPO_PUBLIC_ALERT_SIMULATION_MODE` (default ON unless exactly `"false"`) | Build-time only |
| Silent Alert SMS (incl. code-phrase path) | `src/women/helpActions.ts::composeAlert` → `expo-sms` / `sms:` | User tap | **None in code.** It opens the SMS app; the user must press Send | A real message is sent if the tester presses Send |
| Guardian Journey link SMS | `app/women/guardian-share.tsx:150` | User tap | **None.** Opens the SMS app | Real link reaches real numbers if sent |
| Dialler (112, 181, 1091, helplines, contacts) | ~20 `tel:` sites (emergency, women-shield, action-plan, SOSButton, PrivacyCover, visitor, missing, fir-draft) | User tap | **None.** Opens the dialler; the user must press Call | Accidental real 112 call |
| Push: trusted-circle alert to guardian | `api/alerts_router.py:211` | Server, automatic on alert | Preview: `EMERGENT_PUSH_KEY=placeholder`, so `send_push` raises and the error is caught (no delivery) | **Becomes real in the deployed build** |
| Push: trusted-circle invitation | `api/trusted_circle_router.py:115` | Server, automatic | Same placeholder key | Real after deploy |
| Push: daily nudge to all non-Pro users | `push_jobs.py::_run_daily_nudge` (background loop started in `server.py:1874`) | Server, **scheduled, no user action** | Placeholder key only | **Real broadcast after deploy**, including to tester accounts |
| Push self-test | `api/chat_router.py:295` | User, to self only, 60 s cooldown | Placeholder key | Low risk |
| Email: password-reset / OTP codes | `api/auth_router.py:329, 452` → `mailer.py` (Emergent-managed Resend) | User request | **None.** Real email in preview too | Goes only to the address typed; throttled (60 s, 3/h) |
| Email/Slack ops alerts | `services/alerts.py` | Server | Targets blank → no-op | — |
| eCourts, geocode, LLM, STT/TTS, object storage | various | User request | None (cost only, no third-party person contacted) | Spend |

**Conclusion:** only Head Out has a code-level QA intercept. Silent Alert, Guardian share and dialler rely on the user pressing Send/Call. Server push is suppressed only because the preview push key is a placeholder; it becomes live on deploy.
**Required before CT-1 (decision, no code yet):** either (a) one backend + frontend QA switch that routes every action above to a "Simulated — nothing sent" screen and disables `push_jobs`, or (b) procedure-only containment: trusted contacts restricted to consenting test numbers, testers told never to press Send/Call, and push left unconfigured in the CT-1 deployment. (a) is the safer option.

## 2. Guardian shared-link security review (T-12)
Evidence: `api/journey_router.py`, `memory/guardian_link_revocation_design.md`, `memory/token_url_exposure_report.md`.
| Control | Finding | Risk |
|---|---|---|
| Token | 10 chars from [A-Za-z0-9] via `secrets.choice` ≈ 59.5 bits | Brute force infeasible |
| Scope | **One token per journey, the same link for every recipient**; public page `GET /api/journey/status/{token}` is anonymous | **HIGH:** anyone the SMS is forwarded to can see it; can't revoke one recipient |
| Expiry | 24 h TTL → 410 | OK |
| Revocation | Owner `POST …/revoke` removes `last_location` atomically; page shows closed | OK (all-or-nothing) |
| Mutations (safe/revoke/missed-checkin/heartbeat/help/location) | `Depends(current_user)` + owner check → 403 "Not your journey" | OK |
| In-app guardian JSON `GET /api/journey/{token}/guardian` | Authenticated + accepted-recipient + permission checks (403s) | OK |
| Location exposure | `EXPO_PUBLIC_GO1B_GPS=false`, so no live location is collected in CT-1 | Reduces impact |
| Headers on public page | `Referrer-Policy: no-referrer`, `Cache-Control: no-store` | OK |
| Logs | Token appears in nginx access log (accepted operator risk) | MEDIUM |
| Rate limit on anonymous page | None found | LOW given token entropy |
| Tests | 14 guardian/journey HTML tests fail in Gate 1 (expected content missing) | **Unverified behaviour** |

**Recommendation:** exclude Guardian Share from the CT-1 test scope (`EXPO_PUBLIC_GUARDIAN_SHARE=false` at build) until (1) the 14 failing tests are explained or fixed and (2) the founder accepts the shared-link model in writing or links become per-recipient.

## 3. T-15 TypeScript errors (`npx tsc --noEmit`, 45 errors, NOT fixed)
- `app/(tabs)/me.tsx` 26,27 (×4): `photo_url` not on `User`; 172: `errorSoft` not in theme colours
- `app/(tabs)/settings.tsx` 521: implicit `any` `item`
- `app/_layout.tsx` 225: `EventSubscription` not assignable to `() => void`
- `app/alerts/[id].tsx` 62: `temp_location` on `{}`; 79: object not assignable to `SetStateAction<SafetyAlert|null>`
- `app/consent.tsx` 94: `lang` prop not on SafeAreaView
- `app/edit-profile.tsx` 24,25,27,27,79: `photo_url` not on `User`
- `app/guardian/[token].tsx` 230: `(silent?) => Promise<void>` passed as `onPress`
- `app/login.tsx` 254: `errorContainer` not in theme colours
- `app/upgrade.tsx` 172: `source` not on status type
- `app/women-shield.tsx` 232: `label` missing on scenario item; 283: route `"/(tabs)/index"` not a typed route
- `src/analytics/index.ts` 218, 239: `Record<string,unknown>` vs `PostHogEventProperties`
- `src/components/LanguageOnboardModal.tsx` 310, 392: `fonts.heading` missing
- `src/trustedCircle/api.ts` 22,28,35,42,58,65,71,77,83,87,92,98,112,118,123,126,132 (×17): TS2769 no overload matches (fetch/axios call signature)
- `src/userProfile.ts` 315: `ProfileInterest[]` not `StorageItemValue`
- `src/women/__tests__/safetyTriggerCoordinator.test.ts` 51, 119: `.ts` import extension (test-only)
- `src/women/evidenceManifest.ts` 34: `Uint8Array<ArrayBufferLike>` vs `BufferSource`
Runtime-relevant first look: `women-shield.tsx:283` (route may not resolve), `guardian/[token].tsx:230` (receives event as `silent`), `_layout.tsx:225` (cleanup call shape), `alerts/[id].tsx`.

## 4. T-17 security risk assessment (before any implementation)
| Item | Current state (evidence) | Threat | Likelihood × impact | Recommended for CT-1? |
|---|---|---|---|---|
| Upload limit on `/api/voice/transcribe` | `chat_router.py:1756–1784`: `await audio.read()` with no size or type check; auth required | Authenticated user sends huge or non-audio file → memory pressure, Whisper spend | Medium × Medium | **Yes:** a small, isolated change (size cap + MIME allow-list → 413/415) |
| Auth token storage | `src/auth.tsx:95` stores JWT in **AsyncStorage** (unencrypted); SecureStore is already used for code phrase / evidence keys | Token readable on rooted/backed-up device → account takeover incl. safety data | Low × High | **Yes, but MEDIUM:** migration path for existing sessions; native-device test required |
| JWT lifetime | `config/settings.py:39` `JWT_EXP_DAYS = 30`; no `aud`/`iss`; no server-side revocation list seen | Stolen token valid 30 days | Low × High | Partial: shorten lifetime (e.g. 7 d) only together with refresh handling; `aud`/`iss` P2 |
| Generic API error strings | Some endpoints return internal detail | Information disclosure | Low × Low | No (P2) |
| Rate limiting | Present on OTP/reset (auth_router) and push self-test; none on chat/transcribe/public guardian page | Abuse / cost | Medium × Medium | Transcribe covered by size cap; broader rate limiting P2 |
Each change touches auth or uploads → requires the auth/upload playbook, an isolated QA run (Gate 1 env) and a device check. No implementation started.
