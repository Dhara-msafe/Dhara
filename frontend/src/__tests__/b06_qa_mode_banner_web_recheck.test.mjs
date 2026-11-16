/**
 * B-06 (recheck) — "QA MODE banner may not render on web."
 *
 * This item asked for a recheck, not a reported-and-reproduced bug: "Check
 * Preview's OUTBOUND_PROFILE and whether QaModeBanner actually renders on
 * web builds (it was built and tested for native in this session's Day 2
 * work)."
 *
 * Findings from this recheck:
 *   1. QaModeBanner.tsx has no Platform.OS branch and no web-specific file
 *      variant (no QaModeBanner.web.tsx) -- it is the same component on
 *      every platform, mounted once at the app root in app/_layout.tsx
 *      BEFORE the isWideWeb/DesktopFrame vs. mobile-Stack split, so both
 *      render paths share the exact same mount point. The existing
 *      qaModeBanner.test.mjs already asserts this mount point and the
 *      OUTBOUND_PROFILE gate; those are unchanged by this recheck.
 *   2. No ancestor in the render tree sets `overflow: hidden` or its own
 *      `position`/`zIndex` that could clip or occlude an absolutely
 *      positioned, zIndex: 9999 child -- confirmed by reading
 *      DesktopFrame.tsx and app/_layout.tsx directly (no such styles on
 *      any ancestor of the banner's mount point).
 *   3. The one real gap found: EXPO_PUBLIC_OUTBOUND_PROFILE and
 *      EXPO_PUBLIC_OUTBOUND_MODE were entirely undocumented in
 *      .env.example, even though both src/outbound.ts (runtime gate) and
 *      app.config.js (build-time "-qa" version suffix) read them. The
 *      fallback when unset is already the SAFE direction (defaults to
 *      "internal_qa", i.e. the banner SHOWS by default) -- so this was not
 *      a behavior bug, but an operator setting up a Preview/staging
 *      deployment had no documented way to discover or explicitly pin
 *      this. Fixed by documenting both vars in .env.example with their
 *      default-safe behavior spelled out.
 *
 * No live-browser pixel verification was possible in this sandbox (no
 * backend, no .env, and installing a bundler to render react-native-web
 * standalone was not available here) -- consistent with this suite's
 * existing convention (qaModeBanner.test.mjs's own docstring: "Actual
 * on-device visual verification belongs on QA/phone"). These tests confirm
 * everything checkable at the source level; a real visual check of the
 * deployed Preview build is still recommended to close this out with full
 * confidence.
 *
 * Run with: node --experimental-strip-types src/__tests__/b06_qa_mode_banner_web_recheck.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BANNER = join(__dirname, '..', 'components', 'dhara', 'QaModeBanner.tsx');
const DESKTOP_FRAME = join(__dirname, '..', 'components', 'dhara', 'DesktopFrame.tsx');
const LAYOUT = join(__dirname, '..', '..', 'app', '_layout.tsx');
const ENV_EXAMPLE = join(__dirname, '..', '..', '.env.example');
const OUTBOUND = join(__dirname, '..', 'outbound.ts');
const APP_CONFIG = join(__dirname, '..', '..', 'app.config.js');

const bannerSrc = readFileSync(BANNER, 'utf8');
const desktopFrameSrc = readFileSync(DESKTOP_FRAME, 'utf8');
const layoutSrc = readFileSync(LAYOUT, 'utf8');
const envExampleSrc = readFileSync(ENV_EXAMPLE, 'utf8');
const outboundSrc = readFileSync(OUTBOUND, 'utf8');
const appConfigSrc = readFileSync(APP_CONFIG, 'utf8');

test('QaModeBanner has no Platform.OS branch or web-only early-return that could suppress it on web specifically', () => {
  assert.ok(!/Platform\.OS/.test(bannerSrc), 'QaModeBanner.tsx must not special-case any platform');
  // The only early return must be the OUTBOUND_PROFILE gate, not a
  // platform check.
  const returnNullLines = bannerSrc.split('\n').filter(l => l.includes('return null'));
  assert.equal(returnNullLines.length, 1);
  assert.ok(returnNullLines[0].includes("OUTBOUND_PROFILE !== 'internal_qa'"));
});

test('there is no QaModeBanner.web.tsx platform-specific override', () => {
  const webVariant = join(__dirname, '..', 'components', 'dhara', 'QaModeBanner.web.tsx');
  assert.equal(existsSync(webVariant), false, 'a web-specific variant would silently diverge from the native component');
});

test('no ancestor between the app root and the banner mount sets overflow:hidden or its own zIndex that could clip/occlude it', () => {
  assert.ok(!/overflow:\s*['"]hidden['"]/.test(layoutSrc));
  // DesktopFrame.tsx does use overflow:hidden, but only on its own internal
  // `logo` and `center` styles -- neither is an ancestor of <QaModeBanner />,
  // which is mounted as a sibling BEFORE the isWideWeb/DesktopFrame branch.
  const bannerMountIndex = layoutSrc.indexOf('<QaModeBanner />');
  const desktopFrameMountIndex = layoutSrc.indexOf('<DesktopFrame>');
  assert.ok(bannerMountIndex > -1 && desktopFrameMountIndex > -1);
  assert.ok(bannerMountIndex < desktopFrameMountIndex, 'QaModeBanner must mount before (as a sibling of, not nested inside) DesktopFrame');
  assert.ok(!/zIndex|position:\s*['"](absolute|fixed|sticky)['"]/.test(desktopFrameSrc));
});

test('the default fallback (no env vars set) is the SAFE direction: internal_qa, i.e. the banner shows by default', () => {
  assert.ok(outboundSrc.includes("const VALID_PROFILES: Profile[] = ['internal_qa', 'closed_testing', 'production'];"));
  assert.ok(/OUTBOUND_LIVE \? 'production' : 'internal_qa'/.test(outboundSrc));
});

test(".env.example now documents EXPO_PUBLIC_OUTBOUND_PROFILE and EXPO_PUBLIC_OUTBOUND_MODE (previously undocumented)", () => {
  assert.ok(envExampleSrc.includes('EXPO_PUBLIC_OUTBOUND_PROFILE='));
  assert.ok(envExampleSrc.includes('EXPO_PUBLIC_OUTBOUND_MODE='));
});

test("app.config.js's build-time profile resolution still matches outbound.ts's runtime resolution (no drift introduced)", () => {
  assert.ok(appConfigSrc.includes('function resolveOutboundProfile()'));
  assert.ok(/OUTBOUND_MODE.*===\s*"live".*\?\s*"production"\s*:\s*"internal_qa"/.test(appConfigSrc));
});
