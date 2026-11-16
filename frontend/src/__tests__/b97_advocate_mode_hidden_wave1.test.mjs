/**
 * B-97 — advocate/lawyer features hidden for Wave 1 per D-14 (5 Nov).
 *
 * Before this fix: "For advocates" was an unconditional link in the
 * desktop header (DesktopFrame.tsx), "Find an advocate" was an
 * unconditional card on the Discover/Lookup tab, "me.advocate" was an
 * unconditional row on the Me screen, and all four advocate/lawyer screens
 * (/(tabs)/advocate, /advocate-register, /lawyer-home, /intakes) rendered
 * normally for any authenticated user on direct navigation — none of this
 * respected D-14's "hide for Wave 1" decision.
 *
 * Fix: a single build flag, ADVOCATE_MODE_ENABLED (src/advocateMode/flags.ts,
 * EXPO_PUBLIC_ADVOCATE_MODE_V2 === 'true', default false/hidden), gates (a)
 * every in-app entry point to advocate mode, and (b) each of the four
 * screens directly, via an unconditional <Redirect> at the top of the
 * component — so hiding the links is not enough by itself: a direct URL hit
 * or a refresh (the exact failure mode B-86 describes for a different
 * screen) must redirect away too, not render the advocate UI.
 *
 * These tests check the wiring at the source level (same convention as
 * qaModeBanner.test.mjs / nearestHelp.logic.test.mjs): no RN renderer in
 * this plain-Node test setup, so we assert the gating code is actually
 * present in each file rather than rendering React Native. On-device visual
 * verification belongs on QA/phone.
 *
 * Run with: node --experimental-strip-types src/__tests__/b97_advocate_mode_hidden_wave1.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FLAGS = join(__dirname, '..', 'advocateMode', 'flags.ts');
const DESKTOP_FRAME = join(__dirname, '..', 'components', 'dhara', 'DesktopFrame.tsx');
const DISCOVER = join(__dirname, '..', '..', 'app', '(tabs)', 'discover.tsx');
const ME = join(__dirname, '..', '..', 'app', '(tabs)', 'me.tsx');
const ADVOCATE_TAB = join(__dirname, '..', '..', 'app', '(tabs)', 'advocate.tsx');
const ADVOCATE_REGISTER = join(__dirname, '..', '..', 'app', 'advocate-register.tsx');
const LAWYER_HOME = join(__dirname, '..', '..', 'app', 'lawyer-home.tsx');
const INTAKES = join(__dirname, '..', '..', 'app', 'intakes.tsx');

const flagsSrc = readFileSync(FLAGS, 'utf8');
const desktopFrameSrc = readFileSync(DESKTOP_FRAME, 'utf8');
const discoverSrc = readFileSync(DISCOVER, 'utf8');
const meSrc = readFileSync(ME, 'utf8');
const advocateTabSrc = readFileSync(ADVOCATE_TAB, 'utf8');
const advocateRegisterSrc = readFileSync(ADVOCATE_REGISTER, 'utf8');
const lawyerHomeSrc = readFileSync(LAWYER_HOME, 'utf8');
const intakesSrc = readFileSync(INTAKES, 'utf8');

test('the flag defaults to hidden (Wave 1) and only flips on via an explicit EXPO_PUBLIC_ env var', () => {
  assert.ok(flagsSrc.includes("export const ADVOCATE_MODE_ENABLED = process.env.EXPO_PUBLIC_ADVOCATE_MODE_V2 === 'true';"));
  // Must be a strict equality check against the env var, not a truthy
  // check on an unset/garbage value defaulting to "on".
  assert.ok(!/ADVOCATE_MODE_ENABLED\s*=\s*true\b/.test(flagsSrc));
});

test('DesktopFrame hides the "For advocates" header link when the flag is off', () => {
  assert.ok(desktopFrameSrc.includes("import { ADVOCATE_MODE_ENABLED } from '../../advocateMode/flags';"));
  assert.ok(/\{ADVOCATE_MODE_ENABLED && \(\s*<Pressable accessibilityRole="button" accessibilityLabel="For advocates"/.test(desktopFrameSrc));
});

test('Discover/Lookup tab filters out the "Find an advocate" card when the flag is off', () => {
  assert.ok(discoverSrc.includes("import { ADVOCATE_MODE_ENABLED } from '@/src/advocateMode/flags';"));
  assert.ok(discoverSrc.includes("const tools = allTools.filter(t => t.id !== 'advocate' || ADVOCATE_MODE_ENABLED);"));
});

test('Me screen omits the "me.advocate" row when the flag is off', () => {
  assert.ok(meSrc.includes("import { ADVOCATE_MODE_ENABLED } from '@/src/advocateMode/flags';"));
  assert.ok(meSrc.includes("...(ADVOCATE_MODE_ENABLED ? [{ icon: 'briefcase-outline' as any, key: 'me.advocate', route: '/(tabs)/advocate' }] : []),"));
});

// --- The 4 screens: must redirect on direct navigation, not just be
// unreached because the links are hidden. Each check confirms the gate is
// (a) present, (b) an unconditional Redirect (not merely a loading spinner
// that would eventually render the real content), and (c) placed as the
// component's first real statement, so it always runs before any
// data-fetching effect could fire.
function assertRedirectsHomeWhenDisabled(src, label) {
  assert.ok(src.includes("import { ADVOCATE_MODE_ENABLED } from '@/src/advocateMode/flags';"), `${label}: missing flag import`);
  assert.ok(/if \(!ADVOCATE_MODE_ENABLED\) return <Redirect href="\/\(tabs\)\/home" \/>;/.test(src), `${label}: missing the redirect-when-disabled gate`);
  assert.ok(/import \{ useRouter, Redirect \} from 'expo-router';/.test(src), `${label}: must import Redirect from expo-router`);
}

test('/(tabs)/advocate redirects home when advocate mode is disabled (direct URL hit / refresh included)', () => {
  assertRedirectsHomeWhenDisabled(advocateTabSrc, 'advocate.tsx');
});

test('/advocate-register redirects home when advocate mode is disabled', () => {
  assertRedirectsHomeWhenDisabled(advocateRegisterSrc, 'advocate-register.tsx');
});

test('/lawyer-home redirects home when advocate mode is disabled', () => {
  assertRedirectsHomeWhenDisabled(lawyerHomeSrc, 'lawyer-home.tsx');
});

test('/intakes (advocate-facing manage screen) redirects home when advocate mode is disabled', () => {
  assertRedirectsHomeWhenDisabled(intakesSrc, 'intakes.tsx');
});

test('the client-facing intake FORM screens are untouched by this fix (different audience, not advocate-only)', () => {
  // Regression guard: /intake/[token] and /intake-view/[token] are what a
  // CLIENT fills in/views, not an advocate-only screen -- gating them would
  // break a flow that has nothing to do with advocate mode visibility.
  const intakeFormPath = join(__dirname, '..', '..', 'app', 'intake', '[token].tsx');
  const intakeViewPath = join(__dirname, '..', '..', 'app', 'intake-view', '[token].tsx');
  const intakeFormSrc = readFileSync(intakeFormPath, 'utf8');
  const intakeViewSrc = readFileSync(intakeViewPath, 'utf8');
  assert.ok(!intakeFormSrc.includes('ADVOCATE_MODE_ENABLED'));
  assert.ok(!intakeViewSrc.includes('ADVOCATE_MODE_ENABLED'));
});
