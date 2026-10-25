# Guardian Token URL Exposure — Threat Report

**Date:** 2026-06-XX  
**Scope:** `dhara://guardian/{token}` deep-link, `GET /api/journey/status/{token}` HTML page, `GET /api/journey/{token}/guardian` JSON API.  
**Author:** Security audit — guardian token URL exposure batch.

---

## Executive Summary

The 10-character cryptographically random guardian token is a capability token: possession grants read access (Gate A + B) to a traveller's journey record. Any surface that stores, transmits, or logs the full URL path therefore carries the token. This report enumerates all identified surfaces, rates each risk, and records the hardening applied.

---

## Surface-by-Surface Analysis

### S1 — Nginx access log (`/var/log/nginx/access.log`)

| Attribute | Value |
|---|---|
| **URL logged?** | Yes — default combined log format includes the full request line: `GET /api/journey/status/ABCDE12345 HTTP/1.1` |
| **Risk** | **MEDIUM** |
| **Who can see it** | Server operator / log-aggregation pipeline only. Not accessible to users or network observers. |
| **Attack scenario** | A compromised log-aggregation system or rogue operator could harvest valid tokens from logs. Token entropy (10-char alphanumeric, ~59 bits) makes brute force infeasible; log harvest is the realistic vector. |
| **Hardening applied** | None — nginx access log format not changed (would require a redeploy and could break ops tooling). Accepted risk: server-side logs are an operator concern, not a user-facing surface. |
| **Recommended future action** | Apply a custom nginx `log_format` that replaces the token path segment with `[REDACTED]` for the two guardian routes. Example: `map $request_uri $guardian_clean { "~^GET /api/journey/[^/]+/guardian" "GET /api/journey/[REDACTED]/guardian"; }` |

---

### S2 — Uvicorn / backend access log (`/var/log/supervisor/backend.out.log`)

| Attribute | Value |
|---|---|
| **URL logged?** | Yes — uvicorn running with `--reload` logs every request at INFO level, including full path. |
| **Risk** | **MEDIUM** |
| **Who can see it** | Server operator via supervisor stdout log file. |
| **Attack scenario** | Same as S1. |
| **Hardening applied** | None — changing uvicorn log format requires supervisord config change and redeploy. Accepted risk: same operator-trust scope as nginx. |
| **Recommended future action** | Pass `--access-log-format` to uvicorn or configure a structlog filter that masks the guardian token path segment before writing. |

---

### S3 — Browser address bar (`GET /api/journey/status/{token}`)

| Attribute | Value |
|---|---|
| **URL visible?** | Yes — the HTML status page URL includes the token as a path segment in the browser address bar. |
| **Risk** | **LOW–MEDIUM** |
| **Who can see it** | The user viewing the page on their device. Shoulder-surfing risk; OS-level auto-complete (if the user types the URL) stores it in browser history. |
| **Attack scenario** | (a) Browser history sync — if the recipient uses a synced browser, the URL (token) could appear on other devices in that account. (b) Screenshot sharing — token visible in address bar. |
| **Hardening applied** | `Cache-Control: no-store, no-cache, max-age=0, must-revalidate` header added to the HTML response (S3-H1 below). This prevents the page from being stored in browser cache/history mechanism that some browsers use for auto-complete. |
| **Residual risk** | Browser URL bar is inherent to any GET-parameter URL. Fully eliminating it would require moving the token to POST body or a fragment identifier (`#`), which is out of scope for this batch. |

---

### S4 — HTTP Referrer header (navigation away from the status page)

| Attribute | Value |
|---|---|
| **Token leaked via Referrer?** | Potentially — when the browser navigates from `https://host/api/journey/status/TOKEN` to any third-party URL (e.g., clicking a link on the page), the browser would normally send `Referer: https://host/api/journey/status/TOKEN`. |
| **Risk** | **LOW** (mitigated) |
| **Pre-existing mitigation** | `<meta name="referrer" content="strict-origin"/>` was already present in the HTML, which restricts the Referer to origin-only. |
| **Additional hardening applied** | (1) Meta tag upgraded from `strict-origin` to `no-referrer` (S4-H1). (2) `Referrer-Policy: no-referrer` HTTP response header added (S4-H2). HTTP header takes precedence over meta tag when both are present. |
| **Post-hardening risk** | Negligible — no-referrer means zero path information is sent in Referer regardless of browser version. |

