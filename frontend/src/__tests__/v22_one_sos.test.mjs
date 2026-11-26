/**
 * v2.2 — one emergency entry per screen (UI_V22_ONE_SOS, default OFF). B-122.
 *
 * - Desktop frame: the sidebar "SOS · Emergency" is the one entry; screen
 *   SOS pills (SosPill) step aside inside the frame, and the top-bar SOS
 *   chip is not shown.
 * - Phones: the tab layout's floating SOS stops floating over the Ask header
 *   (B-122: it covered "New chat"); Ask shows an SOS pill inside its header
 *   row instead. Me and Settings already carry their own SOS in the screen.
 *
 * Source-level tests, qaModeBanner.test.mjs convention.
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
const pill = read('src', 'components', 'dhara', 'SosPill.tsx');
const frame = read('src', 'components', 'dhara', 'DesktopFrame.tsx');
const tabs = read('app', '(tabs)', '_layout.tsx');
const ask = read('app', '(tabs)', 'index.tsx');

test('flag defaults OFF', () => {
  assert.match(flags, /export const UI_V22_ONE_SOS = process\.env\.EXPO_PUBLIC_UI_V22_ONE_SOS === 'true';/);
});

test('desktop: screens inside the frame know it, and their SOS pill steps aside', () => {
  assert.match(frame, /<InDesktopFrameContext\.Provider value=\{true\}>\{children\}<\/InDesktopFrameContext\.Provider>/);
  assert.match(pill, /const inDesktopFrame = useInDesktopFrame\(\);\s*\n\s*if \(UI_V22_ONE_SOS && inDesktopFrame\) return null;/);
});

test('desktop: top-bar SOS chip off with the flag; sidebar SOS unchanged', () => {
  assert.match(frame, /\{!isHome && !calm && !UI_V22_ONE_SOS && \(/);
  assert.match(frame, /style=\{styles\.sos\} onPress=\{\(\) => router\.push\('\/emergency'\)\}/);
});

test('phones (B-122 + 390px sweep): the tab SOS never floats with the flag on', () => {
  assert.match(tabs, /\{!onHome && !UI_V22_ONE_SOS && \(/);
});

// Redesign v3, stage 9: the navy header holds the brand and SOS only; New chat
// and History moved to the labelled tools row under it.
test('Ask keeps exactly one SOS: in its navy header, above the tools row', () => {
  const sos = ask.indexOf('{UI_V22_ONE_SOS && <SosPill compact />}');
  const tools = ask.indexOf('testID="ask-tools"');
  const newChat = ask.indexOf('testID="new-chat-button"');
  const history = ask.indexOf('testID="history-header-btn"');
  assert.ok(sos > 0 && tools > sos && newChat > tools && history > newChat, 'SOS in the header; New chat + History in the tools row below');
  assert.equal(ask.split('<SosPill compact />').length - 1, 1, 'exactly one SOS on Ask');
});

test('compact pill keeps the 48px target', () => {
  assert.match(pill, /sosCompact: \{ paddingHorizontal: 14 \}/);
  assert.match(pill, /sos: \{[^}]*height: 48/);
});
