/**
 * B-59 / N-03 — admin-issues.tsx must be inert outside internal_qa builds.
 *
 * Before this fix, "not linked anywhere inside the app" only meant no in-app
 * button pointed at this screen — the Expo Router route still shipped
 * working in every build, including production and Closed Testing handed to
 * real external testers/users, and asked whoever landed on it for the admin
 * key. Anyone who had, guessed, or found the URL in the bundle could reach a
 * live admin-key form backed by the shared ADMIN_KEY. This is the exact
 * extra-surface problem already fixed for admin-upi-review.tsx under
 * V-06/B-51 (see adminUpiReviewGate.test.mjs) — same build flag, same gate
 * shape, applied here too.
 *
 * The backend side of this bug (the server must check admin role on /issues
 * and /admin APIs, not just a client-side gate) was already correct before
 * this fix: backend/api/issues_router.py's list_reports, set_status and
 * list_error_events all call dependencies.check_admin_key(x_admin_key),
 * which does a constant-time compare against the server-side ADMIN_KEY
 * secret and raises 503 if unconfigured / 401 if wrong or missing,
 * independent of anything the client sends or renders. This fix only
 * shrinks where a *working copy of the screen* ships, so a build outside
 * internal_qa has no form to type a leaked/guessed key into in the first
 * place.
 *
 * Source-level wiring checks only (no RN renderer in this plain-Node test
 * setup) — same convention as adminUpiReviewGate.test.mjs / qaModeBanner.test.mjs.
 *
 * Run with: node --experimental-strip-types --test src/__tests__/b59_n03_admin_issues_gate.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREEN = join(__dirname, '..', '..', 'app', 'admin-issues.tsx');
const OUTBOUND = join(__dirname, '..', 'outbound.ts');

const screenSrc = readFileSync(SCREEN, 'utf8');
const outboundSrc = readFileSync(OUTBOUND, 'utf8');

test('admin-issues reads the shared OUTBOUND_PROFILE (same source of truth as the QA banner / admin-upi gate), not its own env read', () => {
  assert.ok(screenSrc.includes("import { OUTBOUND_PROFILE } from '@/src/outbound';"));
  assert.ok(outboundSrc.includes('process.env.EXPO_PUBLIC_OUTBOUND_PROFILE'));
  assert.ok(!/process\.env\.EXPO_PUBLIC_OUTBOUND_PROFILE/.test(screenSrc));
});

test('the component renders an inert "not available" state for every profile except internal_qa', () => {
  assert.ok(/if \(OUTBOUND_PROFILE !== 'internal_qa'\) \{/.test(screenSrc));
  assert.ok(screenSrc.includes('admin-issues-unavailable'));
});

test('the gate runs before the admin-key input is ever rendered', () => {
  const gateIdx = screenSrc.indexOf("if (OUTBOUND_PROFILE !== 'internal_qa')");
  const inputIdx = screenSrc.indexOf('admin-key-input');
  assert.ok(gateIdx !== -1, 'gate not found');
  assert.ok(inputIdx !== -1, 'admin-key-input not found');
  // Single function component: an earlier `if (...) return` always
  // short-circuits everything rendered after it in source order. The
  // `load` callback (which contains the fetch) is defined above the gate,
  // same as every hook must be in this component — but it is only ever
  // invoked from the admin-key input's onPress/onSubmitEditing, and that
  // input itself sits below the gate, so the gate placement here is what
  // actually matters, not the textual position of the fetch call.
  assert.ok(gateIdx < inputIdx, 'gate must appear before the admin-key input in source order');
});

test('the inert state mounts no admin-key TextInput and makes no network call', () => {
  const gateBlockMatch = screenSrc.match(
    /if \(OUTBOUND_PROFILE !== 'internal_qa'\) \{[\s\S]*?\n  \}/
  );
  assert.ok(gateBlockMatch, 'could not isolate the gate block');
  const gateBlock = gateBlockMatch[0];
  assert.ok(!gateBlock.includes('TextInput'));
  assert.ok(!gateBlock.includes('fetch('));
  assert.ok(!gateBlock.includes('adminKey'));
});

test('the gate appears before the Platform.OS web-only check (both are early returns; profile gate must win first)', () => {
  const gateIdx = screenSrc.indexOf("if (OUTBOUND_PROFILE !== 'internal_qa')");
  const platformIdx = screenSrc.indexOf("if (Platform.OS !== 'web')");
  assert.ok(gateIdx !== -1 && platformIdx !== -1);
  assert.ok(gateIdx < platformIdx, 'profile gate must run before the platform check');
});

test('the backend admin-key check and the reports/error-events endpoints are untouched by this fix (frontend-only change)', () => {
  // Documentation/scope assertion: this fix must not have touched the
  // admin-key value itself, the X-Admin-Key header name, or the endpoints.
  assert.ok(screenSrc.includes("'X-Admin-Key': key"));
  assert.ok(screenSrc.includes('/api/issues'));
  assert.ok(screenSrc.includes('/api/admin/error-events'));
});

test('backend: every admin-only route in issues_router.py calls check_admin_key independent of any client gate', () => {
  const ROUTER = join(__dirname, '..', '..', '..', 'backend', 'api', 'issues_router.py');
  const routerSrc = readFileSync(ROUTER, 'utf8');
  assert.ok(routerSrc.includes('from dependencies import db, current_user, check_admin_key'));
  // list_reports (GET /issues), set_status (PATCH /issues/{id}),
  // list_error_events (GET /admin/error-events) must each gate on the key.
  const occurrences = (routerSrc.match(/check_admin_key\(x_admin_key\)/g) || []).length;
  assert.strictEqual(occurrences, 3, 'expected check_admin_key(x_admin_key) on all 3 admin routes');
});
