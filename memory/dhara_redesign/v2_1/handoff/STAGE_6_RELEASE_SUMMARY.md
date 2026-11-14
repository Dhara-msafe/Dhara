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
| Group G | `women/trusted-circle.tsx`, `family-journey/active.tsx` + shared `src/familyJourney/ui.tsx`, `women/evidence-locker.tsx` | Done (this session) — `women/head-out/*` audited, already compliant, no changes needed |
| Group H | `women-shield.tsx`, `women/silent-alert.tsx`, `women/code-phrase.tsx`, `women/panic-lesson.tsx`, `women/guardian-share.tsx` | Done (this session) |
| Group I | `family-journey/{index,contacts,new,preview}.tsx`, `alerts/{index,[id]}.tsx`, `drafts/{index,history}.tsx`, `fir-draft/index.tsx` (shared step components), `fir-draft/result.tsx` | Done (this session) |
| Group J | `consent.tsx` + `src/consentStyles.ts`, `settings/data-privacy.tsx`, `my-data.tsx` | Done (this session) |

~30 files touched across the full app in this session alone (Groups D–J). Every change: `tsc --noEmit` and ESLint clean (same 6 pre-existing, unrelated repo errors only — none introduced).

## 3. Notable structural fix

`drafts/history.tsx` had a nested `Pressable` — a delete button living inside the card's toggle `Pressable`, relying on a `stopPropagation?.()` call that is not reliable on native. Restructured into sibling `Pressable`s with identical visuals and logic. This was the only nested-interactive-element violation found across the whole audit.

## 4. Outstanding items, ranked by risk

| Risk | Item | Why | Recommended next step |
|---|---|---|---|
| 🔴 High | **Visual confirmation at the 5 mandatory widths (320/360/390/412/768px), flag ON and OFF** — not completed this session | `screenshot_tool` returned an identical blank image on every attempt (different URLs/paths/waits all failed the same way) — confirmed tool-side, not app-side, via curl + expo logs showing a clean bundle | Retry screenshots next session before treating any Group D–J screen as visually sign-off-ready |
| 🔴 High | Physical-device, TalkBack (screen reader), OS large-text checks — all `NOT RUN` | Explicitly out of scope for this pod per your instruction; needs a real Android device | Run when a physical device is available |
| 🟡 Medium | `fir-draft/index.tsx` stage-specific inline controls beyond the shared components (chips, input bar, GPS/evidence widgets, confirm buttons, emergency overlay) were not individually audited | File is 2500+ lines; the shared components (fixed) cover most of the user-facing surface, but some stage-specific one-off buttons may still lack labels | Spot-check during a future pass if this screen is prioritized |
| 🟡 Medium | `women/head-out/{index,circle,destination,radius}.tsx` — missing visible keyboard-focus rings | Already had accessibility roles/labels and no contrast/touch-target fails; focus rings are a web/keyboard-only affordance with no effect on mobile touch | Low priority; add if a desktop/keyboard audit is required |
| 🟢 Low | Backend log inspection for outbound "real message" evidence (CSV rows T09, T30, T31) | No real test transactions were run this session; `OUTBOUND_MODE=simulate` structurally prevents any real send regardless of test outcome | Only needed if you want a backend log artifact, not a behavioural risk |
| 🟢 Low | 6 pre-existing `tsc` errors (`ConsentStep.tsx`, `InputStep.tsx`, a test file) | Predate this entire UI revision effort, unrelated to any file touched in Groups A–J | Unrelated cleanup, can be scheduled separately |
| ⚪️ Carried over (not a regression) | Production `DEPLOYMENT_ENV` reportedly `preview` | Flagged in a prior session as a K8s/production environment-variable issue outside this pod's access | Needs your action in the production environment config, not a code fix |

## 5. `REGRESSION_ACCEPTANCE.csv` status

All 38 rows: still `NOT RUN`. None were executable in this pod — they require a physical Android device, TalkBack, or live backend/network-log inspection with real test traffic, all explicitly excluded by your instructions (preview only, `OUTBOUND_MODE=simulate`, no device). The in-pod-verifiable *preconditions* for several rows were confirmed:
- **T38** (safety: test profile only) — `OUTBOUND_PROFILE=internal_qa` confirmed, not live/production.
- **T28** (Pro price not a placeholder) — `PRO_PRICE_LABEL=₹99` is a real configured value, not "Price to be confirmed".
- **T22/T19/T20** (storage keys, scan/fraud routing unchanged) — confirmed by diff review: zero routing or storage-key changes in any file touched this session.
- **T23** (rollback) — every `UI_REVISION_V1 ? X : Y` gate added this session has `Y` equal to the exact pre-existing value, by construction. Group A's rollback was additionally screenshot-verified in a prior session (flag off restored the original look with no data impact).

## 6. Safety/compliance confirmations

- **No deploy, publish, or build was triggered.** Preview only, throughout.
- **No real call, SMS, or share was enabled or sent.** `OUTBOUND_MODE=simulate` end-to-end, unchanged.
- **No changes to API routes, database schema, consent logic, or legal-engine behaviour** in any group — every diff this session is JSX presentation attributes (`accessibilityRole`/`Label`/`State`, `style` additions/gating, `hitSlop`) plus one structural (non-behavioural) nested-button fix.
- Test credentials used remain as recorded in `/app/memory/test_credentials.md` — none created or changed this session.

## 7. Recommendation

Treat this as **code-complete, visually-unverified**. The single blocking item before calling the v2.2.1 revision release-ready is the screenshot sweep in §4 (🔴 High) — everything else is either explicitly deferred by your own scope (physical device/screen reader) or low-risk cleanup that does not affect behaviour, data, or compliance.
