# Consent state specification (v2.1, aligned to the code audit)

STATUS: design specification. Items marked CURRENT are observed in the code audit (commit 4fe44a8, preview). Items marked PROPOSED do not exist in the app and need separate approval. Backend implementation of any PROPOSED item and legal sufficiency are UNVERIFIED. DPDP Act 2023 and PIPEDA statements are pending legal and implementation review. No compliance badge is used.

## Controls (CURRENT)
| Control | Label | Required | Default |
|---|---|---|---|
| Age | I am 18 years or older / I am under 18 | Yes | Neither selected |
| Terms | I agree to the Terms of Use | Yes | Unchecked |
| Data processing | I agree to Dhara using my information as described above to answer my questions and prepare my complaint draft | Yes | Unchecked |
| Analytics | Help improve Dhara by sharing anonymous usage information | No | Off |
| Updates | Send me legal awareness tips and updates by SMS or WhatsApp | No | Off |
Behaviour when "I am under 18" is chosen was not found in the audit: OPEN item.

## States (visible to the user)
CURRENT: Agreed, Not given. Optional choices can change between them in Privacy choices.
PROPOSED: Pending sync, Sync failed, Re-consent required (a re-consent redirect already exists in code via notice version, but no per-purpose state is shown).
Required choices have no Withdrawn state in the app.

## Record (CURRENT, server consent_log, append-only)
Time (UTC), notice version, language, app version, age confirmation, purposes (core, analytics, updates), user ID or anonymous ID. Device keeps the notice version string only. Each privacy-choice change adds a new row.

## Guest handling
CURRENT: guest rows use an anonymous ID and are linked to the account at sign-in. Anonymous inserts are rate-limited. PROPOSED: showing a guest record and its sync status to the user.

## Withdrawal
CURRENT: only analytics and updates, via /consent?mode=update. Analytics off stops tracking in the app. Updates off is stored but not enforced in code (ENGINEERING TO CONFIRM before the screen says anything stops). Core consent cannot be withdrawn; the only exit is account deletion.
PROPOSED (screen 56): show consequences before confirming, for the two optional choices only: What stops, What still works, Data already saved (not deleted by this choice). Withdrawing required consent is NOT designed. It would need a product and legal decision.

## Deletion and records (legal decision needed)
consent_log is never purged on account deletion. Decide whether that is acceptable and how to tell the user (draft wording is on screens 54 and 56, marked to be confirmed by legal).

## Download (PROPOSED, screen 57)
PDF or JSON consent record: new endpoint and file generation. Existing Export my data gives a summary only. States: idle, busy, ready, failed, offline (no retry control unless built).

## Version history (PROPOSED, screen 55)
Lists consent_log entries, guest/account toggle, sync status. Only one notice version string exists today; there is no list of past versions.
