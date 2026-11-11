/**
 * B-06 — QA MODE banner wiring tests (no React, no native modules).
 *
 * Before this fix, "QA mode" text only ever appeared reactively, inside an
 * Alert fired by outbound.ts's showSimulated() at the moment a tester
 * actually triggered a simulated dial/SMS/share — there was no persistent,
 * always-visible on-screen indicator that a build is internal_qa (simulated
 * outbound actions) rather than a real build. See D-01 in the dev kit:
 * "Internal QA builds simulate emergency calls (QA MODE banner, -qa version
 * name, build check, release preflight)" — the banner half of that was
 * missing.
 *
 * These tests check the wiring at the source level (the component exists,
 * gates correctly on OUTBOUND_PROFILE, and is actually mounted at the app
 * root) rather than rendering React Native, since there's no RN renderer in
 * this plain-Node test setup (see nearestHelp.logic.test.mjs for the same
 * convention). Actual on-device visual verification belongs on QA/phone.
 *
 * Run with: node --experimental-strip-types src/__tests__/qaModeBanner.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BANNER = join(__dirname, '..', 'components', 'dhara', 'QaModeBanner.tsx');
const LAYOUT = join(__dirname, '..', '..', 'app', '_layout.tsx');
const OUTBOUND = join(__dirname, '..', 'outbound.ts');

const bannerSrc = readFileSync(BANNER, 'utf8');
const layoutSrc = readFileSync(LAYOUT, 'utf8');
const outboundSrc = readFileSync(OUTBOUND, 'utf8');

test('QaModeBanner only renders for the internal_qa profile, never silently for anything else', () => {
  assert.ok(/if \(OUTBOUND_PROFILE !== 'internal_qa'\) return null;/.test(bannerSrc));
});

test('QaModeBanner reads the shared OUTBOUND_PROFILE (same source of truth as the dialler/SMS/share guard), not its own env read', () => {
  assert.ok(bannerSrc.includes("import { OUTBOUND_PROFILE } from '@/src/outbound';"));
  // outbound.ts must still be the one place that resolves the raw env var —
  // the banner must never read process.env itself (a second, possibly
  // drifting, source of truth for the same decision).
  assert.ok(outboundSrc.includes("process.env.EXPO_PUBLIC_OUTBOUND_PROFILE"));
  assert.ok(!/process\.env\.EXPO_PUBLIC_OUTBOUND_PROFILE/.test(bannerSrc));
});

test('the banner text says QA MODE and explains what is simulated', () => {
  assert.ok(/QA MODE/.test(bannerSrc));
  assert.ok(/simulated/i.test(bannerSrc));
});

test('the banner is not dismissible (no onDismiss/close affordance) — it must not be possible to hide it for the rest of the session', () => {
  assert.ok(!/onDismiss|onPress|Pressable/.test(bannerSrc));
});

test('QaModeBanner is actually mounted once at the app root, covering every screen (both the wide-web and mobile render paths share this mount point)', () => {
  assert.ok(layoutSrc.includes('import { QaModeBanner } from "@/src/components/dhara/QaModeBanner";'));
  assert.ok(/<QaModeBanner\s*\/>/.test(layoutSrc));
});
