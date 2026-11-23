# Consent state specification (v2.2)

STATUS: design specification. CURRENT = observed in the code audit (commit 4fe44a8, preview only). APPROVED DESIGN = approved by the product owner on 2026-11-13 as a design; backend NOT built, pending engineering and legal review. PROPOSED = not approved. Legal sufficiency of everything here is UNVERIFIED. DPDP Act 2023 and PIPEDA statements are pending legal and implementation review. No compliance badge is used. All legal wording and region-specific emergency information is TO BE CONFIRMED.

## Controls
| Control | Label | Required | Default | Status |
|---|---|---|---|---|
| Age | I am 18 years or older / I am under 18 | Yes | Neither selected | CURRENT |
| Terms | I agree to the Terms of Use | Yes | Unchecked | CURRENT |
| Using my information | I agree to Dhara using my information as described above to answer my questions and prepare my complaint draft | Needed for some features | Unchecked | CURRENT label; withdrawal = APPROVED DESIGN |
| Analytics | Help improve Dhara by sharing anonymous usage information | No | Off | CURRENT |
| Updates | Send me legal awareness tips and updates by SMS or WhatsApp | No | Off | CURRENT; enforcement not built |
Design rule: age confirmation, Terms acceptance and consent to process personal data are shown as separate choices and are never one switch.

## Under 18 (screen 58, APPROVED DESIGN, backend pending)
Choosing under 18 must not continue into the adult journey. The screen says Dhara is not available to people under 18, asks for nothing else, and tells the person to use their phone to call the emergency number for their area. The emergency number and any youth-help service are placeholders TO BE CONFIRMED and approved per region. No parental-consent flow is designed. Engineering must confirm that no account is created and no matter details are collected.

## Withdrawal (screen 56, APPROVED DESIGN, backend pending)
Withdrawing "Using my information":
1. Before confirming, the screen lists What stops, What still works, and Data already saved.
2. What stops: processing that relies on that consent (answers using what the user says, types or scans; drafting; saving new files). The exact feature list needs mapping by engineering.
3. What still works: emergency screen (open dialler, prepare a message, quick exit), the Rights library, privacy choices, consent history, support, Export my data, Delete my account. Unrelated features are not blocked automatically.
4. Data already saved: not deleted by withdrawal. Deletion is a separate action. The screen says some information may be kept where the law requires or to resolve disputes, and that what is kept, why and for how long is to be confirmed by counsel. It must not promise complete deletion while any identifiable record is kept, and must not say a record is kept forever.
5. Stopping affected processing happens after withdrawal, subject to legal obligations and technical completion. The screen does not say "immediately".
Withdrawing analytics or updates: same screen. Analytics off stops event tracking (CURRENT). Updates must be checked at dispatch time, withdrawal propagated to queues and providers, and an unsubscribe provided (engineering requirements; not built). Essential service or security messages are separate from optional updates.
Defaults for optional updates stay off.

## Record and retention (UNDECIDED)
CURRENT: server consent_log is append-only and is not deleted with an account. DECISION PENDING: which fields are kept, for what legal or dispute purpose, for how long per jurisdiction, how it is de-identified or deleted, who can access it, and what the user is told. Counsel must approve. A pseudonymous record can still be personal information if it can be linked back. No retention period is shown anywhere in the design.

## States
CURRENT: Agreed, Not given (optional choices). APPROVED DESIGN: Withdrawn (using my information). PROPOSED: Pending sync, Sync failed, Re-consent required per purpose.

## Guest handling
CURRENT: guest rows use an anonymous ID and are linked at sign-in. Anonymous inserts are rate-limited. PROPOSED: a user-facing guest record view (screen 55).

## Download (PROPOSED, screen 57)
New endpoint and file generation. Existing Export my data is a summary only.

## Notice versions
One notice version string exists today. A global guard redirects to the consent screen when it changes, except for the emergency and a few other routes. A list of past versions does not exist.
