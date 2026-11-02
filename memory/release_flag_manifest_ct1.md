# DHARA — Closed-Test Candidate 1 (CT-1) Flag Manifest

Status: DRAFT — awaiting founder sign-off (T-08). Values are read from the repo `.env` files at the
time of writing; keys/URLs are shown only as `<set>` / `<blank>`. Expo `EXPO_PUBLIC_*` flags are baked
in at BUILD time — changing them after the APK is built has no effect until the next build.

## Founder decisions recorded
| Decision | Value |
|---|---|
| Legal correction (IPC §166A → BNS §199) + 10 rights cards | **Ship WITHHELD** — approval gate stays fail-closed until a real advocate artefact (identity + date + out-of-band signature) exists |
| AT40 headphone-unplug speech pause | **DEFERRED** — known limitation for CT-1 |
| Head Out missed-check-in alert | Founder selected BOTH "Simulated" and "Real SMS prepared" → recorded as **per-environment**: QA/preview = simulated (`true`); closed-test build = **TO CONFIRM** (see below) |

> ⚠ Head Out: the founder must confirm which value the CT-1 AAB is built with. `EXPO_PUBLIC_ALERT_SIMULATION_MODE`
> is a single build-time value; one APK cannot be both. Current repo value: `true` (simulated).

## Frontend (`frontend/.env`) — build-time
| Flag | Current | Effect in CT-1 |
|---|---|---|
| EXPO_PUBLIC_ALERT_SIMULATION_MODE | true | Head Out missed check-in shows "Simulated — nothing sent" (only Head Out; Silent Alert always opens the SMS app for the user to send) |
| EXPO_PUBLIC_SAFE_WORD_V1 | true | Code-phrase → Silent Alert enabled (device test T-04 required) |
| EXPO_PUBLIC_SILENT_ALERT_EVIDENCE_V1 | true | Silent Alert can start evidence recording |
| EXPO_PUBLIC_EVIDENCE_SEGMENTED_RECORDING | true | ~5 s encrypted segments (device test T-11 required) |
| EXPO_PUBLIC_EVIDENCE_ACTIONS | true | Notes + "Start FIR draft" on evidence items |
| EXPO_PUBLIC_SAFETY_SESSION_V1 | true | Head Out visible |
| EXPO_PUBLIC_DESTINATION_PICKER | true | Head Out destination map (needs Maps key in build) |
| EXPO_PUBLIC_PLACES_AUTOCOMPLETE_V1 | false | Place search off |
| EXPO_PUBLIC_GO1B_GPS | false | No GPS in journeys |
| EXPO_PUBLIC_GPS_BACKGROUND | false | No background location |
| EXPO_PUBLIC_TRUSTED_CIRCLE_V2 | true | Email field on trusted contacts |
| EXPO_PUBLIC_TRUSTED_CIRCLE_RECIPIENT | false | Recipient-side features off |
| EXPO_PUBLIC_GUARDIAN_SHARE | true | Guardian Journey link shared via SMS (shared anonymous token — security decision T-12 open) |
| EXPO_PUBLIC_CAMPUS_LAYER | true | Campus safety section visible |
| EXPO_PUBLIC_AUDIO_ARBITER_ENABLED | true | Single-owner mic arbiter ON (Evidence Locker wins) |
| EXPO_PUBLIC_MIC_LEASE_GUARD_ENABLED | true | Mic lease guard ON |
| EXPO_PUBLIC_VOICE_COMPANION_ENABLED | false | Voice companion off |
| EXPO_PUBLIC_PROFILE_PHOTO | false | Profile photo off |
| EXPO_PUBLIC_STT_PROVIDER | whisper | Cloud speech-to-text |
| EXPO_PUBLIC_PRIVACY_COVER_V1 | *(not in .env → OFF)* | Privacy cover UI off |
| EXPO_PUBLIC_GOOGLE_MAPS_API_KEY / _IOS_ / _WEB_ | `<set>` (real-format keys) | Injected by `app.config.js`; verify map renders on device (T-10) |
| EXPO_PUBLIC_BACKEND_URL | `<set>` | Must point at the production backend for the AAB |

## Backend (`backend/.env`) — runtime
| Flag | Current | Note |
|---|---|---|
| FEATURE_C1_CONVERSATIONAL_REPLIES | true | Greetings / "help me" SOS reply |
| FEATURE_MATTER_CONTEXT_V2 | true | Session jurisdiction |
| FEATURE_GOOGLE_PLACES_V1 | false | Matches frontend autocomplete OFF |
| CITATION_GUARD_ENABLED | true | Strips leaked IPC/CrPC citations |
| SAFETY_TEST_MODE | false | |
| RETENTION_PURGE_ENABLED | false | Data-retention purge OFF — confirm against privacy policy before production |
| FREE_DAILY_QUERIES | 200 | |
| TERMS_VERSION | 1.0 in .env, but API reports **2.0** (`legal.TERMS_VERSION` is used) | Cosmetic mismatch; .env value is unused |
| OPS_ALERT_EMAIL / OPS_ALERT_SLACK_WEBHOOK_URL | `<blank>` | eCourts outage alerts no-op (T-16) |

## Sign-off
- [ ] Founder confirms Head Out value for CT-1 AAB
- [ ] Founder confirms every row above
- Signed / date: ____________________
