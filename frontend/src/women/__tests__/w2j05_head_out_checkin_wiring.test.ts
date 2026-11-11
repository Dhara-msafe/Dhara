/**
 * W2-J05 — Head Out safety check-in (Day 4 QA journey). Register's own
 * "how" column: "Manual on QA + phone (GPS)" -- a real-device journey (GPS
 * can't be faked meaningfully from this sandbox), so this file does the
 * same lighter-weight wiring pass this session used for NF-04: confirm
 * every network call Head Out's screens make is correctly authenticated,
 * since that's exactly the class of bug NF-04 found elsewhere
 * (evidenceBackup.ts's missing Authorization header).
 *
 * RESULT: no bug found here. Every citizen-facing route in
 * api/journey_router.py (POST /journey/status, and every
 * /journey/status/{token}/* action -- safe, revoke, missed-checkin,
 * heartbeat, help, location, extend, destination, route-deviation) requires
 * current_user server-side, and every corresponding fetch() call in
 * app/women/head-out.tsx, app/women/head-out/destination.tsx,
 * src/hooks/useJourneyGPS.ts and src/hooks/useLocationUpload.ts already
 * sends `Authorization: Bearer ${authToken}`. The two routes that
 * intentionally send NO auth header -- GET /api/geocode/search (OSM
 * fallback, api/geocode_router.py has no current_user dependency) in both
 * destination.tsx and src/women/DestinationPicker.tsx -- are correctly
 * unauthenticated to match: the backend route itself has no current_user
 * dependency (free OSM lookup, same public-endpoint category as W4-J01's
 * cross-reference route and women_router.py's flags/helplines/route).
 *
 * This file is a source-level/regex guard (same tradeoff as NF-04's test,
 * for the same reason: these screens import AsyncStorage / expo-location /
 * expo-crypto transitively, which this sandbox's plain Node ESM resolver
 * does not reliably follow for every subpath). Run via node:test:
 *   node --experimental-strip-types \
 *     --import ./src/voice/core/__tests__/ts-resolve.mjs \
 *     --test src/women/__tests__/w2j05_head_out_checkin_wiring.test.ts
 *
 * Existing backend coverage (tests/test_go1b_gps_journey.py and the
 * guardian-access/link-revocation suites) already exercises journey_router.py
 * itself at the HTTP level -- confirmed present, not re-duplicated here.
 * Like test_safety_go1a.py (checked during the XC-SEC addendum), those
 * tests hit a live backend directly and fail with connection-refused in
 * this sandbox (no live server) -- a pre-existing, unrelated sandbox
 * constraint, not something this pass introduced or needs to fix.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const FRONTEND_DIR = path.resolve(import.meta.dirname, '..', '..', '..');

function read(relPath: string): string {
  return fs.readFileSync(path.join(FRONTEND_DIR, relPath), 'utf-8');
}

/** Every `fetch(...)` call in a file, as its full call-expression text
 * (balances parens so a multi-line call with its own nested braces/parens
 * is captured whole, not cut off at the first inner `)`). */
