# Debug Log Dashboard

Dhara's backend captures every API request and response in full — including scrubbed request and
response bodies and Python stack traces — and streams them to a password-protected web page you
open on any laptop or desktop browser. The page auto-refreshes every three seconds so you can
watch exactly what is happening in production or preview while you reproduce a bug.

## Who it is for

Developers and admins debugging live issues: tracing why a specific user action fails, confirming
what the backend actually received and returned, and reading the exact Python exception without
needing SSH or server access.

## Core features and experience

**Full-detail capture**
A single FastAPI middleware layer intercepts every request before it reaches any route and every
response before it leaves. It records: ISO timestamp, user identity (id + email, or "anonymous"),
HTTP method, full path with query string, HTTP status code, duration in milliseconds, the
request body as JSON (scrubbed), the response body as JSON (scrubbed), and — for any 5xx error —
the complete Python stack trace.

A scrubber runs before anything is stored. It recursively walks the body dictionaries and blanks
out any key whose name contains: `password`, `token`, `secret`, `key`, `authorization`,
`aadhaar`, `otp`, `pin`, `hash`. The value is replaced with `[redacted]`; the key name is kept
so the structure is still readable. The Authorization request header value is always dropped.

Logs are written to a MongoDB collection named `debug_logs` with a TTL index set to 7 days.
Automatic deletion requires no cron job.

**Web dashboard — live feed**
Opening `https://<your-app-url>/api/admin/logs?key=<ADMIN_KEY>` in a browser shows the
dashboard. No login screen — the key in the URL is the gate. The page is pure HTML and
JavaScript served directly by FastAPI; no extra server or build step is needed.

The dashboard has three views selectable by tab:

| Tab | What it shows |
|---|---|
| **Live feed** | Last 200 requests, newest first, auto-refreshing every 3 seconds |
| **User drill-down** | Type a user email or id; shows only that user's requests in sequence |
| **Errors** | Only 4xx and 5xx responses, with the stack trace pre-expanded |

Each row shows: time, user, method + path, status badge (green/amber/red), duration. Clicking a
row expands it to show the full scrubbed request body, response body, and stack trace (if any)
formatted as pretty-printed JSON.

**Filters (all tabs)**
- Date/time range (from / to, defaults to last 2 hours)
- Status filter: All / 2xx / 4xx / 5xx
- Path prefix search (e.g. `/api/trusted-circle`)
- Free-text search across the error message field

**Export**
A Download CSV button on any tab exports the currently filtered rows as a CSV file (one row per
request; body columns are JSON-stringified). Stack traces are included in a final column.

## User flow

1. Developer opens a browser on their laptop and navigates to
   `https://<app-url>/api/admin/logs?key=<ADMIN_KEY>`.
2. The Live feed tab is active; new rows appear every 3 seconds at the top.
3. While a tester reproduces a bug on their phone, the developer watches the matching request
   appear, clicks it, and reads the exact error and stack trace.
4. Developer switches to User drill-down, enters the tester's email, and sees the full sequence
   of calls for that session to identify where the flow broke.
5. Optionally downloads CSV and pastes it into a bug report or shares with the team.

## UI/UX feel

Minimal developer-tool aesthetic — dark background (`#0f172a`), monospace font for bodies and
stack traces, colour-coded status badges (green 2xx, amber 4xx, red 5xx). No branding, no
illustrations — it is a tool, not a product screen. Rows highlight on hover. Expanded bodies
use syntax-highlighted JSON (via a lightweight inline library, no external CDN dependency).
Auto-refresh can be paused with a toggle so the table stops moving while you read a row.

## Implementation phases

**Phase 1 — MVP (built now)**
- `middleware/request_logger.py`: async FastAPI middleware; captures req/res; calls scrubber;
  writes to `debug_logs`; never raises (logging must not break requests).
- `services/log_scrubber.py`: recursive key-based scrubber; list of banned key substrings is
  configurable via an environment variable so new sensitive fields can be added without a deploy.
- `api/debug_log_router.py`: one route serving the HTML dashboard page; one JSON data route
  the dashboard polls; one CSV export route. All three require `?key=` matching `ADMIN_KEY`.
- MongoDB `debug_logs` collection + TTL index (7 days) created on first startup.
- Dashboard HTML/JS: three tabs, filters, auto-refresh with pause toggle, row expand, CSV export.
- Registered in `server.py`; zero changes to any existing route.

**Phase 2 — enhancements**
- Server-Sent Events (SSE) feed replaces polling so new rows push instantly to the browser.
- Session replay: group calls within a 30-minute window into a named session and step through
  them one by one.
- Anomaly highlight: any request taking over 2 000 ms is flagged with an orange clock icon.
- Configurable redaction list editable from the dashboard itself (saved to DB).

**Phase 3 — future**
- Correlation IDs: a `X-Request-Id` header is generated per request and returned in the
  response so the mobile app can log the same ID and the two traces can be joined.
- Frontend event log: the app sends screen-view and button-tap events to `/api/events` and
  they appear interleaved with the backend calls in the User drill-down view.
- Alert on sustained error rate: email or Slack message if error rate exceeds a threshold
  over a rolling 5-minute window.

## Assumptions

- The dashboard is served by the existing FastAPI backend on the same domain; no new server
  or hosting is needed.
- `ADMIN_KEY` already exists in the backend environment; the dashboard reuses it. If it is not
  set, the route returns 503 to avoid accidentally exposing logs with no protection.
- Request and response bodies are stored after scrubbing. This means non-sensitive user content
  such as destination names, rights-card queries, and FIR draft text WILL appear in the logs.
  This is intentional for debugging; treat the dashboard URL as a secret.
- The scrubber is best-effort on body size: bodies larger than 50 KB are truncated before
  storage to keep the collection size manageable.
- The dashboard page is self-contained HTML + inline JavaScript; no React, no npm, no build
  step, no external CDN. It loads instantly even on a slow connection.
- Auto-refresh polls every 3 seconds; this adds negligible load to the backend at normal traffic
  volumes.
- Retention is fixed at 7 days via TTL index; changing it requires an index rebuild which takes
  a few seconds on a small collection.
