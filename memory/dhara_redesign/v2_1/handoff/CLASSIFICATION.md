# Change classification

Classes: V = Visual change; C = Copy correction; P = Existing behaviour to preserve; N = New functionality requiring separate approval; U = Unverified implementation detail.

| Item | Class | Note |
|---|---|---|
| Colour, contrast, type size, 48px targets, focus rings, reduced motion | V | Presentation only |
| Responsive desktop and tablet layouts | V | Reference HTML/CSS |
| Gold/navy/cream identity, voice-first action | V | Kept |
| Removing "Police notified", "send without unlocking", background-recording guarantees | C | Needs capability evidence before any return |
| Pro "Price to be confirmed" | C | Price must come from approved config |
| Privacy wording reconciled with approved policy | C | Live notice describes cloud storage |
| Separate age, terms, processing, optional consent | P | Unchecked by default in design |
| Guest access, existing sign-in methods | P | No phone/OTP, PIN or biometrics introduced |
| Withdrawal, export, account deletion pathways | P | Entry points preserved |
| Quick exit, permissions, sharing expiry, revocation, feature flags | P | Not altered |
| Escalation timers, safety triggers | P | Not altered |
| Language search field | N | Only if it does not already exist |
| Server-backed consent ledger (screens 54-57) | N | Backend, storage, retention, sync, download all new |
| Withdrawal that stops only affected processing | N/U | Mapping of purposes to processing is unverified |
| Consent versioning and re-consent prompts | N | Needs legal text versions |
| Route names, component bindings, API contracts | U | No source access |
| Whether live preview Calling/SMS capabilities exist in production | U | Preview showed "Calling not yet active" |
| DPDP Act 2023 and PIPEDA statements | U | Pending legal and implementation review |
| Offline availability per feature, voice support per language | U | Unverified |
