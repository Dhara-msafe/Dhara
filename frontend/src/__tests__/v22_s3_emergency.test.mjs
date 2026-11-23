/**
 * v2.2 UI step S3 — Emergency (screen-manifest id 25, "Copy correction +
 * Visual change; wiring = New functionality").
 *
 * Audited against the manifest's change_summary:
 *  - "No Police notified" claim: already absent.
 *  - Label "Open dialler for 112" with a visible fallback: already present
 *    (accessibilityLabel + selectable "112" text).
 *  - "The real 112 element has no handler": already false — an earlier,
 *    separate, unconditional fix wired call-112 through openPhone() (same
 *    Outbound-Guard-mediated helper used on Officer card / Women's
 *    Shield). That is the "wiring = New functionality" item the manifest
 *    flags as still needing device testing — NOT reopened here.
 *
 * The one real "Visual change" found: the background used the legacy
 * `emergencyDeep` (#7A160F) constant instead of the v2.2 design package's
 * authoritative `redDeep` (#7F1D1D, Emergency.dc.html / design-tokens.json).
 * Fixed behind EXPO_PUBLIC_UI_V22_S3 (default OFF, shared with Officer card
 * and Record proof).
 *
 * Run with: node --experimental-strip-types --test src/__tests__/v22_s3_emergency.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const screen = readFileSync(join(root, 'app', 'emergency.tsx'), 'utf8');
// Strip // line comments before scanning for user-facing copy violations,
// so this file's own explanatory comments (which quote the manifest's
// "no Police notified" requirement) don't trip the check.
const screenNoComments = screen.replace(/^\s*\/\/.*$/gm, '');

test('no "police notified" style claim anywhere in the actual code/copy', () => {
  assert.doesNotMatch(screenNoComments, /police[^"']*(notif|alert|inform)/i);
});

test('root background swaps to the v2.2 redDeep token under the flag', () => {
  assert.match(screen, /import \{ UI_V22_S3 \} from '@\/src\/uiV22Flags';/);
  assert.match(screen, /root: \{ flex: 1, backgroundColor: UI_V22_S3 \? c\.redDeep : c\.emergencyDeep, paddingHorizontal: 20 \},/);
});

test('112 dialler label, hint and visible-number fallback are untouched', () => {
  assert.match(screen, /accessibilityLabel="Open dialler for 112"/);
  assert.match(screen, /accessibilityHint="Opens your phone's dialler with 112 filled in\. You still have to press call yourself\."/);
  assert.match(screen, /<Text style=\{styles\.callNum\} selectable>112<\/Text>/);
});

test('the 112 handler (already wired by an earlier, separate fix) is untouched — not reopened as "New functionality"', () => {
  assert.match(screen, /onPress=\{async \(\) => setCallStatus\(await openPhone\('112'\)\)\}/);
});

test('tiles, QuickExit and the "I\'m safe" exit are untouched', () => {
  assert.match(screen, /onPress=\{\(\) => \{ t\.beforeNav\?\.\(\); router\.push\(t\.route as any\); \}\}/);
  assert.match(screen, /<QuickExit \/>/);
  assert.match(screen, /onPress=\{\(\) => router\.replace\('\/\(tabs\)\/home'\)\} testID="im-safe"/);
});
