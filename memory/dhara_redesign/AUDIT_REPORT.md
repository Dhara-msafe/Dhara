# DHARA — Read-Only Code Audit

No files were edited, deployed or merged to produce this report. Every claim below cites the
file (and line, where useful) it was taken from. Anything not directly observed in the code is
marked **not found** / **not confirmed** rather than inferred.

- **Framework**: Expo (SDK config: `expo-router ~55.0.18`, `react-native 0.83.10`) — confirmed in `frontend/package.json`.
- **Commit inspected**: `4fe44a8ad8a537e245a35ba921c9cbda39bd612e` (`git rev-parse HEAD` in `/app`, at time of this audit).
- **Environment inspected**: PREVIEW only. I do not have access to the deployed production environment (K8s backend / EAS mobile) and could not inspect its actual `.env` values — noted again in Section 4.

---

## 1. Consent

### 1a. Every consent control (source: `frontend/src/consentStrings.ts` lines 22–53, English; `frontend/app/consent.tsx`)

| Control | Exact label text (English) | Required/Optional | Default | Storage key / API field |
|---|---|---|---|---|
| Age | "I am 18 years or older" / "I am under 18" | Required (must pick one to continue) | Neither selected (`age18` state starts `null` — `app/consent.tsx`) | `age_confirmed_18` (bool) in `ConsentLogIn` body |
| Terms | "I agree to the Terms of Use" | Required | Unchecked (`termsTicked` starts `false`, `consent.tsx` line 41) | not a separate field server-side — gates whether `/api/consent/log` is called at all |
| Data processing | "I agree to Dhara using my information as described above to answer my questions and prepare my complaint draft" | Required | Unchecked (`dataTicked` starts `false`, line 42) | `purposes.core` (bool) — but see note below: **always sent as `true` regardless of this checkbox's own value; the checkbox only gates whether Continue is enabled, it does not change what is transmitted** |
| Optional — analytics | "Help improve Dhara by sharing anonymous usage information" | Optional | Unchecked (`analytics` state starts `false`, line 43) | `purposes.analytics` (bool) |
| Optional — updates | "Send me legal awareness tips and updates by SMS or WhatsApp" | Optional | Unchecked (`updates` state starts `false`, line 44) | `purposes.updates` (bool) |

No compliance badges, pricing, or sample ratings appear on this screen (confirmed by reading the full file).

### 1b. Where the record is saved

**Both device and server.**

- **Device** (`frontend/src/consentStorage.ts`): `AsyncStorage` key `consent_version_<userId|'guest'>` stores only the notice version string (`CONSENT_NOTICE_VERSION = "2026-10-01"`, `src/consentStrings.ts` line 5). No other consent detail is stored on-device.
- **Server** (`backend/server.py`, `POST /api/consent/log`, lines 2265–2311): inserts one document into `consent_log` (append-only, never updated/deleted per code comment) with fields:
  `user_id, anon_id, notice_version, purposes {core, analytics, updates}, language, age_confirmed_18, timestamp (UTC ISO), app_version`.
  If the caller is signed in, it additionally writes `terms_version, terms_accepted, terms_accepted_at, consent_purposes, age_confirmed_18, consent_language` onto the `users` document (same function, lines 2298–2310).
- Anonymous (guest) consent is rate-limited: max 50 inserts per IP per day (`CONSENT_ANON_IP_DAILY_LIMIT`, line 2262).
- `POST /api/consent/link` (line 2318) later attaches a guest's `anon_id` consent rows to their account once they sign in, without overwriting anything.

### 1c. Withdrawal, export, delete-account — what each actually does

- **Withdrawal** — `settings/data-privacy.tsx` "Withdraw consent" button (`handleWithdrawConsent`, line 88) routes to `/consent?mode=update`. In that mode, `consent.tsx` (lines 53–104) calls `PATCH /api/user/privacy-choices` instead of the full consent log. That endpoint (`backend/server.py` lines 2336–2360) **only lets the user change `analytics` and `updates`** — `core` is hard-coded `true` in the request/response (`new_purposes = {"core": True, ...}`, line 2342). There is **no path in the code that sets `core` to `false`** or revokes the age/terms acceptance. Every change still writes a new `consent_log` row (`event: "privacy_choices_update"`).
  - **What actually stops when `analytics` is turned off**: `frontend/src/analytics/index.ts` — `trackEvent()` returns immediately without sending anything unless `_analyticsConsent === true` (checked at line 255, and line 97 on load). Confirmed this gate exists.
  - **What stops when `updates` is turned off**: **not found**. No backend code references `consent_purposes.updates` or `purposes.updates` to gate any SMS/WhatsApp send. The flag is stored but not currently enforced anywhere else in the codebase.
