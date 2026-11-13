# Consent state specification

STATUS: design specification. Backend implementation is UNVERIFIED. Legal sufficiency is UNVERIFIED. Statements about India's DPDP Act 2023 and Canada's PIPEDA are pending legal and implementation review. No compliance badge is used.

## Purposes
| Key | Label (design) | Required to use DHARA |
|---|---|---|
| age | I am 18 years or older | Yes |
| terms | Terms of Service | Yes |
| proc | Processing my data | Yes |
| voice | Voice features | No (design assumption, UNVERIFIED) |
| loc | Location | No (UNVERIFIED) |
| circle | Sharing with my circle | No (UNVERIFIED) |
| usage | Help improve DHARA | No |
The purpose list for screen 47 is a design proposal. Confirm against actual processing.

## States per purpose
Agreed; Not given (default, never preselected); Withdrawn; Pending sync (saved on this device, not yet confirmed by the server); Sync failed; Re-consent required (policy version changed).

## Record fields (each created when the user agrees)
Record ID; date and time with time zone; Terms version; Privacy Policy version; language shown; holder (Guest on this install, or account); each purpose and its state. Fields are placeholders in the design; no sample identities appear.

## Guest consent
Guest record is tied to the install. If the app is reinstalled, the record may be lost. The user is told to download it. Whether and how a guest record merges into an account at sign-in is an OPEN decision.

## Version history (screen 55)
Versions list; entries timeline (agreed, withdrawn, agreed again, version change); sync status line; Guest/Account toggle. Entries are append-only in the design: withdrawal adds an entry, it does not erase earlier ones. Retention period is an OPEN legal decision.

## Withdrawal (screen 56)
1. Review: What stops; What still works; Data already saved (default: keep; option: also delete). Consequences appear before the confirm button.
2. Confirm: a new ledger entry is created and shown.
Rules: only the affected processing stops; unrelated features and essential access remain where feasible. Withdrawing a required choice means DHARA cannot be used until the user agrees again (copy on screens 54 and 47). Timing of when processing stops is TO BE CONFIRMED BY ENGINEERING. Do not state "immediately" until verified. Existing export and account-deletion pathways stay as they are.

## Download (screen 57)
PDF or JSON; included and not included lists; states: idle, busy, ready, failed, offline. No retry button unless retry exists. The state switcher in the design is for design review only.

## Sync states
Saved on server; pending; failed (message plus next step); offline (queued on device is only claimed if implemented).

## Unverified backend requirements (for engineering and legal)
Storage location; identifiers for guests; ledger immutability; audit access; retention and deletion rules; policy versioning source; notification of version changes; download authentication; rate limiting; whether a withdrawal propagates to analytics and third parties.
