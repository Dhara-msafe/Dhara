# DHARA UI Revision v2.2.1 — Stage 6 Release Summary

Status: **PREVIEW ONLY. NOT DEPLOYED. NO REAL OUTBOUND ENABLED.**
Flag: `EXPO_PUBLIC_UI_REVISION_V1=true` (default on; set `false` to revert instantly, no data impact).
Outbound: `OUTBOUND_MODE=simulate`, `OUTBOUND_PROFILE=internal_qa`, `DEPLOYMENT_ENV=preview` — all unchanged by this work, confirmed present in `backend/.env`.

---

## 1. What this release is

A presentation-only accessibility/copy pass over the DHARA app: 48px touch targets, text contrast ≥4.5:1, visible keyboard-focus rings, correct `accessibilityRole`/`accessibilityLabel`/`accessibilityState`, and removal of color-only state indicators — across every screen grouped under Stages 1–4 below. Every visual change is gated behind `UI_REVISION_V1` so it can be switched off instantly with no effect on data, routing, API contracts, or consent/legal-engine behaviour.

## 2. Full scope delivered, by stage/group

| Stage/Group | Screens / files | Status |
|---|---|---|
| Stage 1 | Environment prep — `EXPO_PUBLIC_RELEASE_TARGET` guard, `QaModeBanner.tsx` | Done (prior session) |
| Stage 2 | Emergency screen — 112 button wired to `openPhone()`, copy updated | Done (prior session) |
| Group A | `missing/index.tsx`, `missing/interview.tsx`, `women/officer-card.tsx`, `src/designRevision.ts` (flag created) | Done (prior session) |
| Group B | `rights.tsx`, `women/safety-plan.tsx`, `ipc-bns-lookup.tsx`, `visitor/index.tsx` | Done (prior session) |
| Group C | `missing/result.tsx` | Done (prior session) |
| Group D | `(tabs)/index.tsx` + `src/chat/chatStyles.ts` — combined chat UI, screens 7–13 | Done (this session) |
| Group E | `drafts/[type].tsx` — Letter saved / Your letter | Done (this session) |
| Group F | `login.tsx`, `(tabs)/me.tsx`, `edit-profile.tsx`, `engine.tsx` | Done (this session) |
| Group G | `women/trusted-circle.tsx`, `family-journey/active.tsx` + shared `src/familyJourney/ui.tsx`, `women/evidence-locker.tsx` | Done (this session) |
| Group G follow-up (NF-UI-REV-13) | `women/head-out/{index,circle,destination,radius}.tsx` — focus rings added | Done (next session) |
| Group H | `women-shield.tsx`, `women/silent-alert.tsx`, `women/code-phrase.tsx`, `women/panic-lesson.tsx`, `women/guardian-share.tsx` | Done (this session) |
| Group I | `family-journey/{index,contacts,new,preview}.tsx`, `alerts/{index,[id]}.tsx`, `drafts/{index,history}.tsx`, `fir-draft/index.tsx` (shared step components), `fir-draft/result.tsx` | Done (this session) |
| Group I follow-up (NF-UI-REV-11) | `fir-draft/index.tsx` (start/chat-header/bubble controls) + `src/components/FirSectionDrawer.tsx` — focus rings + missing a11y labels + 48px gating | Done (next session) |
| Group J | `consent.tsx` + `src/consentStyles.ts`, `settings/data-privacy.tsx`, `my-data.tsx` | Done (this session) |

~30 files touched across Groups D–J, +6 more in the follow-up polish pass. Every change: `tsc --noEmit` and ESLint clean (same 6 pre-existing, unrelated repo errors only — none introduced). The follow-up pass was verified live by `testing_agent`: login/consent, Home, full FIR-draft flow (module select → AI chat → save & pause → resume), full Head Out wizard (destination → radius → circle → start → active journey, every action button), flag-OFF regression (reverted cleanly, no lasting change), and the `OUTBOUND_MODE=simulate` guardrail — zero bugs found.

## 3. Notable structural fix

`drafts/history.tsx` had a nested `Pressable` — a delete button living inside the card's toggle `Pressable`, relying on a `stopPropagation?.()` call that is not reliable on native. Restructured into sibling `Pressable`s with identical visuals and logic. This was the only nested-interactive-element violation found across the whole audit.

## 4. Outstanding items, ranked by risk

