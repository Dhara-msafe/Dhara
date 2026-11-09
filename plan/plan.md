# DHARA — GitHub Synchronization, Environment Audit & Release Readiness Check

DHARA is a women's safety app (SOS alerts, a live "Head Out" journey tracker, Trusted Circle guardians, Nearest Help, an AI legal assistant). This task does not change what the app does — it reconciles the existing Emergent workspace with the GitHub source of truth, audits the environment/feature-flag configuration, and produces an honest report of what works, what doesn't, and what's still unverified.

## Who it's for
- The DHARA team, who need one trustworthy codebase (not two diverging copies between GitHub and Emergent) before continuing product validation.
- Indirectly, the app's existing users (travellers and their trusted guardians), whose safety-critical flows must keep working exactly as they do today — nothing about their experience should change as a result of this task.

## Core features and experience (being checked, not redesigned)
- Head Out journey wizard: destination → radius → Trusted Circle → active journey → arrival / route deviation / missed check-in screens.
- Trusted Circle: recipients, permissions, notification settings, consent.
- Nearest Help, including its existing OSM fallback behaviour.
- Saved Places and any other workflow touched by the files being synchronized.
- Google Maps / Places / Directions integration — only inspected and flag-gated, never turned on as part of this task.

## User flow (of the task itself)
1. **Inspect** the current Emergent workspace (commit, uncommitted changes, env files, config) and compare it to GitHub `main` at `ccf18bf2` — already confirmed as the current head of `main`, so no version ambiguity.
2. **Synchronize**: update files that should match GitHub, add files that are missing, and flag any local file whose change would destroy existing work instead of silently overwriting it.
3. **Verify**: walk through Head Out, Trusted Circle, Nearest Help, API contracts, and Saved Places against the synchronized code; fix small, clear-cut breakage found along the way (a broken import, an obviously missing file reference); leave anything structural (a real contract mismatch, an incomplete feature) unfixed and written up for a separate decision.
4. **Audit environment variables and feature flags** against what the synchronized code actually implements — not against assumptions — and apply only Preview changes; Production stays untouched.
5. **Run available build/lint/test checks** and label each result honestly by what kind of evidence it actually is (a syntax check is not an integration test; a browser preview is not a real Android device).
6. **Deliver the five reports** (sync summary, environment variables, feature verification, defects/blockers, final status) before anything touching Production or app stores is even discussed.

## UI/UX feel
Unchanged. No visual, layout, or interaction redesign is in scope anywhere in this task.

## Implementation phases

**Phase 1 — MVP (build now)**
Baseline inspection → GitHub-to-Emergent synchronization (existing DB, secrets, and Emergent config files preserved; missing files added; conflicting files flagged rather than overwritten) → post-sync verification of Head Out, Trusted Circle, Nearest Help, API contracts, and Saved Places, fixing small clear-cut breakage inline → environment/feature-flag audit applied to Preview only → available build/lint/test checks run and honestly labeled → all five reports delivered, ending with a request for approval before touching anything Production-related.

**Phase 2 (not now)**
Act on whatever Phase 1's reports flag as needing a real decision: larger defects or incomplete implementations that were only reported (not fixed), and any approved Production environment changes.

**Phase 3 (not now)**
Anything gated on native builds or outside credentials: real Android/iOS device verification, turning on Google Places/Directions once their implementation and credentials are fully confirmed, and native background-GPS testing.

## Assumptions
- The GitHub repo is public and already at the intended commit, so no access token is needed for this sync; the credential you pasted is a Google Maps/Places/Directions key, which will be collected later through the secure Secrets panel — never from the chat message — exactly when the Phase 1 environment audit needs it.
- Work already built this session directly inside Emergent (journey map components, the 3-step Head Out wizard, the draggable Issue Reporter button, the admin issues dashboard, the earlier map-loading crash fix, the session-reload fix) is preserved as local-only additions if GitHub `main` doesn't yet have them — treated as "not yet synchronized," not deleted.
- All three named flags (`EXPO_PUBLIC_GPS_BACKGROUND`, `FEATURE_GOOGLE_PLACES_V1`, `FEATURE_GOOGLE_DIRECTIONS_V1`) stay off in both Preview and Production unless the audit proves the feature behind them is fully implemented and credentialed.
- The other flags referred to only by nickname (GPS, Trusted Circle recipient, Live Route) will be matched to their real variable names by searching the synchronized codebase during Phase 1, rather than guessed in advance.
- "Fix small clear-cut issues now" covers things like a broken import path or an obviously missing file reference surfaced during verification; anything structural (a real API contract mismatch, a half-built feature) is written up in the defects report for a separate decision, not fixed in this pass.
- No Production configuration, app-store submission, or native build happens in this task.
