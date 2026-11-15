/**
 * B-59 — admin-issues.tsx must be inert outside internal_qa builds.
 *
 * Before this fix, "not linked anywhere inside the app" only meant no in-app
 * button pointed at this screen — the Expo Router route still shipped
 * working in every build, including production and Closed Testing handed to
 * real external testers/users. Anyone who had, guessed, or found the URL in
 * the bundle could reach a live admin-key form backed by the shared
 * ADMIN_KEY (same root issue as B-41/B-51 on admin-upi-review.tsx; per the
 * project context doc, "B-41, B-51 and B-59 all add surface to that key").
 * Rotating that key is an owner/Emergent item, but shrinking where a working
 * copy of this screen ships is a plain developer fix — mirrors the
 * OUTBOUND_PROFILE gate already applied to admin-upi-review.tsx.
 *
 * Source-level wiring checks only (no RN renderer in this plain-Node test
 * setup) — same convention as adminUpiReviewGate.test.mjs.
 *
 * Run with: node --experimental-strip-types --test src/__tests__/adminIssuesGate.test.mjs
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

test('admin-issues reads the shared OUTBOUND_PROFILE (same source of truth as admin-upi-review / the QA banner), not its own env read', () => {
  assert.ok(screenSrc.includes("import { OUTBOUND_PROFILE } from '@/src/outbound';"));
  assert.ok(outboundSrc.includes('process.env.EXPO_PUBLIC_OUTBOUND_PROFILE'));
  assert.ok(!/process\.env\.EXPO_PUBLIC_OUTBOUND_PROFILE/.test(screenSrc));
});

test('the component renders an inert "not available" state for every profile except internal_qa', () => {
  assert.ok(/if \(OUTBOUND_PROFILE !== 'internal_qa'\) \{/.test(screenSrc));
  assert.ok(screenSrc.includes('admin-issues-unavailable'));
});

test('the gate runs before the web-only check, the admin-key input, load(), or any fetch can be reached', () => {
  const gateIdx = screenSrc.indexOf("if (OUTBOUND_PROFILE !== 'internal_qa')");
  const platformIdx = screenSrc.indexOf("if (Platform.OS !== 'web')");
  const inputIdx = screenSrc.indexOf('admin-key-input');
  const fetchIdx = screenSrc.indexOf('fetch(');
  assert.ok(gateIdx !== -1, 'gate not found');
  assert.ok(platformIdx !== -1, 'platform check not found');
  assert.ok(inputIdx !== -1, 'admin-key-input not found');
  assert.ok(fetchIdx !== -1, 'fetch( not found');
  assert.ok(gateIdx < platformIdx, 'OUTBOUND_PROFILE gate must come before the web-only check');
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

test('the backend check_admin_key mechanism and the public /api/issues submission endpoint (in-app issue reporter) are untouched by this fix (frontend-only change)', () => {
  assert.ok(screenSrc.includes("'X-Admin-Key': key"));
  assert.ok(screenSrc.includes('/api/issues'));
});
