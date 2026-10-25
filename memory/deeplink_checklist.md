# Native `dhara://` Deep-Link — Verification Checklist

> ⚠️ This feature CANNOT be validated in Expo Go or the web preview.
> A **development or production build** on a real iOS or Android device is required.

---

## Configuration Audit (already verified in code)

| Item | Location | Status |
|---|---|---|
| Scheme registered | `app.json` → `"scheme": ["dhara", "msafelegalaid"]` | ✅ Present |
| Guardian route file | `app/guardian/[token].tsx` | ✅ Present |
| Token param extraction | `useLocalSearchParams<{ token: string }>()` | ✅ Correct |
| Deep-link JS builder | `_private_html()` in `journey_router.py` — `dhara://guardian/{encodeURIComponent(tok)}` | ✅ Correct |
| Expo Router linking | File-based routing automatically maps `dhara://guardian/TOKEN` → `app/guardian/[token].tsx` with `token=TOKEN` | ✅ No extra config needed |
| Unauthenticated guard | Screen shows Sign-in prompt if `authToken` is null; does NOT expose journey data | ✅ Implemented |

---

## On-Device Test Steps (after build)

### T1 — Deep link from browser (cold start)
1. Open a mobile browser (Safari/Chrome) and navigate to `https://your-domain/api/journey/status/TESTTOKEN`.
2. Observe: static privacy page with lock icon and "Open in DHARA app →" button.
3. Tap the button.
4. **Expected**: DHARA opens. If not logged in → Sign-in screen. If logged in → Guardian screen loads.
5. **Pass criteria**: Token in Guardian screen URL matches `TESTTOKEN`. No journey data shown to unauthenticated user.

### T2 — Deep link from SMS / WhatsApp (background start)
1. Send the URL `https://your-domain/api/journey/status/TESTTOKEN` via SMS to the test device.
2. Tap the link in the SMS app.
3. OS should offer to open DHARA (or open it directly if it was the last handler).
4. **Pass criteria**: Same as T1.

### T3 — Deep link with already-logged-in session
1. Log in to DHARA on the test device.
2. Open a browser and navigate to the guardian status URL.
3. Tap "Open in DHARA app →".
4. **Expected**: DHARA opens directly to Guardian screen (no sign-in prompt). Journey data or error card shown depending on link validity.

### T4 — Expired token (410)
1. Use a journey token whose `expires_at` is in the past.
2. Open the deep link while logged in.
3. **Expected**: Guardian screen shows "Link expired" error card with clock icon.

### T5 — Unauthorized token (403)
1. Use a valid journey token for a journey this user is NOT a recipient of.
2. Open the deep link while logged in.
3. **Expected**: Guardian screen shows "Not authorized" error card with shield icon.

### T6 — Android back-stack check
1. Open the deep link while NOT logged in.
2. Sign in.
3. Observe: Guardian screen loads.
4. Press Android back button.
5. **Expected**: Back navigates to home screen or login screen, NOT to the guardian URL in history (token not exposed in nav bar). *(See S7 in threat report — deferred fix.)*

### T7 — iOS Universal Links (future)
> Not yet implemented. Current `dhara://` custom scheme is susceptible to scheme hijacking by another installed app. Future: migrate to `https://yourdomain.com/guardian/{token}` with `apple-app-site-association` file.

---

## Build Instructions

1. Deploy the app using the **Publish** button (top-right in Emergent).
2. After deployment, navigate to the build panel and generate:
   - **Android APK/AAB** for Android testing.
   - **iOS IPA** (requires Apple Developer account) for TestFlight testing.
3. Install the build on the test device and run the steps above.
4. Expo Go QR code does NOT support custom URL schemes — these tests require a real build.