- **Export** — `my-data.tsx` fetches `GET /api/user/my-data` (`backend/server.py` lines 2133–2150+), which returns counts of `messages`, `fir_sessions`, `saved_answers`, the user's latest `consent_log` entry, and `grievance_tickets`. The screen then offers to write this to a file via `expo-file-system` (`File, Paths` imported, `my-data.tsx` line 3) — this is a summary/count export, **not a full raw-data JSON dump** of every stored document (only what `get_my_data_summary` returns).
- **Delete account** — two real entry points:
  1. In-app: `(tabs)/settings.tsx` "Delete my account" (password re-entry) → `POST /api/account/delete` → `backend/account_deletion.py` `hard_delete_user()`.
  2. Logged-out: `app/delete-account.tsx` (email + OTP flow, for users who uninstalled before deleting).
  Both paths converge on the same `hard_delete_user()` function. That function deletes/anonymizes the user's own collections (confirmed in `account_deletion.py`), but **`consent_log` is explicitly exempt and is never deleted** — comment in `server.py` (near line 2490) states "consent_log: EXEMPT — never purged (legal proof)". A 30-day grace window exists before some linked collections (e.g. sessions older than `cutoff_30d`) are purged (`account_deletion.py`).

### 1d. Consent versions / re-consent

- `CONSENT_NOTICE_VERSION = "2026-10-01"` is a single hardcoded string (`src/consentStrings.ts` line 5). There is no list of historical versions in the code.
- Re-consent is enforced globally: `ConsentGuard` in `app/_layout.tsx` (lines 76–99) compares the stored version to `user?.terms_version` on every navigation and redirects to `/consent?mode=update` (for signed-in users) or `/consent` (guests) if they don't match — except for routes `language, consent, emergency, guardian, pay-upi, admin-upi-review, admin-issues`, which are exempt from this redirect.
- A dedicated "Consent settings" screen with five purposes, consent receipts, or consent history (screens 47, 54–57 in the package) — **not found**. Only `app/consent.tsx` exists, reused for both first consent and updates via the `mode` query param.

---

## 2. Routes and components (53-screen reference set + the 4 "new" screens)

Legend for **Guards**: "token-gated fetch" = screen loads for anyone but a data fetch inside silently no-ops without a token (no redirect); "redirects" = the screen itself pushes to another route if unauthenticated; "global consent guard" = subject to the `ConsentGuard` described in 1d; "not confirmed" = I did not trace this file's guard logic in this pass.