| Risk | Item | Why | Recommended next step |
|---|---|---|---|
| 🟡 Medium | **Visual confirmation at the 5 mandatory widths (320/360/390/412/768px), flag ON and OFF** — representative sweep done, not exhaustive | `screenshot_tool` kept returning a blank image in this pod; `testing_agent`'s own browser automation completed the 5-width sweep for Home + FIR-draft-start (flag ON, clean) and a flag-OFF spot check on fir-draft-start + head-out-destination (clean, reverted with no lasting change). A full 5-width × ON/OFF sweep of every single Groups D–J screen is still not done. | Low priority given the structural `UI_REVISION_V1 ? X : Y` gating is verified-safe by construction; run the remaining screens only if a stricter visual sign-off is required. |
| 🔴 High | Physical-device, TalkBack (screen reader), OS large-text checks — all `NOT RUN` | Explicitly out of scope for this pod per your instruction; needs a real Android device | Run when a physical device is available |
| 🟢 Low | `fir-draft/index.tsx` stage-specific inline controls beyond the shared components (chips, input bar, GPS/evidence widgets, confirm buttons, emergency overlay) were not individually audited | File is 2500+ lines; the shared components (fixed) plus the follow-up pass (header/bubble/start controls) cover most of the user-facing surface, but some one-off stage buttons may still lack labels | Spot-check during a future pass if this screen is prioritized |
| 🟢 Low | Backend log inspection for outbound "real message" evidence (CSV rows T09, T30, T31) | No real test transactions were run; `OUTBOUND_MODE=simulate` structurally prevents any real send regardless of test outcome | Only needed if you want a backend log artifact, not a behavioural risk |
| 🟢 Low | 6 pre-existing `tsc` errors (`ConsentStep.tsx`, `InputStep.tsx`, a test file) | Predate this entire UI revision effort, unrelated to any file touched in Groups A–J or the follow-up pass | Unrelated cleanup, can be scheduled separately |
| ⚪️ Carried over (not a regression) | Production `DEPLOYMENT_ENV` reportedly `preview` | Flagged in a prior session as a K8s/production environment-variable issue outside this pod's access | Needs your action in the production environment config, not a code fix |

## 5. `REGRESSION_ACCEPTANCE.csv` status

32 of 38 rows remain `NOT RUN` — they require a physical Android device, TalkBack, or live backend/network-log inspection with real test traffic, all explicitly excluded by your instructions (preview only, `OUTBOUND_MODE=simulate`, no device). 6 rows are now confirmed, in-pod-verifiable, via code/diff review plus this session's live `testing_agent` run:
- **T38** (safety: test profile only) — `OUTBOUND_PROFILE=internal_qa` confirmed, not live/production; reconfirmed live via QA-mode banner + backend log this session.
- **T22/T19/T20** (storage keys, scan/fraud routing unchanged) — confirmed by diff review: zero routing or storage-key changes in any file touched across Groups D–J or the follow-up pass.
- **T21** (Auth: guest access and existing sign-in unchanged) — confirmed live this session (Web only): existing voicetest2026@example.com sign-in works end-to-end, no OTP/PIN added. Physical-Android leg still `NOT RUN`.
- **T23** (Rollback: presentation flag off) — confirmed live this session (Web only): every `UI_REVISION_V1 ? X : Y` gate has `Y` equal to the exact pre-existing value by construction; additionally spot-checked live by temporarily setting the flag to `false`, restarting expo, and screenshotting fir-draft-start + head-out-destination (both rendered cleanly, no new console errors), then reverting. Physical-Android/TalkBack leg still `NOT RUN`.

T28 (Pro: no price shown until configured) is intentionally left `NOT RUN` — `PRO_PRICE_LABEL=₹99` is a real configured value, not a placeholder, which raises a product/legal question (see `OPEN_ITEMS.md` #33) rather than a pass/fail UI check.

## 6. Safety/compliance confirmations

- **No deploy, publish, or build was triggered.** Preview only, throughout.
- **No real call, SMS, or share was enabled or sent.** `OUTBOUND_MODE=simulate` end-to-end, unchanged.
- **No changes to API routes, database schema, consent logic, or legal-engine behaviour** in any group — every diff this session is JSX presentation attributes (`accessibilityRole`/`Label`/`State`, `style` additions/gating, `hitSlop`) plus one structural (non-behavioural) nested-button fix.
- Test credentials used remain as recorded in `/app/memory/test_credentials.md` — none created or changed this session.

## 7. Recommendation

Treat this as **code-complete, representatively visually-verified**. The remaining open item is a full 5-width × ON/OFF sweep of every Groups D–J screen (🟡 Medium, §4) — not a blocker given the structural flag-gating is verified-safe by construction and a representative live sweep (Home, fir-draft-start, head-out-destination, both flag states) passed clean. Everything else is either explicitly deferred by your own scope (physical device/screen reader) or low-risk cleanup that does not affect behaviour, data, or compliance.
