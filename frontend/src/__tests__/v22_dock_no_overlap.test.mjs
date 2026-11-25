/**
 * v2.2 — floating buttons never cover content (UI_V22_DOCK, default OFF).
 *
 * Client finding (22 Nov): the bug-report button covered "+ Rec" on Silent
 * alert and values on My Data; the Help pill cut off "Indefinite (legal …)"
 * on My Data. With the flag on:
 * - phones / narrow web: both buttons live in a bottom dock that takes real
 *   layout space (DockedStack), so a screen's content ends above it
 * - desktop: no floating Help pill (sidebar SOS is the one emergency entry)
 * - bug-report button only when EXPO_PUBLIC_ENABLE_ISSUE_REPORTER === 'true'
 *   (production builds don't set it → hidden)
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
const layout = read('app', '_layout.tsx');
const dock = read('src', 'components', 'dhara', 'FloatingDock.tsx');
const help = read('src', 'components', 'dhara', 'GlobalHelpButton.tsx');
const bug = read('src', 'components', 'IssueReporterButton.tsx');

// Redesign v3, stage 2: the bottom dock is retired (SOS moved to the header).
test('dock is retired: the flag is hard off', () => {
  assert.match(flags, /export const UI_V22_DOCK: boolean = false;/);
});

test('flag OFF keeps the old floating layout exactly', () => {
  assert.match(layout, /<View style=\{\{ flex: 1 \}\}>\s*\n\s*<QaInsetFrame>\s*\n\s*<AutoHeaderFrame>\s*\n\s*<Stack[^\n]*\/>\s*\n\s*<\/AutoHeaderFrame>\s*\n\s*<\/QaInsetFrame>\s*\n\s*<GlobalHelpButton \/>\s*\n\s*<IssueReporterButton \/>/);
});

test('flag ON on phones: the stack sits inside DockedStack (dock in layout flow)', () => {
  assert.match(layout, /UI_V22_DOCK \? \(/);
  assert.match(layout, /<DockedStack>\s*\n\s*<Stack /);
  // Dock is a sibling BELOW the stack, not an absolute overlay.
  assert.match(dock, /<View style=\{\{ flex: 1 \}\}>\{children\}<\/View>\s*\n\s*<\/SafeAreaInsetsContext\.Provider>\s*\n\s*<FloatingDock \/>/);
  assert.ok(!/position:\s*'absolute'/.test(dock), 'the dock itself must not float');
});

test('docked buttons are in normal flow (no absolute position, no drag)', () => {
  assert.match(help, /btnDocked: \{ position: 'relative'/);
  assert.match(help, /style=\{docked \? \[styles\.btn, styles\.btnDocked\]/);
  assert.match(bug, /\{docked \? \(\s*\n[\s\S]*?<Pressable\s*\n\s*testID="issue-reporter-button"/);
  assert.match(bug, /fabDocked: \{ width: 48, height: 48/);
  assert.match(dock, /<IssueReporterButton docked \/>/);
  assert.match(dock, /<GlobalHelpButton docked \/>/);
});

test('dock only appears where a button shows, and gives screens bottom inset 0 then', () => {
  assert.match(dock, /const showHelp = !isGlobalHelpHidden\(pathname\);/);
  assert.match(dock, /const showBug = ISSUE_REPORTER_ENABLED && signedIn && !isIssueReporterRouteHidden\(pathname\);/);
  assert.match(dock, /if \(!dockVisible\(pathname, !!token\)\) return null;/);
  assert.match(dock, /value=\{visible \? \{ \.\.\.insets, bottom: 0 \} : insets\}/);
});

test('Help hide rules unchanged (now a shared predicate)', () => {
  for (const rule of [
    "pathname === '/emergency'", "pathname?.startsWith('/oauth')", 'isHeadOutWizardStep',
    "pathname?.startsWith('/family-journey')", "pathname?.startsWith('/guardian')",
    "pathname?.startsWith('/admin-')", 'isHome', 'hideScan', 'isAuthOnboarding',
  ]) assert.ok(help.includes(rule), `predicate must keep: ${rule}`);
  assert.match(help, /if \(isGlobalHelpHidden\(pathname\)\) return null;/);
});

test('bug button: explicit opt-in, so production never ships it', () => {
  // This used to depend on UI_V22_DOCK: with the dock off it fell back to
  // `!== 'false'`, so an ABSENT variable counted as ON. A production build
  // sets neither flag and therefore shipped the bug button to real users.
  assert.match(
    bug,
    /export const ISSUE_REPORTER_ENABLED = process\.env\.EXPO_PUBLIC_ENABLE_ISSUE_REPORTER === 'true';/,
  );
  assert.ok(
    !/EXPO_PUBLIC_ENABLE_ISSUE_REPORTER !== 'false'/.test(bug),
    'the absent-means-on fallback must not come back',
  );
});

test('desktop with the flag on: no floating Help pill, bug button kept', () => {
  assert.match(layout, /\{isWideWeb && !UI_V22_DOCK && <GlobalHelpButton \/>\}/);
  assert.match(layout, /\{isWideWeb && <IssueReporterButton \/>\}/);
});
