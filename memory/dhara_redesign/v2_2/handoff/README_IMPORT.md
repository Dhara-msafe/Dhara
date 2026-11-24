# How this folder got here, and what was changed

Source: `DHARA_UI_Revision_Emergent_Handoff_v2.2.zip`, 18 MB, supplied by the
owner on 23 Nov 2026. This folder is the text part of that zip, 624 KB.

## What is here, and what is not

Here: the specs, the consent and audit documents, the acceptance and manifest
CSVs, the design tokens and `theme.ts`, the 104 icon SVGs, the font notes, and
the responsive preview pages (HTML and CSS).

Deliberately left in Drive, by the owner's decision, because git is the wrong
place for them and they are all regenerable or already covered:

| Not copied | Size | Why |
|---|---|---|
| `DHARA_UI_Design_Review_v2.pdf` | 4.6 MB | A rendering of screens we already hold as source |
| `screens/png/` (68 renders) | 6.2 MB | Renders of the `.dc.html` screens, which are in `../editable_screens/` |
| `preview/png/` (48 renders) | 5.2 MB | Re-rendered from `preview/*.html` + `dhara.css` at any width |

`EMERGENT_IMPLEMENTATION_PROMPT.md` is not duplicated here: the copy in
`../EMERGENT_IMPLEMENTATION_PROMPT.md` is byte-identical.

## Verified against what we already had

- The zip's 58 `.dc.html` screens are **byte-identical** to
  `../editable_screens/`. So is `canvas.json`, and so is the prompt.
- `design-tokens.json` and `theme.ts` are **identical across v1, v2.1 and
  v2.2**. Nothing about colour, type, spacing or radius changed between
  versions.
- 18 of the PNG renders differ from v2.1, which looks alarming but is not: the
  dimensions are the same and the byte sizes are within 0.1%, and 12 of those
  18 have identical HTML. They are re-renders. The real screen changes are
  still **8 changed and 1 new (UnderAge)** against v1.

## Edited on import

Everything in this folder is verbatim from the zip **except** the four lines
below. The package was never relabelled when it went from v2 to v2.2, so its
own front matter described the wrong version and the wrong screen count.
Corrected on the owner's instruction:

| File | Was | Now |
|---|---|---|
| `README.md` title | `Emergent Handoff v2` | `Emergent Handoff v2.2` |
| `README.md` version line | `Version: v2 (… 53-screen reference plus 4 new consent-ledger screens)` | `Version: v2.2 (… plus 4 consent-ledger screens and the under-18 screen: 58 in all)` |
| `README.md` manifest row, package note | `new screens 54-57` | `54-58`, naming screen 58 |
| `DESIGN_CHANGELOG.md` title and new-screens line | `(v2 vs original)`, `New 54-57` | `(v2.2 vs original)`, `New 54-58` |
| `CLASSIFICATION.md` ledger row | `(screens 54-57)` | adds the under-18 screen (58) |

Two references to "53" were **left alone on purpose** and are not errors: the
source document really is a 53-screen PDF, and `in_53_reference_set` is a
column in the manifest that records which screens came from it.

## Two files v2.1 had and v2.2 does not

`GROUPS_D_TO_J_REPORT.md` and `STAGE_6_RELEASE_SUMMARY.md` are in
`../../v2_1/handoff/` and were not reissued with v2.2. Nothing points at them;
noted so nobody assumes they were deleted on purpose.

## What this folder is for

`component-specifications.md` and `preview/dhara.css` are the two to read
before building shared UI: between them they give the real numbers for
buttons, cards, chips, the top bar, the tab bar, the SOS pill and the consent
rows. The `.dc.html` screens show what a screen looks like; these two say what
the pieces are made of.

Three things worth knowing before using them:

1. **The desktop breakpoint is 1100, not 1280**, and the content column is
   capped at 60rem (960px) and centred. Checks run at 1280 are past the cap.
2. **Four tabs — Home, Rights, My files, Me — are specified as "keep these."**
3. The SOS pill is fixed bottom-right, above the tab bar on mobile
   (`bottom:5rem`) and lower once the tab bar is gone at 768+ (`bottom:1.5rem`).

Everything in the package is a design reference. Nothing in it was built or
tested against the live app, and `route-component-map.csv` says so itself:
the route and component bindings are unverified, because the design team had
no source access.
