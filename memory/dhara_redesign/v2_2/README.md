# v2.2 design package — the authoritative one

Added 23 Nov 2026. Until now the repo only held older copies, and work was
measured against them by mistake:

| Folder | Version |
|---|---|
| `../editable_screens/`, `../handoff/` | **v1** (13 Nov) |
| `../v2_1/` | **v2.1** (13 Nov) |
| **this folder** | **v2.2** (14 Nov) — use this one |

Source: Google Drive `DHARA_editable_screens_v2.2.zip` (58 screens) and
`EMERGENT_IMPLEMENTATION_PROMPT.md` v2.2.

**The handoff zip has since arrived** and its text part is now in
`handoff/` — the component specs, the consent and audit documents, the
acceptance and manifest CSVs, the tokens, the icon SVGs and the responsive
preview pages. See `handoff/README_IMPORT.md` for what was left in Drive and
why, and for the four wording corrections made on import. It confirmed that
the 58 screens here are byte-identical to the zip's, and that
`design-tokens.json` and `theme.ts` are identical across v1, v2.1 and v2.2.

| Folder | What it holds |
|---|---|
| `editable_screens/` | The 58 `.dc.html` screens, `canvas.json`, `support.js` |
| `handoff/` | Specs, audits, CSVs, tokens, icons, responsive preview |
| `baseline_2026-11-23/` | The live app **before** the v2.2 work, plus the test and type counts every step must hold |

Read `handoff/component-specifications.md` and `handoff/preview/dhara.css`
before building any shared UI: they carry the real numbers for buttons,
cards, chips, the top bar, the tab bar, the SOS pill and the consent rows.
Note the desktop breakpoint is **1100**, not 1280, and the content column is
capped at 960px.

## What v2.2 changed against the v1 screens in this repo

1 new screen, 8 changed, 49 identical.

| Screen | Change |
|---|---|
| **UnderAge** (58) | New. |
| Emergency | "Call emergency services" became "Open dialler for 112". |
| Record | Pause and "make the screen dark" removed; the saved line became "Saved on this phone. Sharing is your choice." |
| Consent | The optional choices became data-driven; the consent-log wording was dropped. |
| ConsentMgmt | Renamed "Privacy choices"; now says it is a proposed design and that only the two optional choices can be changed today. |
| ConsentHistory | Says the Emergency screen is not blocked by a re-consent; "Change an optional choice". |
| ConsentDownload | Narrower description of what the record contains. |
| ConsentReceipt | Softer guest wording; the required-withdrawal sentence removed. |
| WithdrawConfirm | Marked "approved design; backend pending engineering and legal review". |

Most of those are claims being walked back, which matches the prompt: these
screens are not approved to build.

## Already done in the app

The Emergency and Record changes are **already implemented**: "Open dialler
for 112" everywhere (PR #94, #108) and no pause or dark-screen control on
Record (PR #95, test-enforced).

## Not to be built (prompt §11 and the v2.2 additions)

Screens 54–57 (consent ledger), UnderAge (58), required-consent withdrawal,
any price display, and Login's phone/OTP. Each needs its own scoped ticket
with engineering and legal review.

**Finding, 23 Nov:** screens 54 and 55 were built anyway by earlier merged
work — the consent record and the consent-history ledger in
`app/settings/data-privacy.tsx`, with a backend endpoint
`GET /api/user/consent-history` (`backend/server.py:2221`). Screens 56 and
57 were not built; the app's "Withdraw consent" and "Download my data" are
older features that cover the two optional choices only, and no screen
withdraws a required consent. Reported to the owner; nothing removed.
