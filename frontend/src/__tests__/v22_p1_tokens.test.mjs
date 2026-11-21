/**
 * v2.2 rollout — phase 1 (tokens only).
 *
 * The v2.2 design package (memory/dhara_redesign/handoff/design-tokens.json)
 * defines tokens the app theme lacked: darker gold text colours, consent
 * state fg/bg pairs, focus ring, extra surfaces, cardLg radius, the 48px
 * touch-target minimum and the package breakpoints. Phase 1 adds them to
 * src/theme.ts ADDITIVELY: no existing value may change, and no screen
 * consumes the new tokens yet, so the app renders identically.
 *
 * Source-level tests (no React, no native modules) following the
 * qaModeBanner.test.mjs convention.
 *
 * Run with: node --test src/__tests__/v22_p1_tokens.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const themeSrc = readFileSync(join(here, '..', 'theme.ts'), 'utf8');
const tokens = JSON.parse(
  readFileSync(
    join(here, '..', '..', '..', 'memory', 'dhara_redesign', 'handoff', 'design-tokens.json'),
    'utf8',
  ),
);

test('new colour tokens match the v2.2 package exactly', () => {
  const expect = {
    goldText: tokens.color.goldText,             // #8A6A1E
    goldTextStrong: tokens.color.goldTextStrong, // #6B4F10
    sand: tokens.color.sand,                     // #F1ECDD
    greenBg: tokens.color.greenBg,               // #F1F8F4
    redBg: tokens.color.redBg,                   // #FDF0EE
    redDeep: tokens.color.redDeep,               // #7F1D1D
    focusRing: tokens.semantic.focusRing,        // #14365A
    disabledBg: tokens.semantic.disabledBg,      // #E3DDCD
    disabledFg: tokens.semantic.disabledFg,      // #505B68
  };
  for (const [key, value] of Object.entries(expect)) {
    assert.match(
      themeSrc,
      new RegExp(`${key}: '${value}'`),
      `theme.ts must define ${key}: '${value}' (from design-tokens.json)`,
    );
  }
});

test('consent-state fg/bg pairs match the package "semantic" block', () => {
  for (const state of ['agreed', 'notGiven', 'withdrawn', 'pending', 'error']) {
    const { fg, bg } = tokens.semantic[state];
    assert.match(
      themeSrc,
      new RegExp(`${state}: \\{ fg: '${fg}', bg: '${bg}' \\}`),
      `theme.consentState.${state} must be { fg: '${fg}', bg: '${bg}' }`,
    );
  }
});

test('layout tokens: cardLg radius, 48px touch target, breakpoints', () => {
  assert.match(themeSrc, /cardLg: 16/, 'radius.cardLg must be 16');
  assert.match(themeSrc, /touchTarget: \{ min: 48 \}/, 'touchTarget.min must be 48');
  assert.match(
    themeSrc,
    /breakpoints: \{ phone: 0, tablet: 768, desktop: 1100 \}/,
    'breakpoints must match the package',
  );
  assert.equal(tokens.touchTarget.min, 48);
  assert.equal(tokens.breakpoints.tablet, 768);
  assert.equal(tokens.breakpoints.desktop, 1100);
});

test('phase 1 is additive: pre-existing values are unchanged', () => {
  // Spot-check the values every screen already depends on. If any of these
  // fail, phase 1 stopped being presentation-neutral.
  const unchanged = [
    "navy: '#14365A'",
    "deepNavy: '#0E2740'",
    "gold: '#D3B675'",
    "darkGold: '#7A5B17'",
    "cream: '#FBF7EE'",
    "ink: '#17212B'",
    "muted: '#505B68'",
    "lines: '#E7DFCC'",
    "emergencyRed: '#B42318'",
    "success: '#1F6B4A'",
    'spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 }',
    'sm: 8, md: 14, lg: 20, xl: 28, pill: 999', // radius (cardLg appended after)
  ];
  for (const snippet of unchanged) {
    assert.ok(themeSrc.includes(snippet), `theme.ts must still contain: ${snippet}`);
  }
});

test('no screen consumes the new tokens yet (phase 1 renders nothing differently)', () => {
  // The new tokens become live in later phases, each behind its own
  // EXPO_PUBLIC_UI_V22_P* flag. In phase 1 nothing outside theme.ts and
  // this test may reference them.
  const hits = execSync(
    `grep -rlE "goldTextStrong|consentState|touchTarget" app src --include=*.tsx --include=*.ts | grep -v __tests__ | grep -v src/theme.ts || true`,
    { cwd: join(here, '..', '..'), encoding: 'utf8', shell: '/bin/bash' },
  ).trim();
  assert.equal(hits, '', `new tokens must not be consumed in phase 1, found in: ${hits}`);
});