---

### S5 — Deep-link URL `dhara://guardian/{token}` (built in client JS)

| Attribute | Value |
|---|---|
| **Token in deep link?** | Yes — the JavaScript in `_private_html()` builds `dhara://guardian/{encodeURIComponent(tok)}` from `window.location.pathname`. |
| **Risk** | **LOW** |
| **Who can see it** | The OS app-open intent handler. Custom-scheme deep links are handled natively; they do not appear in browser history and are not transmitted to third parties. |
| **Attack scenario** | (a) Another app on the device registered the `dhara://` scheme — Android shows an app-chooser, token visible to the other app. (b) iOS URL-scheme hijacking (pre-Universal Links). |
| **Hardening applied** | None in this batch. The correct long-term mitigation is Universal Links (iOS) and Android App Links (HTTPS deep links), which bind the link to the verified app's domain and cannot be intercepted by another app. |
| **Recommended future action** | Migrate from `dhara://` custom scheme to `https://yourdomain.com/guardian/{token}` Universal / App Link with an `apple-app-site-association` / `assetlinks.json` file. |

---

### S6 — Frontend navigation state (React Navigation / Expo Router)

| Attribute | Value |
|---|---|
| **Token in nav state?** | Yes — the token is in the route path `app/guardian/[token].tsx`. React Navigation's in-memory history stack holds it. |
| **Risk** | **LOW** |
| **Who can see it** | No-one outside the app process. Navigation state is not persisted to disk by default in Expo Router. |
| **Hardening applied** | None needed. |

---

### S7 — Post-login navigation (token in nav history after login redirect)

| Attribute | Value |
|---|---|
| **Risk** | **LOW** |
| **Scenario** | Unauthenticated user opens deep link → pushed to login screen. After login, the guardian screen loads. If the router restores the full navigation stack, the token URL could be in the back-stack, accessible via system back button. |
| **Current behaviour** | `GuardianScreen` re-fetches using `useEffect` on `authToken` change. Login redirect via `router.push('/login')` preserves the current stack entry. The guardian route is still at `dhara://guardian/{token}` in the stack — this is inherent to Expo Router's link handling. |
| **Hardening applied** | None in this batch — full assessment deferred (requires device build). |
| **Recommended future action** | After login completes, use `router.replace('/guardian/{token}')` instead of pushing, so the login screen is removed from the back-stack. Also clear the guardian screen from stack after a `403`/`410` response to avoid stale token persistence. |

---

## Hardening Applied in This Batch

| ID | Location | Change |
|---|---|---|
| S3-H1 | `journey_router.py` → `journey_status_page()` | Added `Cache-Control: no-store, no-cache, max-age=0, must-revalidate` HTTP header to the HTML response |
| S4-H1 | `journey_router.py` → `_private_html()` | Upgraded `<meta name="referrer">` from `strict-origin` to `no-referrer` |
| S4-H2 | `journey_router.py` → `journey_status_page()` | Added `Referrer-Policy: no-referrer` HTTP response header |
| S4-H3 | `journey_router.py` → `journey_status_page()` | Added `X-Content-Type-Options: nosniff` HTTP header |
| S4-H4 | `journey_router.py` → `journey_status_page()` | Added `X-Frame-Options: DENY` HTTP header |

---

## Residual Risks (Accepted / Deferred)

| Risk | Disposition |
|---|---|
| Server-side access logs (S1, S2) contain token path segments | Accepted — operator-only access; recommended future: log-format masking |
| Browser address bar (S3) shows token | Accepted — inherent to GET URLs; mitigated by Cache-Control: no-store |
| Custom scheme deep-link interception (S5) | Deferred — requires Universal Links / App Links migration |
| Post-login back-stack token persistence (S7) | Deferred — requires real device build to assess and fix |

---

## Non-Issues Confirmed

- **Token NOT echoed in server-rendered HTML** — `_private_html()` contains no `{token}` interpolation; the JS reads the token from `window.location.pathname` at runtime only. The `test_r11_no_echo` test contract is preserved.
- **Token NOT present in any JSON API response body** — `GET /api/journey/{token}/guardian` returns journey metadata but not the token itself.
- **Token NOT in auth cookies or session storage** — auth uses Authorization: Bearer header, not cookies.
