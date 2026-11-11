/**
 * Day 2 QA journeys — W2-J01 / W2-J03 wiring checks.
 *
 * W2-J01: Help button -> Emergency -> call 112.
 * W2-J03: Call 112/181 buttons for quota-exhausted guests.
 *
 * Full acceptance for both is explicitly APK-level per the register
 * (TST-P-W2-01/02/03: "each with accepted EVD on the APK") — a live build on
 * a real device, which this sandbox cannot produce. What's below is the
 * locally-verifiable slice: the actual navigation/dispatch wiring is really
 * there in source, backed by the Outbound Guard behavior already proven
 * correct (see helpActions.test.mjs / outboundGuard.test.mjs), rather than a
 * claim that the full on-device journey has been run.
 *
 * Source-level wiring checks only (every file below transitively imports
 * react-native), same convention used throughout this repo.
 *
 * Run with: node --experimental-strip-types --test src/__tests__/w2Journeys.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EMERGENCY = join(__dirname, '..', '..', 'app', 'emergency.tsx');
const GLOBAL_HELP = join(__dirname, '..', 'components', 'dhara', 'GlobalHelpButton.tsx');
const ME_TAB = join(__dirname, '..', '..', 'app', '(tabs)', 'me.tsx');
const CHAT_SCREEN = join(__dirname, '..', '..', 'app', '(tabs)', 'index.tsx');
const EMERGENCY_BANNERS = join(__dirname, '..', 'chat', 'EmergencyBanners.tsx');

const emergencySrc = readFileSync(EMERGENCY, 'utf8');
const globalHelpSrc = readFileSync(GLOBAL_HELP, 'utf8');
const meTabSrc = readFileSync(ME_TAB, 'utf8');
const chatScreenSrc = readFileSync(CHAT_SCREEN, 'utf8');
const bannersSrc = readFileSync(EMERGENCY_BANNERS, 'utf8');

/* ---------------- W2-J01: Help button -> Emergency -> call 112 ---------- */

test('W2-J01: the global Help FAB and the Me-tab both navigate to /emergency', () => {
  assert.match(globalHelpSrc, /onPress=\{?\(\) => router\.push\('\/emergency'\)\}?/);
  assert.match(meTabSrc, /onPress=\{?\(\) => router\.push\('\/emergency'\)\}?/);
});

test('W2-J01: the emergency screen\'s 112 circle dials through openPhone (the Outbound Guard), not a raw dialler call', () => {
  assert.ok(emergencySrc.includes("import { openPhone } from '@/src/women/helpActions';"));
  const pressableStart = emergencySrc.indexOf('testID="call-112"');
  const pressableNearby = emergencySrc.slice(Math.max(0, pressableStart - 150), pressableStart + 150);
  assert.ok(pressableStart !== -1, 'call-112 Pressable not found');
  assert.match(pressableNearby, /onPress=\{async \(\) => setCallStatus\(await openPhone\('112'\)\)\}/);
  // The call status (simulated-vs-live text) is actually shown to the user,
  // not just resolved and discarded.
  assert.ok(emergencySrc.includes('testID="emergency-call-status"'));
  assert.ok(emergencySrc.includes('accessibilityLiveRegion="polite"'), 'status update must be announced to screen readers');
});

test('W2-J01: emergency.tsx never calls Linking/Share/SMS directly (must go through the Outbound Guard)', () => {
  assert.ok(!/Linking\.openURL|SMS\.sendSMSAsync|Share\.share/.test(emergencySrc));
});

/* ---------------- W2-J03: Call 112/181 for quota-exhausted guests ------- */

test('W2-J03: EmergencyCallShortcut (112 + 181) is gated behind the guest quota actually being exhausted', () => {
  assert.ok(chatScreenSrc.includes("import { SosEmergencyBanner, EmergencyCallShortcut } from '@/src/chat/EmergencyBanners';"));
  const gateIdx = chatScreenSrc.indexOf('!!user?.is_guest && guestQuota.limitReached && (');
  const mountIdx = chatScreenSrc.indexOf('<EmergencyCallShortcut');
  assert.ok(gateIdx !== -1, 'guest-limit-reached gate not found');
  assert.ok(mountIdx !== -1, 'EmergencyCallShortcut not mounted');
  assert.ok(gateIdx < mountIdx, 'EmergencyCallShortcut must be inside the limitReached block, not mounted unconditionally');
});

test('W2-J03: EmergencyCallShortcut dials 112 and 181 through the Outbound Guard, independent of any LLM/quota state', () => {
  assert.ok(bannersSrc.includes("import { openExternal } from '../outbound';"));
  // EMERGENCY_SHORTCUT_NUMBERS is the array EmergencyCallShortcut renders
  // (declared just above the component, as a module-level const).
  const arrStart = bannersSrc.indexOf('const EMERGENCY_SHORTCUT_NUMBERS');
  const fnEnd = bannersSrc.indexOf('export function EmergencyCallShortcut') ;
  const block = bannersSrc.slice(arrStart, bannersSrc.length);
  assert.ok(arrStart !== -1 && fnEnd !== -1 && arrStart < fnEnd, 'EMERGENCY_SHORTCUT_NUMBERS must precede the component');
  assert.ok(/label: '112'/.test(block));
  assert.ok(/label: '181'/.test(block));
  assert.ok(/onPress=\{?\(\) => openExternal\(`tel:\$\{label\}`\)\}?/.test(block));
});

test('W2-J03: EmergencyBanners.tsx never calls Linking/Share/SMS directly either', () => {
  assert.ok(!/Linking\.openURL|SMS\.sendSMSAsync|Share\.share/.test(bannersSrc));
});
