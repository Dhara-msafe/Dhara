# v2.2 design package — the authoritative one

Added 23 Nov 2026. Until now the repo only held older copies, and work was
measured against them by mistake:

| Folder | Version |
|---|---|
| `../editable_screens/`, `../handoff/` | **v1** (13 Nov) |
| `../v2_1/` | **v2.1** (13 Nov) |
| **this folder** | **v2.2** (14 Nov) — use this one |

Source: Google Drive `DHARA_editable_screens_v2.2.zip` (58 screens) and
`EMERGENT_IMPLEMENTATION_PROMPT.md` v2.2. The 15 MB `Handoff_v2.2.zip`
(the CSVs, tokens and A11Y report) is over the Drive connector's limit and
is not here yet; until it arrives, the v2.1 copies of those files in
`../v2_1/handoff/` are the closest available, and `design-tokens.json` is
identical between v1 and v2.1.

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
