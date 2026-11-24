// v2.2 step S10 (manifest id2, Choose language): Main.dc.html's selected row
// shows both a "Selected" text label AND a small filled checkmark badge
// (the .lcheck element). The live row already had the label; it was missing
// the check. With UI_V22_S10 on, a checkmark-circle icon renders next to
// "Selected" on the active row.
// Run: node --experimental-strip-types --test src/__tests__/v22_s10_language_selected_check.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const screen = readFileSync(join(root, 'app', 'language.tsx'), 'utf8');

test('language.tsx imports the S10 flag', () => {
  assert.match(screen, /import\s*\{\s*UI_V22_S10\s*\}\s*from\s*['"]@\/src\/uiV22Flags['"]/);
});

test('the active row still renders the existing "Selected" text label', () => {
  assert.match(screen, /<Text style=\{styles\.selectedLabel\}>Selected<\/Text>/);
});

test('a checkmark-circle icon renders next to the label only when the flag is on', () => {
  assert.match(
    screen,
    /\{UI_V22_S10 && \(\s*<Ionicons\s+name="checkmark-circle"/,
  );
});

test('flag OFF keeps exactly today\'s active row (reversible: label only, no icon)', () => {
  // Static check: the icon sits inside its own `{UI_V22_S10 && (...)}` guard,
  // so an unset env var (flag off) renders only the pre-existing label.
  const wrapBlock = screen.slice(screen.indexOf('selectedWrap'), screen.indexOf('selectedWrap') + 400);
  assert.match(wrapBlock, /UI_V22_S10 && \(/);
});

test('native name still renders before the English name (manifest: native names first)', () => {
  const rowRenderBlock = screen.slice(screen.indexOf('renderItem'), screen.indexOf('renderItem') + 1200);
  const nativeIdx = rowRenderBlock.indexOf('item.native');
  const nameIdx = rowRenderBlock.indexOf('item.name');
  assert.ok(nativeIdx > -1 && nameIdx > -1 && nativeIdx < nameIdx, 'native name text must appear before the English name text');
});

test('the search field already exists (manifest\'s "does NOT exist" note is stale)', () => {
  assert.match(screen, /testID="language-search"/);
  assert.match(screen, /placeholder="Search language…"/);
});
