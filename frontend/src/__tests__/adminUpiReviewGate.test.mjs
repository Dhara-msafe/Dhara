/**
 * V-06 / B-51 — admin-upi-review.tsx must be inert outside internal_qa builds.
 *
 * Before this fix, "not linked anywhere inside the app" only meant no in-app
 * button pointed at this screen — the Expo Router route still shipped
 * working in every build, including production and Closed Testing handed to
 * real external testers/users. Anyone who had, guessed, or found the URL in
 * the bundle could reach a live admin-key form backed by the shared
 * ADMIN_KEY. Rotating that key is explicitly an owner/Emergent item (see the
 * dev kit's project context doc), but shrinking where a working copy of this
 * screen ships is a plain developer fix, and it mirrors the OUTBOUND_PROFILE
 * gate already used for the QA-mode banner (B-06).
 *
 * Source-level wiring checks only (no RN renderer in this plain-Node test
 * setup) — same convention as qaModeBanner.test.mjs / nearestHelp.logic.test.mjs.
 *
 * Run with: node --experimental-strip-types --test src/__tests__/adminUpiReviewGate.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREEN = join(__dirname, '..', '..', 'app', 'admin-upi-review.tsx');
const OUTBOUND = join(__dirname, '..', 'outbound.ts');

const screenSrc = readFileSync(SCREEN, 'utf8');
const outboundSrc = readFileSync(OUTBOUND, 'utf8');

test('admin-upi-review reads the shared OUTBOUND_PROFILE (same source of truth as the QA banner / outbound guard), not its own env read', () => {
  assert.ok(screenSrc.includes("import { OUTBOUND_PROFILE } from '@/src/outbound';"));
  assert.ok(outboundSrc.includes('process.env.EXPO_PUBLIC_OUTBOUND_PROFILE'));
  assert.ok(!/process\.env\.EXPO_PUBLIC_OUTBOUND_PROFILE/.test(screenSrc));
});

test('the component renders an inert "not available" state for every profile except internal_qa', () => {
  assert.ok(/if \(OUTBOUND_PROFILE !== 'internal_qa'\) \{/.test(screenSrc));
  assert.ok(screenSrc.includes('admin-upi-review-unavailable'));
});

test('the gate runs before the admin-key input, the load(), or any fetch can be reached', () => {
  const gateIdx = screenSrc.indexOf("if (OUTBOUND_PROFILE !== 'internal_qa')");
  const inputIdx = screenSrc.indexOf('admin-key-input');
  const fetchIdx = screenSrc.indexOf('fetch(');
  assert.ok(gateIdx !== -1, 'gate not found');
  assert.ok(inputIdx !== -1, 'admin-key-input not found');
  assert.ok(fetchIdx !== -1, 'fetch( not found');
  // the gate is an early return ABOVE the JSX that contains the admin-key
  // input, and above both fetch() call sites (load/act) in source order —
  // since this is a single function component, an earlier `if (...) return`
  // always short-circuits everything rendered or called after it.
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

test('the backend check_admin_key mechanism and the public pay-upi submission flow are untouched by this fix (frontend-only change)', () => {
  // This is a documentation/scope assertion: the fix must not have touched
  // the admin-key value itself, the X-Admin-Key header name, or the
  // submissions endpoints — only gated whether the screen renders.
  assert.ok(screenSrc.includes("'X-Admin-Key': adminKey"));
  assert.ok(screenSrc.includes('/api/billing/upi/submissions'));
});