| # | Screen (package name) | Real route | Component file | Params | Guards | Note |
|---|---|---|---|---|---|---|
| 1 | Splash | `/` | `app/index.tsx` | none | n/a (redirect screen) | Redirects: signed-in → `/(tabs)/home`; else → `/login` if a language was saved before, else `/language`. |
| 2 | Choose language | `/language` | `app/language.tsx` | none | exempt from consent guard | No search field found (`grep` for `search`/`TextInput` in this file returned nothing) — the design's "search field" is **not found** in the real screen. |
| 3 | How it helps | — | — | — | — | **Not found** as its own screen. |
| 4 | Privacy & consent | `/consent` | `app/consent.tsx` | `mode` (optional, `'update'`) | global consent guard exempt (is the guard's target) | See Section 1. |
| 5 | Choose state | `/state` | `app/state.tsx` | not confirmed | global consent guard | Rows/buttons measured ≥44–56px in this file (see audit notes from the prior fix round). |
| 6 | Home | `/(tabs)/home` | `app/(tabs)/home.tsx` | none | global consent guard | |
| 7 | Listening | — | `app/(tabs)/index.tsx` (inline state) | — | — | Not a separate screen; one state inside the main chat screen. |
| 8 | Type instead | — | `app/(tabs)/home.tsx` button → `app/(tabs)/index.tsx` | — | — | A button (`testID="home-type-button"`, `accessibilityLabel="Type your question instead"`) that navigates into the same chat screen as 7/10/12/13; not its own screen. |
| 9 | Scan document | `/scan` | `app/scan.tsx` | not confirmed | not confirmed | Internal `ScanStep` state machine: `'entry' \| 'review' \| 'processing' \| 'ocr-review' \| 'result'` — all one file, no route change between steps. On reaching `'result'`, the only `router.push` found goes to `/(tabs)` (line 790); **no reference to `/heard` anywhere in this file** — confirms the package's own caution was warranted but the risk does not exist in the real code. |
| 10 | DHARA understood (Heard) | — | `app/(tabs)/index.tsx` (inline state) | — | — | Same file as 7/8/12/13. |
| 11 | Action plan | `/action-plan` | `app/action-plan.tsx` | not confirmed | not confirmed | |
| 12 | Your rights (Answer) | — | `app/(tabs)/index.tsx` (inline state) | — | — | Same file as 7/8/10/13. |
| 13 | Sources | — | `app/(tabs)/index.tsx` (inline state) | — | — | Same file as 7/8/10/12. |
| 14 | Sign in | `/login` | `app/login.tsx` | not confirmed | public | Guest access confirmed present: `continueAsGuest()` call wired to a visible "Guest Mode" card (`testID="guest-mode-card"`). |
| 15 | Set PIN | — | — | — | — | **Not found** as an app-wide screen. The only PIN in the codebase is a local PIN lock scoped to the Evidence Locker feature (`app/women/evidence-locker.tsx`), not a general account PIN. |
| 16 | Letter saved (Draft) | `/drafts/[type]` | `app/drafts/[type].tsx` | `type`, `prefill` (optional) | token required for generation (not confirmed as a redirect) | Inline `generated` state inside this one file renders the result; see note on 17. |
| 17 | Your letter (Letter) | `/drafts/[type]` | `app/drafts/[type].tsx` | same as 16 | same as 16 | **Same file as 16** — the pre-generation form and the post-generation letter view are two states of one component, not two screens. |
| 18 | My files | `/(tabs)/myfiles` | `app/(tabs)/myfiles.tsx` | none | not confirmed | |
| 19 | Me | `/(tabs)/me` | `app/(tabs)/me.tsx` | none | not confirmed | **Not merged with 44/Settings in the real app** — `me.tsx` and `settings.tsx` are two separate tab routes. The package's "merged Me hub" is a proposal, not the current implementation. |
| 20 | All help | `/all-help` | `app/all-help.tsx` | not confirmed | not confirmed | |
| 21 | Head out | `/women/head-out` | `app/women/head-out/index.tsx` | not confirmed | flag `EXPO_PUBLIC_GO1B_GPS` referenced in this file; master feature flag `EXPO_PUBLIC_SAFETY_SESSION_V1` (currently `true` in this preview's `.env`) | |
| 22 | Trusted people (Circle) | `/women/trusted-circle` | `app/women/trusted-circle.tsx` | not confirmed | flag `EXPO_PUBLIC_TRUSTED_CIRCLE_V2` / `EXPO_PUBLIC_TRUSTED_CIRCLE_RECIPIENT` (both `true` in this preview) | Call button wired to `openPhone()` (real dialler call, see Section 4). |
| 23 | On the way (Journey) | `/family-journey/active` | `app/family-journey/active.tsx` | not confirmed | `useFamilyJourneyEnabled()`, flag `EXPO_PUBLIC_FAMILY_JOURNEY_SEND_V1` (`true` in this preview) | File header comment: "Phase 1: Preview... schedules no notification of any kind, on any device." Idle/active are states of this one screen, as the package itself assumed. |
| 24 | Are you OK? (CheckIn) | — | `app/women/head-out/index.tsx` (`handleCheckInNow`, inline) | — | — | **Not found** as its own screen; it is a state/handler inside Head Out. |
| 25 | Emergency | `/emergency` | `app/emergency.tsx` | none | exempt from consent guard | See Section 4 — the main "112" element has no `onPress` handler at all. |
| 26 | Record proof | `/women/evidence-locker` | `app/women/evidence-locker.tsx` | not confirmed | flag `EXPO_PUBLIC_EVIDENCE_ACTIONS` | See Section 3 — "Pause", "Make the screen dark, keep recording" and the exact phrase "Saved to this phone" are **not found** as literal text in this file. |
| 27 | Card for officer | `/women/officer-card` | `app/women/officer-card.tsx` | not confirmed | not confirmed | Call button wired to real `openPhone()`. |
| 28 | Rights library | `/(tabs)/rights` | `app/(tabs)/rights.tsx` | none | not confirmed | No separate search field confirmed; not checked in this pass beyond the accordion noted in #29. |
| 29 | One right (RightDetail) | — | `app/(tabs)/rights.tsx` (`expanded` state) | — | — | Not a separate screen — an inline accordion expand/collapse in the rights-library screen. |
| 30 | Dhara Engine | `/engine` | `app/engine.tsx` | not confirmed | not confirmed | |
| 31 | File a complaint | `/fir-draft` | `app/fir-draft/index.tsx` | not confirmed | not confirmed | |
| 32 | Ready notices | `/drafts` | `app/drafts/index.tsx` | none | not confirmed | The literal on-screen title in this file is **"Ready notices"** (line 24) — so, contrary to a first read of the file names, the **drafts list screen is "Ready notices" (#32)**, and `drafts/[type].tsx` covers #16/#17. There's also `/drafts/history`, which is not in the 53-screen set. |
| 33 | Women's Shield | `/women-shield` | `app/women-shield.tsx` | not confirmed | flag `EXPO_PUBLIC_PRIVACY_COVER_V1` referenced in this file | |
| 34 | Silent alert | `/women/silent-alert` | `app/women/silent-alert.tsx` | not confirmed | flag `EXPO_PUBLIC_SILENT_ALERT_EVIDENCE_V1` | Uses `composeAlert()`, built on the same outbound guard as calls/SMS (Section 4). |
| 35 | Safety phrases | `/women/code-phrase` | `app/women/code-phrase.tsx` | not confirmed | flag `EXPO_PUBLIC_PRIVACY_COVER_V1` | |
| 36 | Panic lesson | `/women/panic-lesson` | `app/women/panic-lesson.tsx` | not confirmed | not confirmed | |
| 37 | Safety plan | `/women/safety-plan` | `app/women/safety-plan.tsx` | not confirmed | not confirmed | |
| 38 | Guardian share | `/women/guardian-share` | `app/women/guardian-share.tsx` | not confirmed | flag `EXPO_PUBLIC_GUARDIAN_SHARE` (`true` in this preview) | SMS composed via `openExternal('sms:...')` — real outbound guard applies. |
| 39 | Family journey | `/family-journey` | `app/family-journey/index.tsx` | not confirmed | `useFamilyJourneyEnabled()` | |
| 40 | Family contacts | `/family-journey/contacts` | `app/family-journey/contacts.tsx` | not confirmed | not confirmed | |
| 41 | Missing person | `/missing` | `app/missing/index.tsx` | not confirmed | not confirmed | |
| 42 | Person details | `/missing/interview` | `app/missing/interview.tsx` | not confirmed | `if (!userId) { setInitializing(false); return; }` (no redirect — screen just stays uninitialized) | |
| 43 | Alerts | `/alerts` | `app/alerts/index.tsx` | not confirmed | token-gated fetch (`if (!token) return;`, line 57) — no redirect found | |
| 44 | My account | `/(tabs)/me` | `app/(tabs)/me.tsx` | — | — | Same file as #19 — see note there. |
| 45 | Edit profile | `/edit-profile` | `app/edit-profile.tsx` | not confirmed | token-gated fetch (`if (!token) return;`, line 30) | |
| 46 | Data privacy | `/settings/data-privacy` | `app/settings/data-privacy.tsx` | not confirmed | global consent guard | The compliance-badge copy fix (prior turn of this session) was applied here. |
| 47 | Consent settings | — | — | — | — | **Not found** as a dedicated screen. The withdrawal path (`/consent?mode=update`) reuses `app/consent.tsx`; there is no 5-purpose consent-management screen. |
| 48 | DHARA Pro | `/upgrade` | `app/upgrade.tsx` | not confirmed | flag `EXPO_PUBLIC_PRO_UPGRADE_ENABLED` — **currently `false`** in this preview's `.env`, so the screen renders its disabled/"not available" view | Price source: see Section 3. |
| 49 | Find advocate | `/advocate-register` | `app/advocate-register.tsx` | not confirmed | token/user required for some actions; **no dedicated feature-flag constant found in this file** | The package's "behind existing permission/feature flag" claim — **not confirmed**; I found only an auth check, not a feature flag. |
| 50 | Advocate profile | `/lawyer-home` | `app/lawyer-home.tsx` | not confirmed | token-gated fetch (`if (!user?.id \|\| !token) return;`, line 19) — no feature-flag constant found | Same caveat as #49. |
| 51 | Case notes | `/notetaker` (+ `/notetaker/matter/[id]`, `/notetaker/consultation/[id]`, `/notetaker/consultation/new`, `/notetaker/tasks`) | `app/notetaker/index.tsx` and siblings | varies (`[id]` params on sub-routes) | token-gated fetch (`if (!token) return;`, line 37) — no feature-flag constant found in `index.tsx` | Same caveat as #49/#50 — the package assumes a flag; I could not confirm one exists for this feature. |
| 52 | IPC lookup | `/ipc-bns-lookup` | `app/ipc-bns-lookup.tsx` | not confirmed | not confirmed | |
| 53 | Visitor help | `/visitor` | `app/visitor/index.tsx` | not confirmed | not confirmed | |
| 54 | Consent record | — | — | — | — | **Not found.** No file, route or backend endpoint matching a post-consent receipt screen exists. |
| 55 | Consent history | — | — | — | — | **Not found.** No consent-history screen or guest/account toggle exists. |
| 56 | Withdraw consent (with consequences) | — | — | — | — | **Not found** as its own confirmation screen. The only withdrawal UI is the `mode=update` flow in `app/consent.tsx` (Section 1c), with no "consequences" step. |
| 57 | Download consent record | — | — | — | — | **Not found.** No PDF/JSON consent-record download exists; `my-data.tsx` exports a data-summary file (Section 1c), not a consent record specifically. |

**Also found, not in the 53-screen set**: `app/drafts/history.tsx` (draft history list) — exists in the repo, has no counterpart in the package.

**Nav tabs** (`app/(tabs)/_layout.tsx`, lines 51–64) — exactly 4 visible tabs: **Home, Rights, My files, Me**. 9 additional tab-group routes exist but are hidden from the tab bar (`options={hidden}`): `index` (the main chat/Ask screen), `complaints`, `discover`, `lookup`, `voter-roll`, `saved`, `advocate`, `settings`, `history` — reachable only by programmatic navigation, not from the tab bar itself.

**On the global auth guard**: no single app-wide "must be signed in" redirect was found in `app/_layout.tsx` — only the `ConsentGuard` described in Section 1d is global. Screens that need a signed-in user check `token`/`user` from `useAuth()` individually inside the component (examples above marked "token-gated fetch"); some simply skip a fetch with no token and render an empty/loading state rather than redirecting, which I have reported per-file above rather than assuming a consistent pattern.

---

## 3. Existing features the design assumed

| Feature | Confirmed? | File(s) | Note |
|---|---|---|---|
| Language search | **No** | `frontend/app/language.tsx` | No `search`/`TextInput` match in this file. |
| Pause button on the Record screen | **Not found** | `frontend/app/women/evidence-locker.tsx` | No literal "Pause" text/control found by search of this file. |
| "Make the screen dark, keep recording" control | **Not found** | `frontend/app/women/evidence-locker.tsx` | No match for this phrase or an equivalent dim-screen-while-recording control in this file. |
| "Saved to this phone" recording storage | **Behavior yes, exact wording not found** | `frontend/app/women/evidence-locker.tsx` | The file uses `AsyncStorage` for metadata/notes and `markPendingTemp`/`clearPendingTemp` helpers for local temp-file bookkeeping; no `API_BASE`/upload call was found in this file, consistent with local-only storage. But the literal phrase "Saved to this phone" is **not found** anywhere in the file. |
| PIN | **Partially — feature-scoped only** | `frontend/app/women/evidence-locker.tsx` | PIN exists only as a local Evidence Locker lock, not an account-wide PIN screen (see Section 2, row 15). |
| Pro pricing configuration source | **Yes** | `backend/server.py` lines 110–113 | `PRO_PRICE_INR` (env var, default `9900` paise = ₹99), `PRO_PRICE_LABEL` (default `"₹99"`), `PRO_PRICE_USD` (default `500` cents), `PRO_PRICE_USD_LABEL` (default `"$5"`) — all read from backend environment variables with hardcoded fallbacks if unset. Served via `GET /api/billing/pricing`, consumed in `frontend/app/upgrade.tsx` line 174. |
| Navigation tab count and labels | **Yes** | `app/(tabs)/_layout.tsx` | 4 visible tabs: **Home, Rights, My files, Me** (see Section 2 for the full hidden-route list). |

---

## 4. Environment behaviour — Emergency screen (call / SMS / share)

**Important limitation up front: I only have access to the PREVIEW environment's files. I cannot inspect the actual deployed production `.env` values — the statements below about "production" describe what the code is designed to do under an `OUTBOUND_PROFILE=production` setting, not a confirmed observation of the live production deployment.**

- **Master switch** (`frontend/src/outbound.ts`, `frontend/.env` line 66): `EXPO_PUBLIC_OUTBOUND_MODE=live` in this preview's `.env` right now. If this were anything other than `"live"`, every dispatch would be simulated (`OUTBOUND_LIVE` constant).
- **Profile** (`frontend/.env` line 68): `EXPO_PUBLIC_OUTBOUND_PROFILE=production` in this preview right now. The code defines three profiles (`internal_qa`, `closed_testing`, `production`) with a policy table (`outbound.ts` lines 32–36):
  - `internal_qa`: dialler, SMS, and share all **simulate**.
  - `closed_testing` and `production`: dialler, SMS, and share are all **live**, i.e. real `Linking.openURL('tel:...')`, `expo-sms` composer, or OS share sheet is invoked, subject to the safety rails below.
- **On the Emergency screen specifically** (`frontend/app/emergency.tsx`, full file read): the "112" element is a plain `<View>` with `testID="call-112"` and `accessibilityLabel="112 — Emergency. Calling not yet active."` — **it has no `onPress` handler at all.** Tapping it does nothing, regardless of `OUTBOUND_MODE`/`OUTBOUND_PROFILE`, because no call is wired to it in this file. This matches the accessibility label's own text.
- **Elsewhere in the app, real call/SMS/share wiring does exist** and would be live under the current preview settings:
  - `app/women/nearest-help.tsx` — "Immediate danger? Call 112" button calls `openPhone('112')`.
  - `app/women/officer-card.tsx`, `app/women/trusted-circle.tsx` — call buttons call `openPhone(number)`.
  - `app/women/guardian-share.tsx`, `app/women/head-out/index.tsx` — SMS composed via `openExternal('sms:...')`.
  - `app/women/silent-alert.tsx` — uses `composeAlert()` (same underlying guard).
- **Safety rails that apply regardless of mode** (`outbound.ts`):
  - SMS to any of a fixed list of emergency short codes (`112, 100, 101, 102, 108, 1091, 1098, 181, 1930, 139, 1073`) is always blocked — "Blocked for your safety… Use the dialler to call instead." Calls to these numbers via the dialler are not blocked by this rail.
  - In `closed_testing`, SMS is further restricted to a verified test-contact allowlist (`EXPO_PUBLIC_SMS_TEST_CONTACTS`).
  - None of the dispatch functions (`openPhone`/`composeSms`/`shareExternal`) auto-send: they open the native dialler/SMS composer/share sheet, which still requires the user's own tap to actually place the call or send the message. This matches the app's "no automatic alert" messaging.
- **A static guard test exists** (`src/__tests__/outboundGuard.test.mjs`, referenced in `outbound.ts`'s own header comment) intended to fail the build if any file other than `outbound.ts` calls `Linking.openURL`, `SMS.sendSMSAsync` or `Share.share` directly — I did not run this test as part of this read-only audit (the user's own prior instruction in this job forbids running `pytest`; I did not attempt the JS test runner either since this was a read-only request).

---

## Items I could not verify (full list)

- Exact `params`/`guards` for: `state.tsx`, `action-plan.tsx`, `(tabs)/myfiles.tsx`, `all-help.tsx`, `women/head-out/index.tsx` (beyond the flags listed), `women/trusted-circle.tsx` (beyond the flags listed), `(tabs)/rights.tsx`, `engine.tsx`, `fir-draft/index.tsx`, `women-shield.tsx`, `women/code-phrase.tsx`, `women/panic-lesson.tsx`, `women/safety-plan.tsx`, `women/guardian-share.tsx` (beyond the flag), `family-journey/index.tsx`, `family-journey/contacts.tsx`, `missing/index.tsx`, `ipc-bns-lookup.tsx`, `visitor/index.tsx`, `drafts/[type].tsx` and `drafts/index.tsx` (beyond "token required for generation").
- Whether a single consistent app-wide authentication guard exists beyond the per-screen checks listed — I found none, but did not read every remaining file in the repo to rule one out absolutely.
- The actual deployed production environment's `.env` values (`EXPO_PUBLIC_OUTBOUND_MODE`, `EXPO_PUBLIC_OUTBOUND_PROFILE`, and all other feature flags) — no access to production from this session.
- Whether `openPhone()` (used by `nearest-help.tsx`, `officer-card.tsx`, `trusted-circle.tsx`) applies the same emergency-number SMS block as `composeSms()` — I read `outbound.ts`'s SMS and `openExternal` paths but did not separately trace `openPhone()`'s own implementation file in this pass.
- Whether the static outbound-guard test (`src/__tests__/outboundGuard.test.mjs`) currently passes — not run, per this being a read-only request.