function extractFetchCalls(src: string): string[] {
  const calls: string[] = [];
  const startRe = /fetch\(/g;
  let m: RegExpExecArray | null;
  while ((m = startRe.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = m.index;
    while (depth > 0 && i < src.length) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
      i++;
    }
    calls.push(src.slice(start, i));
  }
  return calls;
}

const PUBLIC_ENDPOINT_MARKERS = ['/api/geocode/search']; // no current_user dependency server-side

function fetchCallsRequiringAuth(src: string): string[] {
  return extractFetchCalls(src).filter(
    call => !PUBLIC_ENDPOINT_MARKERS.some(marker => call.includes(marker)),
  );
}

test('W2-J05: every head-out.tsx network call except the public OSM geocode fallback sends Authorization', () => {
  const src = read('app/women/head-out.tsx');
  const authRequired = fetchCallsRequiringAuth(src);
  assert.ok(authRequired.length >= 8, `expected at least 8 auth-required fetch() calls in head-out.tsx, found ${authRequired.length}`);
  for (const call of authRequired) {
    assert.match(
      call,
      /Authorization: `Bearer \$\{authToken\}`/,
      `head-out.tsx fetch() call is missing its Authorization header:\n${call.slice(0, 200)}`,
    );
  }
});

test('W2-J05: every destination.tsx network call except the public OSM geocode fallback sends Authorization', () => {
  const src = read('app/women/head-out/destination.tsx');
  const allCalls = extractFetchCalls(src);
  assert.equal(allCalls.length, 4, `expected exactly 4 fetch() calls in destination.tsx, found ${allCalls.length}`);

  const publicCalls = allCalls.filter(c => c.includes('/api/geocode/search'));
  assert.equal(publicCalls.length, 1, 'expected exactly 1 public geocode/search call');

  const authRequired = fetchCallsRequiringAuth(src);
  assert.equal(authRequired.length, 3);
  for (const call of authRequired) {
    // destination.tsx uses two different local variable names for the same
    // auth token depending on the function (`authToken` in the module-level
    // Places helpers, `token` in fetchSavedPlaces) -- both are real, correct
    // uses of useAuth()'s token, just named differently per call site.
    assert.match(
      call,
      /Authorization: `Bearer \$\{(authToken|token)\}`/,
      `destination.tsx fetch() call is missing its Authorization header:\n${call.slice(0, 200)}`,
    );
  }
});

test('W2-J05: useJourneyGPS and useLocationUpload both send Authorization on their location-update call', () => {
  for (const relPath of ['src/hooks/useJourneyGPS.ts', 'src/hooks/useLocationUpload.ts']) {
    const src = read(relPath);
    const calls = extractFetchCalls(src).filter(c => c.includes('/location'));
    assert.ok(calls.length >= 1, `${relPath}: expected at least one /location fetch() call`);
    for (const call of calls) {
      assert.match(
        call,
        /Authorization: `Bearer \$\{authToken\}`/,
        `${relPath}: /location fetch() call is missing its Authorization header`,
      );
    }
  }
});

test('W2-J05: the backend route behind the one unauthenticated call (geocode/search) really has no current_user dependency', () => {
  const backendDir = path.resolve(FRONTEND_DIR, '..', 'backend');
  const src = fs.readFileSync(path.join(backendDir, 'api', 'geocode_router.py'), 'utf-8');
  const m = src.match(/@router\.get\("\/geocode\/search"[^)]*\)\s*\nasync def geocode_search\(([^)]*)\)/);
  assert.ok(m, 'geocode_search route not found in api/geocode_router.py');
  assert.doesNotMatch(
    m![1],
    /current_user/,
    'geocode_search unexpectedly requires current_user server-side -- the frontend\'s unauthenticated call would then 401',
  );
});

test('W2-J05: every other citizen journey route in journey_router.py requires current_user (confirms the frontend is right to always authenticate them)', () => {
  const backendDir = path.resolve(FRONTEND_DIR, '..', 'backend');
  const src = fs.readFileSync(path.join(backendDir, 'api', 'journey_router.py'), 'utf-8');
  // Every @router.<method>("/journey...") async def except the public HTML
  // status page (journey_status_page, explicitly unauthenticated by design
  // -- it's the link a Trusted Circle recipient opens, not the citizen's
  // own session) must declare current_user.
  const routeRe = /@router\.(get|post|patch|delete)\("(\/journey[^"]*)"[^)]*\)\s*\nasync def (\w+)\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  let checked = 0;
  while ((m = routeRe.exec(src))) {
    const [, , routePath, funcName, params] = m;
    if (funcName === 'journey_status_page') continue; // intentionally public
    checked++;
    assert.match(
      params,
      /current_user/,
      `${routePath} (${funcName}) does not declare current_user -- a citizen journey route must require auth`,
    );
  }
  assert.ok(checked >= 10, `expected to check at least 10 journey_router.py routes, checked ${checked}`);
});
