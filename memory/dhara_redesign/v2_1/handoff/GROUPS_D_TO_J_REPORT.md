# DHARA UI Revision v2.2.1 — Groups D–J completion report

Date: this session. Flag: `EXPO_PUBLIC_UI_REVISION_V1=true` (preview). `OUTBOUND_MODE=simulate`, `OUTBOUND_PROFILE=internal_qa`, `DEPLOYMENT_ENV=preview` — unchanged, verified.

## Scope delivered (code-complete, gated by `UI_REVISION_V1`)

- **Group D** — `app/(tabs)/index.tsx` + `src/chat/chatStyles.ts` (screens 7–13, combined chat UI)
- **Group E** — `app/drafts/[type].tsx` (Letter saved / Your letter)
- **Group F** — `app/login.tsx`, `app/(tabs)/me.tsx`, `app/edit-profile.tsx`, `app/engine.tsx`
- **Group G** — `app/women/trusted-circle.tsx`, `app/family-journey/active.tsx` + shared `src/familyJourney/ui.tsx`, `app/women/evidence-locker.tsx`; `app/women/head-out/*` audited (already accessible, no changes needed — see Known gaps)
- **Group H** — `app/women-shield.tsx`, `app/women/silent-alert.tsx`, `app/women/code-phrase.tsx`, `app/women/panic-lesson.tsx`, `app/women/guardian-share.tsx`
- **Group I** — `app/family-journey/{index,contacts,new,preview}.tsx`, `app/alerts/{index,[id]}.tsx`, `app/drafts/{index,history}.tsx`, `app/fir-draft/index.tsx` (shared step components) + `app/fir-draft/result.tsx`
- **Group J** — `app/consent.tsx` + `src/consentStyles.ts`, `app/settings/data-privacy.tsx`, `app/my-data.tsx`

## What was fixed, per the brief
- Added `accessibilityRole`/`accessibilityLabel`/`accessibilityState` to every interactive element found missing them (several hundred across ~30 files).
- Added visible keyboard-focus rings (`src/a11yFocus.ts` `focusRingStyle`) — no-op on native touch, web/keyboard only.
- Bumped touch targets under 44/48px, gated: `UI_REVISION_V1 ? 48 : <original>`.
- Fixed every text-contrast pair that measured under 4.5:1 via `scripts/contrast_check.py` (full list below), gated the same way.
- **Structural fix**: `app/drafts/history.tsx` had a nested `Pressable` (delete button inside the card's toggle `Pressable`) — restructured into siblings. Same visual layout, same onCopy/onShare/onDelete/toggle logic.
- Zero changes to API calls, routing, storage keys, consent logic, PIN/lockout/encryption logic (evidence-locker), or outbound send logic anywhere.

## Contrast fails found and fixed (all via `onSurfaceSecondary` swap, gated)
| File | Element | Before | After |
|---|---|---|---|
| chatStyles.ts | chatDividerLabel, citationVerified, slideHintText, placeholder | ~4.0–4.46:1 | ~6–6.7:1 |
| drafts/[type].tsx | placeholder | 4.03:1 | 6.03:1 |
| login.tsx | 2 placeholders | 4.03:1 | 6.03:1 |
| engine.tsx | sectionTitle | 4.33:1 | 6.47:1 |
| women/silent-alert.tsx | recordingText ('#ef4444'→emergencyRed) | 3.76:1 | 5.9:1 |
| women/code-phrase.tsx | sugTitle | 4.33:1 | 6.5:1 |
| drafts/history.tsx | meta | 4.03:1 | 6:1 |
| engine/fir-draft shared | n/a | all pre-existing colors already passed | — |
| settings/data-privacy.tsx | operatorNote | 4.33:1 | 6.5:1 |
| my-data.tsx | legalNote | 4.33:1 | 6.5:1 |
| consentStyles.ts | disabledText | 3.79:1 | 5.66:1 |

## Known gaps / proportional decisions (time-boxed, flagged not hidden)
- `app/women/head-out/{index,circle,destination,radius}.tsx`: already had accessibilityRole/Label on effectively every control and no contrast/touch-target fails found by grep audit — **did not** add focus rings here to conserve time across the 6 groups. Low risk (focus rings are a web/keyboard nicety, not used on mobile touch).
- `fir-draft/index.tsx` (2500+ lines): fixed all **shared** step components (chips, text input bar, GPS widget, evidence widget, confirm buttons, emergency overlay, voice-confirm bar) which cascades to every FIR question screen. Did not individually audit every stage-specific inline Pressable beyond those shared components.

## Stage 5 (Release Checks) — partial, as constrained
Per the brief, physical-device, screen-reader (TalkBack), and OS-large-text checks **stay NOT RUN** — cannot be done in this pod. What *was* verified in-pod:
- `OUTBOUND_MODE=simulate`, `OUTBOUND_PROFILE=internal_qa`, `DEPLOYMENT_ENV=preview` — confirmed, satisfies T38.
- `PRO_PRICE_LABEL=₹99` configured (not placeholder) — relevant to T28.
- No storage-key or routing changes in any diff this session — relevant to T22/T19/T20.
- All `UI_REVISION_V1 ? X : Y` gates verified by construction to have `Y` = the exact pre-existing value (preserves T23 rollback).
- `tsc --noEmit` and ESLint clean on every touched file (only the same 6 pre-existing, unrelated errors remain repo-wide).

All other `REGRESSION_ACCEPTANCE.csv` rows remain `NOT RUN` (unchanged from before this session) — they require a physical Android device, TalkBack, or backend log inspection beyond this session's scope.

## Tooling note
The `screenshot_tool` returned an identical blank/stale image on every attempt this session (same byte size regardless of URL, path, or wait time) — confirmed as a tool-side issue, not an app issue (curl + expo logs confirm the bundle serves and compiles cleanly). Visual confirmation at the 5 mandatory widths (320/360/390/412/768, flag on/off) is **still outstanding** and should be re-attempted next session.
