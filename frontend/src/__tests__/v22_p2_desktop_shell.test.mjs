/**
 * v2.2 rollout — phase 2 (calm desktop frame on safety/onboarding routes).
 *
 * The v2.2 responsive reference says: no promo rail on onboarding, consent,
 * recording or emergency screens, and one emergency entry instead of three.
 * Phase 2 gates that behind EXPO_PUBLIC_UI_V22_P2 (default OFF) in
 * DesktopFrame.tsx: on calm routes the right rail ("Start your first case",
 * "Get the app") and the top-bar SOS chip are hidden, the sidebar
 * "SOS · Emergency" stays as the single emergency entry, and /emergency
 * itself shows no extra entry at all.
 *
 * Source-level tests (no React renderer in this plain-Node setup), same
 * convention as qaModeBanner.test.mjs. On-device/desktop visual checks
 * belong to the phase 2 web test pass (T15 at 390/768/1280).
 *
 * Run with: node --test src/__tests__/v22_p2_desktop_shell.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const frameSrc = readFileSync(
  join(here, '..', 'components', 'dhara', 'DesktopFrame.tsx'),
  'utf8',
);
const layoutSrc = readFileSync(join(here, '..', '..', 'app', '_layout.tsx'), 'utf8');

test('flag defaults OFF: only the exact string "true" enables phase 2', () => {
  assert.match(
    frameSrc,
    /export const UI_V22_P2 = process\.env\.EXPO_PUBLIC_UI_V22_P2 === 'true';/,
    'UI_V22_P2 must be false when the env var is unset or anything but "true"',
  );
  // calm must require the flag, so flag OFF reproduces the old frame exactly.
  assert.match(frameSrc, /const calm = UI_V22_P2 && isCalmRoute\(pathname\);/);
});

test('calm routes cover the safety + onboarding screens and only them', () => {
  for (const r of ['/language', '/how-it-helps', '/state', '/emergency', '/women-shield', '/women', '/family-journey', '/guardian']) {
    assert.ok(frameSrc.includes(`'${r}',`), `CALM_ROUTES must include ${r}`);
  }
  // Frameless screens (B-65) must NOT be re-listed here: they never render
  // inside DesktopFrame, and listing them would suggest otherwise.
  for (const r of ['/consent', '/login', '/signup', '/forgot-password', '/delete-account']) {
    assert.ok(!frameSrc.includes(`'${r}',`), `${r} is standalone (B-65) and must not be in CALM_ROUTES`);
    assert.ok(layoutSrc.includes(`'${r}'`), `${r} must still be in STANDALONE_ROUTES in app/_layout.tsx`);
  }
  // Prefix matching, so /women/head-out/* and /family-journey/* are covered.
  assert.match(frameSrc, /pathname === r \|\| pathname\.startsWith\(`\$\{r\}\/`\)/);
});

test('right rail is gated: hidden on calm routes, untouched otherwise', () => {
  assert.match(frameSrc, /\{calm \|\| hideHomeRail \? null : \(\s*\n\s*<ScrollView style=\{styles\.rail\}/);
  // The rail content itself is unchanged (rollback = flag off).
  assert.ok(frameSrc.includes('Start your first case'));
  assert.ok(frameSrc.includes('Get the app'));
});

test('one emergency entry on calm routes; none pointing at /emergency from itself', () => {
  // Top chip: hidden on calm routes (sidebar entry remains).
  assert.match(frameSrc, /\{!isHome && !calm && \(\s*\n\s*<Pressable[^\n]*style=\{styles\.sosTop\}/);
  // Sidebar entry: hidden only when calm AND already on /emergency.
  assert.match(frameSrc, /\{\(!isHome \|\| sidebarSosOnHome\) && !\(calm && onEmergencyScreen\) && \(/);
  assert.match(frameSrc, /pathname === '\/emergency' \|\| pathname\.startsWith\('\/emergency\/'\)/);
});

test('no behaviour change: navigation targets and safety logic untouched', () => {
  // The SOS entries still push /emergency; nothing routes elsewhere.
  const pushes = frameSrc.match(/router\.push\('\/emergency'\)/g) || [];
  assert.equal(pushes.length, 2, 'both SOS entries must still target /emergency');
  // No timer, storage or API call was introduced.
  for (const banned of ['setTimeout', 'setInterval', 'AsyncStorage', 'fetch(']) {
    assert.ok(!frameSrc.includes(banned), `DesktopFrame must not gain ${banned}`);
  }
});
