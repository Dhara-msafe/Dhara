# Findings from the Emergent read-only code audit

Source: AUDIT_REPORT.md produced by the implementing agent. Commit 4fe44a8ad8a537e245a35ba921c9cbda39bd612e. Preview environment only; production was not inspected. Framework: Expo (expo-router ~55.0.18, react-native 0.83.10). Not independently verified by the design team.

## Consent (real behaviour)
- Controls: age (18+ or under 18, neither selected), Terms of Use checkbox, data-processing checkbox, optional analytics, optional updates (SMS/WhatsApp). All unselected by default.
- Saved on device (notice version string only, AsyncStorage) and on server (consent_log: user_id, anon_id, notice_version, purposes core/analytics/updates, language, age_confirmed_18, timestamp, app_version). consent_log is append-only.
- `purposes.core` is always sent as true. The data-processing checkbox only enables Continue.
- Withdrawal (Data privacy > Withdraw consent) opens /consent?mode=update and PATCH /api/user/privacy-choices. Only analytics and updates can change. Nothing in the code sets core to false.
- analytics=false stops event tracking in the app. updates=false is stored but no code enforces it.
- Account deletion does not delete consent_log ("never purged (legal proof)"). Needs a legal decision.
- Notice version is one hard-coded string (2026-10-01). A global ConsentGuard redirects to /consent when the stored version differs; the language, consent, emergency, guardian and a few other routes are exempt.
- Guest consent is rate-limited (50 inserts per IP per day) and is linked to the account at sign-in (/api/consent/link).
- Export (my-data) returns a summary of counts and the latest consent entry, not a full data dump.
- Not in the app: consent receipt, history, withdrawal-consequences, download, five-purpose settings (screens 54-57 and the five-purpose version of 47).

## Other facts
- Language search: not found. Pause, dark-screen recording control: not found. Recording is stored locally (exact words "Saved to this phone" not found).
- Pro price comes from backend environment variables, defaults INR 99 and USD 5. The Pro screen is off in preview.
- 4 visible tabs: Home, Rights, My files, Me.
- Emergency: the 112 element on the Emergency screen has no press handler. Other screens (nearest help, officer card, trusted circle) call the dialler; SMS screens open the composer. Nothing sends automatically. Emergency short codes are blocked for SMS. Preview .env has OUTBOUND_MODE=live and OUTBOUND_PROFILE=production.

## Not verified by the audit
Params and guards for many screens, an app-wide auth guard, production environment values, whether openPhone applies the same emergency-number rule as SMS, and whether the outbound guard test passes.
