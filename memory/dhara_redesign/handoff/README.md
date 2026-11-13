# DHARA UI Revision: Emergent Handoff v2

Version: v2 (design revision of the 53-screen reference plus 4 new consent-ledger screens). Date: 2026-11-13.
This is a design-and-handoff package. Nothing here was deployed. The live app was not modified or tested.

## What is in the package
| Item | Purpose |
|---|---|
| DESIGN_CHANGELOG.md | What changed from the original and why |
| CLASSIFICATION.md | Every change sorted into the five required classes |
| design-tokens.json, theme.ts | Colours, type, spacing, radii, elevation, breakpoints, semantic states |
| assets/ | Editable SVG icons extracted from the screens, plus asset-manifest.csv |
| fonts/README.md | Font sources, licences, script coverage, fallbacks |
| screen-manifest.csv | All 53 reference screens with a disposition, plus new screens 54-57 |
| route-component-map.csv | Routes and components. All UNVERIFIED (no source code was available) |
| component-specifications.md | Shared components, states, accessibility, platform notes |
| CONSENT_STATE_SPEC.md | Consent states, guest handling, ledger, withdrawal, download |
| screens/ | Editable .dc.html screen files, canvas.json, support.js, PNG exports |
| preview/ | Responsive HTML/CSS design reference for 7 priority journeys, PNGs at 320/360/390/412/768/1280 |
| DHARA_UI_Design_Review_v2.pdf | Screens with page numbers, IDs and annotations |
| COPY_AND_CAPABILITY_AUDIT.csv | Original claim, corrected wording, evidence, status, dependency |
| REGRESSION_ACCEPTANCE.csv | Test cases. Every functional test is NOT RUN |
| A11Y_CHECK_REPORT.md | What was checked, results, and what was NOT checked |
| EMERGENT_IMPLEMENTATION_PROMPT.md | Instructions for the implementing agent |
| OPEN_ITEMS.md | Unverified items and decisions needed |

## Priority journeys (assumption)
The request referred to "priority journeys listed above" but no list was provided. Responsive layouts were made for: language, consent, home/ask, emergency, record, consent settings (withdrawal), consent history/download. Tell us if the intended list differs.

## Source references
53-screen "DHARA App Flow.pdf", "DHARA Emmy Prompt.html", "2 Choose language.png", the design canvas artifact (left untouched) and the live preview (observed, not exercised). Source code was NOT available.

## Assumptions
- Target is React Native with Expo. The framework and version are assumptions (theme.ts is labelled accordingly).
- Screens are 390x844 design references. Desktop and tablet layouts are responsive HTML/CSS, not canvas boards.
- Route names in the manifest are design file names, not verified routes. Only /language was observed on the live app.

## Known limitations
- No backend exists for the consent ledger in this package. Screens 54-57 are designs only. Legal sufficiency of any DPDP Act or PIPEDA statement is not confirmed. No compliance badges are used.
- Prototype interactions (checkbox toggles, withdrawal steps, download states) are click-through demos. They do not show that the live app works.
- Pro pricing reads "Price to be confirmed". Any future price must come from approved application configuration.
- Not produced: .fig or other native design-tool files, a repository patch, or tested application code. Exports available: SVG, PNG, HTML/CSS, PDF, CSV, Markdown, JSON, TS.
- Not performed: see A11Y_CHECK_REPORT.md.
- The original logo file was not available in this environment. It is not included. See OPEN_ITEMS.md.
