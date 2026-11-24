// v2.2 step S7 (manifest id31, File a complaint): A11Y_CHECK_REPORT.md
// flagged touch targets under 48px in FirDraft. The "Add more files" attach
// button is 44x44 with no hitSlop; with UI_V22_S7 on, hitSlop={2} brings its
// effective target to 48x48.
// Run: node --experimental-strip-types --test src/__tests__/v22_s7_firdraft_attach_button.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const screen = readFileSync(join(root, 'app', 'fir-draft', 'index.tsx'), 'utf8');

test('fir-draft/index.tsx imports the S7 flag', () => {
  assert.match(screen, /import\s*\{[^}]*UI_V22_S7[^}]*\}\s*from\s*['"]@\/src\/uiV22Flags['"]/);
});

test('the "Add more files" button gets hitSlop={2} under the flag, undefined (today\'s behaviour) when off', () => {
  assert.match(
    screen,
    /<Pressable style=\{\(s\) => \[styles\.attachAddBtn, focusRingStyle\(s\)\]\} onPress=\{onAttach\} hitSlop=\{UI_V22_S7 \? 2 : undefined\} accessibilityRole="button" accessibilityLabel="Add more files">/,
  );
});

test('the button\'s own box stays 44x44 (hitSlop only extends the tappable area, it does not resize the box)', () => {
  const styleBlock = screen.slice(screen.indexOf('attachAddBtn: {'), screen.indexOf('attachAddBtn: {') + 150);
  assert.match(styleBlock, /width:\s*44,\s*height:\s*44/);
});
