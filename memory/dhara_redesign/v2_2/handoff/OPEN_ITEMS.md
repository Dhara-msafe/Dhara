# Open items and decisions

## Needs source code or engineering
1. Routes now come from the code audit of the preview (commit 4fe44a8). Production was not inspected. Many screen params and guards are "not confirmed".
2. Component bindings, feature flags, guards, route parameters, deep links, draft restoration.
3. Scan completion routing and OCR workflow (do not redirect to /heard without confirming).
4. Existing language configuration (live selector showed 23 options) and whether search exists.
5. Existing authentication methods, guest access, PIN feature (if any).
6. Emergency capabilities per environment (preview showed "Calling not yet active"), SMS preparation vs sending, delivery confirmation.
7. Which data categories are stored on device and which in the cloud; encryption facts.
8. Framework and version (Expo/React Native assumed).

## Needs product or legal decisions
9. Consent ledger: approval, backend design, storage, retention, guest identifier, guest-to-account merge, audit access, version source, re-consent triggers. Screens 54-57 are designs only.
10. Legal review of all DPDP Act 2023 and PIPEDA statements. No compliance badge is to be used until approved.
11. The list of consent purposes and what stops when each is withdrawn, and the timing.
12. What happens when a required consent is withdrawn (essential access).
13. Pro pricing, trial and cancellation terms. Display must come from approved application configuration.
14. Navigation: three, four or five tabs.
15. Which screens ship at launch: 15 (PIN), 48 (Pro), 49-51 (advocate and notes) are deferred.
16. Intended priority journeys (the list was not provided; see README).

## Design work not done
17. Original logo file not available here; it is not in assets/. Add the approved file.
18. Remaining contrast, touch-target and large-text issues listed in A11Y_CHECK_REPORT.md.
19. RTL and long-translation layouts.
20. State designs not yet drawn for every screen: microphone denial, incorrect transcription, GPS unavailable, generation failure, expired sharing, recording-save failure, permission-denied, interrupted. Do not add pause, voice-speed or automatic retry controls unless they exist.
21. Native design-tool files (.fig) and a repository patch were not produced.
22. Record screen (26): the Pause button, "Make the screen dark, keep recording" and "Saved to this phone / Nobody else gets it unless you choose to share it" text are carried over from the reference and are UNVERIFIED. Confirm they exist and are true, or remove them. This audit did not clear every screen of such inherited claims; run a full copy review against the app.
23. Sample document content on screen 9 (Scan: a vacate date and amounts) and similar sample answers, deadlines and recordings on screens 10-12, 17, 18 and 27 are placeholders, not facts. Replace with neutral placeholders or real data before any production use. The sample-claims scan was by keyword only.
24. All functional tests in REGRESSION_ACCEPTANCE.csv are NOT RUN.

## Added in v2.1 (from the code audit): status as of v2.2
(see the v2.2 decisions section below)

## v2.2 decisions recorded 2026-11-13 (product owner)
Approved as DESIGN only. Backend implementation is pending engineering work and legal review. Nothing below is built or verified.
- Withdrawal of required consent ("Using my information"): approved design (screen 56, 47). Explains affected features, keeps privacy, support and deletion available.
- Under-18 behaviour: approved design (screen 58). Adults only, no collection, emergency information placeholders. No parental-consent flow.
- Updates enforcement: required (dispatch-time check, queue and provider propagation, unsubscribe, essential vs optional separation). Engineering work, not built.
- 112 control: label "Open dialler for 112" with a visible fallback. Engineering must wire it; test on physical devices without placing real calls.
- Preview isolation: required (see task below).

## Still undecided
- Consent-record retention: fields, legal basis, period per jurisdiction, de-identification or deletion process, access, user notice. Counsel to decide. No period is shown in any design.
- Pro price: stays "Price to be confirmed". The backend defaults (INR 99, USD 5) are NOT approved and must not be displayed. Replace silent defaults with explicitly approved configuration per country: currency, billing period, taxes, entitlements.
- Emergency numbers and youth-help services per region on screens 25 and 58: TO BE CONFIRMED. The design uses 112 as in the current app, which is not right for every region.
- All legal wording and DPDP/PIPEDA statements: pending legal and implementation review (Indian and Canadian counsel).

## Task: investigate preview outbound messages
The audited preview ran with OUTBOUND_MODE=live and OUTBOUND_PROFILE=production. Before further testing: (1) identify whether any real SMS, email, call prompt or safety alert was sent from the preview; (2) document the result with evidence (logs, provider dashboards) and who was affected; (3) switch preview and QA to a test profile with sandboxed delivery and dummy recipients; (4) add a server-side startup check that blocks production outbound settings in preview. A banner is not a substitute. Status: NOT STARTED.
