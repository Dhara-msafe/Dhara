// v2.2 step S12 (manifest id52, IPC lookup): the screen's `safe` container
// hardcoded the legacy off-brand '#FDFBF7', one hex away from the shared
// v2.2 cream token (theme.colors.background, '#FBF7EE') that IPCLookup.dc.html
// and every other v2.2 screen use. With UI_V22_S12 on, it reads the token.
// Run: node --experimental-strip-types --test src/__tests__/v22_s12_ipc_lookup_background.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const screen = readFileSync(join(root, 'app', 'ipc-bns-lookup.tsx'), 'utf8');

test('ipc-bns-lookup.tsx imports the S12 flag', () => {
  assert.match(screen, /import\s*\{\s*UI_V22_S12\s*\}\s*from\s*['"]@\/src\/uiV22Flags['"]/);
});

test('the safe container swaps to the shared cream token under the flag', () => {
  assert.match(
    screen,
    /safe:\s*\{\s*flex:\s*1,\s*backgroundColor:\s*UI_V22_S12 \? theme\.colors\.background : '#FDFBF7'\s*\}/,
  );
});

test('flag OFF keeps exactly today\'s legacy hex (reversible)', () => {
  // Static check: the ternary's false branch is the literal hex that shipped
  // before this change, so an unset env var (flag off) reproduces it exactly.
  assert.match(screen, /: '#FDFBF7'/);
});

test('no Citation Guard logic lines were touched (background-only change)', () => {
  assert.match(screen, /query_found_in_db === false/);
  assert.match(screen, /No LLM \/ AI call is ever made from this screen/);
});
