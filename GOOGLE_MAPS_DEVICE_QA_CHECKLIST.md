# Google Maps / Places — Device Acceptance Checklist

Deliverable requested by `DHARA_Google_Maps_Standardisation_Full_Review.pdf`,
Section 8 ("Phase 4 — Android and iOS QA") and Section 9 ("Task 6 — Testing").
Covers everything that genuinely requires a physical device and/or a live
Google key — i.e. everything that could **not** be verified from this repo
checkout. Run this once `GOOGLE_PLACES_SERVER_KEY` + `FEATURE_GOOGLE_PLACES_V1`
are live and the client keys are confirmed working
(`python scripts/verify_google_places_config.py` / `node scripts/verify_google_maps_keys.js`
both pass first).

## Prerequisites before starting this checklist
- [ ] `GOOGLE_PLACES_SERVER_KEY` set, `FEATURE_GOOGLE_PLACES_V1=true`, confirmed via the backend verify script
- [ ] `EXPO_PUBLIC_PLACES_AUTOCOMPLETE_V1=true` set in the client build
- [ ] `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` (Android) and `EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY` (iOS) confirmed valid
- [ ] Billing active and quota/budget alerts configured in Google Cloud Console (Section 7 of the review — not verifiable from code)

## Android
- [ ] Native map renders (Head Out live tracking, destination picker) — no blank/grey tile area
- [ ] Destination search: typing an Indian address shows live Google-sourced suggestions, not the OSM fallback (check the dropdown appears within ~300ms of the last keystroke, no visible flicker between providers)
- [ ] Selecting a suggestion resolves to the correct pin position (compare against the address in a real maps app)
- [ ] Saved-place create/edit still works end-to-end with the new schema (`google_place_id`, `coords_source` populated on create from a Places-sourced destination)
- [ ] Nearest Help → Police station: in-app results list appears with name/address/distance, "Open in Maps" hands off correctly to the installed Maps app
- [ ] Nearest Help → Hospital: same as above
- [ ] Nearest Help → Sakhi One Stop Centre (Text Search): results appear even without granting location permission (bias-only, not required)
- [ ] Revoke location permission mid-session → Nearest Help/destination search fail closed to the manual search / external-Maps path, no crash
- [ ] Turn off mobile data mid-search → graceful "temporarily unavailable" message, not a hang or crash
- [ ] Force `GOOGLE_PLACES_SERVER_KEY` to an invalid value (staging only) → every Places-pilot endpoint fails closed (503/502), OSM manual search and external Nearest Help links still work
- [ ] Exceed Places API quota (staging only, or simulate via Cloud Console rate limit) → fails closed the same way, no stack trace surfaced to the user

## iOS
- [ ] Repeat every Android item above on a physical iOS device (not just simulator — simulator GPS/network behavior can mask real issues)
- [ ] Confirm `EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY` renders Google Maps (not a blank map) — this key is separate from the Android one and has its own bundle-ID restriction
- [ ] Confirm the iOS build does **not** silently fall back to Apple Maps anywhere (there is no Apple Maps code path in this app — if a blank/wrong map appears on iOS, it's a key/config issue, not a provider fallback)

## Cross-platform / regression
- [ ] Guardian map (last-known-location view) still renders correctly — unaffected by any of this work, but confirm no shared-dependency regression
- [ ] Silent Alert's location capture still works (untouched by this migration — confirm it wasn't accidentally affected)
- [ ] Trusted Circle permissions, consent/revocation, and offline last-known-location behavior all unchanged
- [ ] No new background location permission prompt appears anywhere (Nearest Help and destination search both request **foreground-only**, one-shot location)
- [ ] Saved place created before this migration (no `google_place_id`/`coords_source`) still loads and displays correctly — `needs_refresh` must be `false`/absent for these, never crash on missing fields

## Sign-off
| Item | Tester | Date | Result |
|---|---|---|---|
| Android pass | | | |
| iOS pass | | | |
| Cross-platform regression pass | | | |

Once all boxes are checked, this closes out Section 8 Phase 4 and the device-dependent portion of Section 9 Task 6 from the review.