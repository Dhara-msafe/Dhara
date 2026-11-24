/**
 * B-122 — on web, the global SOS pill (app/(tabs)/_layout.tsx) used to be
 * pinned to the raw browser-window edge ("position: absolute, right: 16"
 * against the full-width screen), while the chat header's New Chat / History
 * buttons (app/(tabs)/index.tsx) sit at the edge of the centered,
 * width-capped chat column (src/chat/chatStyles.ts's webContentWrap, capped
 * at WEB_CHAT_MAX_WIDTH). Those are two different "right edges" on web: at
 * window widths where the column's edge happens to land near the real
 * window edge (a common half-screen-snapped desktop width), the SOS pill
 * rendered on top of the header buttons.
 *
 * Fix verified here (source-level, no RN renderer in this plain-Node test
 * setup — same convention as b107_b80_preserve_unsent_fir_input.test.mjs /
 * b117_helplines_police_number.test.mjs): the SOS overlay now shares the
 * exact same centered + capped frame as the chat column (one shared
 * WEB_CHAT_MAX_WIDTH constant), so its right edge always lines up with the
 * header's, at every window width.
 *
 * Run with:
 *   node --experimental-strip-types --test src/__tests__/b122_sos_overlay_matches_chat_column.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TABS_LAYOUT = join(__dirname, '..', '..', 'app', '(tabs)', '_layout.tsx');
const CHAT_STYLES = join(__dirname, '..', 'chat', 'chatStyles.ts');

const layoutSrc = readFileSync(TABS_LAYOUT, 'utf8');
const chatStylesSrc = readFileSync(CHAT_STYLES, 'utf8');

test('chatStyles exports one shared web-column width cap', () => {
  assert.match(chatStylesSrc, /export const WEB_CHAT_MAX_WIDTH\s*=\s*800/);
  // webContentWrap must use that constant, not its own separate literal.
  assert.match(chatStylesSrc, /webContentWrap:\s*{[^}]*maxWidth:\s*WEB_CHAT_MAX_WIDTH/s);
});

test('the SOS overlay imports and uses the same shared constant (not a second literal)', () => {
  assert.match(layoutSrc, /import\s*{\s*WEB_CHAT_MAX_WIDTH\s*}\s*from\s*['"]@\/src\/chat\/chatStyles['"]/);
  assert.match(layoutSrc, /sosOverlayInner:\s*{[^}]*maxWidth:\s*WEB_CHAT_MAX_WIDTH/s);
  // Regression guard: the old flat "right: 16 against the full-width
  // screen" placement must be gone — a bare `right: 16` on the overlay
  // frame (with no centering) is exactly what caused the overlap.
  assert.doesNotMatch(
    layoutSrc,
    /sosOverlay:\s*{\s*position:\s*'absolute',\s*right:\s*16,\s*zIndex:\s*50\s*}/,
  );
});

test('the overlay frame centers its capped inner box on web, matching chatStyles\' own centering pattern', () => {
  assert.match(layoutSrc, /sosOverlayFrame:\s*{[^}]*alignItems:\s*'center'/s);
  assert.match(layoutSrc, /sosOverlayInner:\s*{[^}]*alignItems:\s*'flex-end'/s);
});
