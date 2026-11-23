// v2.2 step S6 (manifest id20, All help): A11Y_CHECK_REPORT.md flagged text
// clipping at 1.5x font scale on the fixed 390px mockup canvas and said this
// "is expected to need real layout work in the app". With UI_V22_S6 on, the
// help-card grid's title/sub drop their numberOfLines clamp so text wraps
// instead of being cut off with an ellipsis.
// Run: node --experimental-strip-types --test src/__tests__/v22_s6_all_help.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const screen = readFileSync(join(root, 'app', 'all-help.tsx'), 'utf8');

test('all-help.tsx imports the S6 flag', () => {
  assert.match(screen, /import\s*\{[^}]*UI_V22_S6[^}]*\}\s*from\s*['"]@\/src\/uiV22Flags['"]/);
});

test('the help-card title and sub drop their numberOfLines clamp under the flag', () => {
  assert.match(
    screen,
    /<Text style=\{styles\.cardTitle\} numberOfLines=\{UI_V22_S6 \? undefined : 2\}>\{card\.title\}<\/Text>/,
  );
  assert.match(
    screen,
    /<Text style=\{styles\.cardSub\} numberOfLines=\{UI_V22_S6 \? undefined : 2\}>\{card\.sub\}<\/Text>/,
  );
});

test('flag OFF keeps today\'s clamp of 2 lines (reversible)', () => {
  // Static check: the ternary's false branch is the literal 2 that shipped
  // before this change, so an unset env var (flag off) reproduces it exactly.
  assert.match(screen, /numberOfLines=\{UI_V22_S6 \? undefined : 2\}/g);
});

test('the card container has no fixed height that would still clip wrapped text', () => {
  const cardStyleBlock = screen.slice(screen.indexOf('card: {'), screen.indexOf('card: {') + 200);
  assert.doesNotMatch(cardStyleBlock, /\bheight:\s*\d/, 'card style must not set a fixed height (minHeight is fine, it only sets a floor)');
});
