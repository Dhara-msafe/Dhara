/**
 * v2.2 rollout — phase 6 (one dialler message everywhere, flag OFF).
 *
 * The Emergency screen's 112 control opens the dialler (openPhone(), via the
 * Outbound Guard; the user presses call; QA builds simulate). Women's Shield
 * and the SOS helpline sheet still said calling was "not yet active" /
 * "will be enabled in a future update", and Settings said "One tap to call".
 * Behind EXPO_PUBLIC_UI_V22_P6 (default OFF) they all use the Emergency
 * control and wording, from one copy module (src/emergencyCopy.ts).
 *
 * Also (manager preview check, 21 Nov): Home desktop keeps exactly one
 * emergency entry (sidebar SOS), and the near-empty Home rail is dropped
 * when phase 5b is also on.
 *
 * Source-level tests, qaModeBanner.test.mjs convention.
 * Run with: node --test src/__tests__/v22_p6_one_112_message.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');

const flags = read('src', 'uiV22Flags.ts');
const copy = read('src', 'emergencyCopy.ts');
const emergency = read('app', 'emergency.tsx');
const shield = read('app', 'women-shield.tsx');
const sos = read('src', 'components', 'SOSButton.tsx');
const frame = read('src', 'components', 'dhara', 'DesktopFrame.tsx');
const i18n = read('src', 'ui18n.ts');

test('flag defaults OFF', () => {
  assert.match(flags, /export const UI_V22_P6 = process\.env\.EXPO_PUBLIC_UI_V22_P6 === 'true';/);
});

test('shared copy matches the Emergency screen word for word', () => {
  assert.ok(emergency.includes('accessibilityLabel="Open dialler for 112"'));
  assert.ok(emergency.includes(`accessibilityHint="Opens your phone's dialler with 112 filled in. You still have to press call yourself."`));
  assert.match(copy, /export const dialLabel = \(number: string\) => `Open dialler for \$\{number\}`;/);
  assert.ok(copy.includes("`Opens your phone's dialler with ${number} filled in. You still have to press call yourself.`"));
  assert.match(copy, /export const DIAL_112_BUTTON = 'Open dialler for 112';/);
  for (const banned of [/not yet active/i, /future update/i, /one tap to call/i, /police notified/i]) {
    assert.ok(!banned.test(copy), `emergencyCopy must not contain ${banned}`);
  }
});

test("Women's Shield helplines: Emergency control with the flag on", () => {
  assert.match(shield, /onPress=\{async \(\) => setDialStatus\(await openPhone\(h\.num\)\)\}/);
  assert.match(shield, /accessibilityLabel=\{`\$\{dialLabel\(h\.num\)\} — \$\{h\.label\}`\} accessibilityHint=\{dialHint\(h\.num\)\}/);
  assert.match(shield, /<Text style=\{styles\.hlNum\} selectable>\{h\.num\}<\/Text>/);
  assert.match(shield, /testID="ws-dial-status"[^\n]*accessibilityLiveRegion="polite"[^\n]*selectable/);
  assert.match(shield, /\{UI_V22_P6 \? DIAL_LIST_NOTE : 'Tap-to-call is not yet active\./);
  assert.match(shield, /tr\(UI_V22_P6 \? 'ws\.talk\.sub\.v22' : 'ws\.talk\.sub', lang\)/);
});

test('new sub-heading reuses the approved em.tapcall text in every language', () => {
  const line = i18n.split('\n').find((l) => l.trim().startsWith("'ws.talk.sub.v22':"));
  const tap = i18n.split('\n').find((l) => l.trim().startsWith("'em.tapcall':"));
  assert.ok(line && tap);
  for (const lang of ['en', 'hi', 'mr', 'ta']) {
    const tapText = tap.match(new RegExp(`${lang}: '([^']+)'`))[1];
    const subText = line.match(new RegExp(`${lang}: '([^']+)'`))[1];
    assert.ok(subText.endsWith(tapText), `${lang}: ws.talk.sub.v22 must end with the em.tapcall text`);
  }
});

test('SOS helpline sheet: Emergency control with the flag on', () => {
  assert.match(sos, /onPress=\{async \(\) => setDialStatus\(await openPhone\(h\.number\)\)\}/);
  assert.match(sos, /accessibilityLabel=\{`\$\{dialLabel\(h\.number\)\} — \$\{h\.label\}`\}/);
  assert.match(sos, /<Text style=\{styles\.numberText\} selectable>\{h\.number\}<\/Text>/);
  assert.match(sos, /testID="sos-dial-status"/);
});

test('other 112 buttons and Settings use the same wording with the flag on', () => {
  assert.match(read('app', '(tabs)', 'settings.tsx'), /UI_V22_P6 \? 'Open your dialler for 112, police, women or child helpline'/);
  for (const f of [['app', 'action-plan.tsx'], ['app', 'visitor', 'intent.tsx'], ['app', 'women', 'nearest-help.tsx']]) {
    const s = read(...f);
    assert.ok(s.includes('DIAL_112_BUTTON'), `${f.join('/')} must use DIAL_112_BUTTON`);
    assert.ok(s.includes("accessibilityLabel: dialLabel('112'), accessibilityHint: dialHint('112')"), `${f.join('/')} must use the shared name + hint`);
  }
});

test('Home desktop: exactly one emergency entry, and the empty rail is dropped', () => {
  assert.match(frame, /const sidebarSosOnHome = UI_V22_P6;/);
  assert.match(frame, /\{\(!isHome \|\| sidebarSosOnHome\) && !\(calm && onEmergencyScreen\) && \(/);
  // The top chip stays off on Home, so sidebar SOS is the single entry.
  assert.match(frame, /\{!isHome && !calm( && !UI_V22_ONE_SOS)? && \(/);
  assert.match(frame, /const hideHomeRail = UI_V22_P6 && homeTidy;/);
  assert.match(frame, /\{calm \|\| hideHomeRail \? null : \(/);
});

test('no new dial path: every new tap goes through openPhone (Outbound Guard)', () => {
  for (const s of [shield, sos]) {
    assert.ok(!/openExternal\(`tel:/.test(s), 'must not open tel: directly');
    assert.ok(s.includes("import { openPhone } from '@/src/women/helpActions';"));
  }
});
