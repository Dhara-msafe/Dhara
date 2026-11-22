/**
 * v2.2 rollout — phase 5b (tidy Home, flag OFF).
 *
 * Owner GO (21 Nov): remove the duplicate "All help" / "Start your first
 * case" entries and the second help list on Home, and hide "Get the app"
 * until launch. Behind EXPO_PUBLIC_UI_V22_P5_HOME (default OFF):
 * - Home grid drops its "All help" tile (the header "All help" link stays)
 * - Home's empty My files card is hidden (the For-you "Start your first
 *   case" card stays the one start action; the section shows once a case exists)
 * - desktop, on Home only: rail case card + sidebar "Help journeys" list hidden
 * - desktop, everywhere: "Get the app" card hidden
 *
 * Source-level tests, qaModeBanner.test.mjs convention.
 * Run with: node --test src/__tests__/v22_p5b_home_tidy.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const flags = readFileSync(join(root, 'src', 'uiV22Flags.ts'), 'utf8');
const home = readFileSync(join(root, 'app', '(tabs)', 'home.tsx'), 'utf8');
const frame = readFileSync(join(root, 'src', 'components', 'dhara', 'DesktopFrame.tsx'), 'utf8');

test('flag defaults OFF: only the exact string "true" enables phase 5b', () => {
  assert.match(flags, /export const UI_V22_P5_HOME = process\.env\.EXPO_PUBLIC_UI_V22_P5_HOME === 'true';/);
  assert.match(home, /import \{ UI_V22_P5_HOME(, UI_V22_P8)? \} from '@\/src\/uiV22Flags';/);
  assert.match(frame, /import \{ UI_V22_P5_HOME(, UI_V22_P6)?(, UI_V22_ONE_SOS)? \} from '\.\.\/\.\.\/uiV22Flags';/);
});

test('Home: "All help" tile dropped with the flag on; header link kept', () => {
  assert.match(home, /\.\.\.\(UI_V22_P5_HOME \? \[\] : \[\{ key: 'home\.allHelp'/);
  // The header link to /all-help is not gated.
  assert.match(home, /accessibilityLabel="See all help journeys"/);
});

test('Home: empty My files card hidden with the flag on; shown once a case exists', () => {
  assert.match(home, /\{\(!UI_V22_P5_HOME \|\| \(primaryCase && primaryProgress\)\) && \(/);
  // The For-you "Start your first case" card is untouched (the one start action).
  assert.match(home, /testID="foryou-start-case"/);
});

test('Desktop: on Home only, rail case card and sidebar help list hidden', () => {
  assert.match(frame, /const homeTidy = UI_V22_P5_HOME && isHome;/);
  assert.match(frame, /\{!homeTidy && \(\s*\n\s*<>\s*\n\s*<Text style=\{styles\.group\}>/);
  assert.match(frame, /\{!homeTidy && \(\s*\n\s*<View style=\{styles\.railCard\}>/);
});

test('Desktop: "Get the app" hidden everywhere with the flag on', () => {
  assert.match(frame, /\{!UI_V22_P5_HOME && \(\s*\n\s*<View style=\{\[styles\.railCard, \{ backgroundColor: c\.navy \}\]\}>\s*\n\s*<Text style=\{styles\.getApp\}>Get the app/);
});

test('earlier phases intact: phase 2 calm rail and SOS gating unchanged', () => {
  assert.match(frame, /const calm = UI_V22_P2 && isCalmRoute\(pathname\);/);
  assert.match(frame, /\{calm \|\| hideHomeRail \? null : \(/);
  assert.equal((frame.match(/router\.push\('\/emergency'\)/g) || []).length, 2);
});
