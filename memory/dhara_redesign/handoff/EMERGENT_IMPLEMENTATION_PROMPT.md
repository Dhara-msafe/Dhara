# Implementation prompt for the Emergent agent

You are implementing a visual revision of the DHARA app from the attached design package. This is a visual and copy revision. It is not permission to add features, change behaviour, deploy or merge to production.

Read first: README.md, CLASSIFICATION.md, screen-manifest.csv, route-component-map.csv, COPY_AND_CAPABILITY_AUDIT.csv, OPEN_ITEMS.md, CONSENT_STATE_SPEC.md, A11Y_CHECK_REPORT.md.

Instructions:
1. Inspect the actual repository, the installed framework versions and the deployed commit. Write them down before editing. The package assumes React Native with Expo; confirm or correct that.
2. Reconcile screen-manifest.csv and route-component-map.csv with the real routes, components and feature flags before editing anything. Every route and component in the package is UNVERIFIED. The live language screen was observed at /language, the design guide says /main: keep the real route.
3. Record existing defects separately from regressions caused by this redesign. Capture a baseline first.
4. Preserve API contracts, authentication (including guest access), state, storage keys, account isolation, validation, consent records, legal-engine behaviour and safety logic. Do not change escalation timers or safety triggers. Do not add phone/OTP, a PIN system or biometrics. Do not redirect scan completion to /heard without confirming the OCR workflow. Do not replace fraud-help navigation with Advocate Register. Do not delete files because they look duplicated.
5. Apply design tokens (design-tokens.json, theme.ts) and small presentational changes first.
6. Avoid unnecessary dependency upgrades, routing changes and rewrites.
7. Pilot on a small number of low-risk screens (for example 8 Type instead, 29 One right, 36 Panic lesson) before wider changes.
8. Keep a rollback path, preferably a presentation flag that does not alter stored data. Test it on and off.
9. Test changed journeys on web and on a physical Android build. Run REGRESSION_ACCEPTANCE.csv. Record results honestly; anything not run stays NOT RUN.
10. Report changed files, test evidence, limitations and rollback steps.
11. New functionality stays outside this revision unless approved separately. This includes the server-backed consent ledger (screens 54-57), language search if it does not exist, and any pricing display. For screens 54-57, implement visuals only if the existing consent flow already has the data; do not invent storage or endpoints.
12. Do not deploy and do not merge to production.

Content rules: no "Police notified", no "send without unlocking", no guaranteed background recording, no "Sharing active"/"Viewing"/"Contact accepted" unless the app reports it, no blanket on-device or end-to-end encryption claims, no compliance badges, no sample ratings or personal details, no pricing unless approved configuration supplies it. Legal answers, citations and verification labels come from the existing legal engine. Do not replace a conditional answer with a decorative "verified" label.
Consent copy: use unchecked defaults and keep age, terms, processing and optional controls separate.
Do not describe the HTML/CSS preview or the reference theme as tested application code.
