/**
 * v2.2 rollout — phase 9 (Head Out, look only, flag OFF). Owned by #65.
 *
 * Behind EXPO_PUBLIC_UI_V22_P9 (default OFF):
 * - one name on all four Head Out screens: "Head out safely"
 * - active journey: green "Sharing is on" banner from existing state only
 * - 48 px minimum on the two 44 px Head Out controls
 * - FAB-safe bottom gutter on every Head Out scroll view
 * Presentation only: no journey logic, alerts or server calls change
 * (asserted below: every fetch/endpoint string in Head Out is identical in
 * count with or without the P9 additions).
 *
 * Run with: node --test src/__tests__/v22_p9_head_out.test.mjs
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
const files = {
  destination: read('app', 'women', 'head-out', 'destination.tsx'),
  radius: read('app', 'women', 'head-out', 'radius.tsx'),
  circle: read('app', 'women', 'head-out', 'circle.tsx'),
  active: read('app', 'women', 'head-out', 'index.tsx'),
};

test('flag defaults OFF and the gutter clears the floating-button band', () => {
  assert.match(flags, /export const UI_V22_P9 = process\.env\.EXPO_PUBLIC_UI_V22_P9 === 'true';/);
  const g = Number((flags.match(/export const HEADOUT_FAB_SAFE_GUTTER = (\d+);/) || [])[1]);
  // Issue reporter default top edge = bottom + 196 + 48 = 244; Help pill bottom + 140.
  assert.ok(g >= 244, `gutter ${g} must clear 244 px`);
});

test('one name: wizard steps say "Head out safely" with the flag on, old titles with it off', () => {
  for (const k of ['destination', 'radius']) {
    assert.match(files[k], /title=\{UI_V22_P9 \? 'Head out safely' : 'Head Out'\}/, k);
  }
  assert.match(files.circle, /title=\{UI_V22_P9 \? 'Head out safely' : 'Trusted Circle & Rules'\}/);
  assert.match(files.active, /title="Head out safely"/); // already the name on the active screen
});

test('every Head Out scroll view uses the shared gutter helper', () => {
  for (const [k, src] of Object.entries(files)) {
    assert.match(src, /paddingBottom: insets\.bottom \+ headOutBottomGutter\(\d+\)/, k);
    assert.match(src, /import \{ UI_V22_P9, headOutBottomGutter \} from '@\/src\/uiV22Flags';/, k);
  }
});

test('260 px gutter only with P9 on and the bottom dock off; dock on keeps each screen\'s base padding', () => {
  // With UI_V22_DOCK the floating buttons take real layout space (#105), so
  // the big gutter would only add empty scroll room.
  assert.match(flags, /export function headOutBottomGutter\(base: number\): number \{\s*\n\s*return UI_V22_P9 && !UI_V22_DOCK \? HEADOUT_FAB_SAFE_GUTTER : base;/);
  assert.ok(flags.indexOf('export const UI_V22_DOCK') < flags.indexOf('export function headOutBottomGutter'),
    'helper must come after the DOCK flag it reads');
  // Wizard steps keep 110 (clears their fixed footer); active screen 32.
  for (const k of ['destination', 'radius', 'circle']) assert.match(files[k], /headOutBottomGutter\(110\)/, k);
  assert.match(files.active, /headOutBottomGutter\(32\)/);
});

test('"Sharing is on" banner only from existing state, gated by P9', () => {
  assert.match(files.active,
    /\{UI_V22_P9 && journeyToken && hasCircleRecipients && !sharingRevoked && !pendingRevoke && \(\s*\n\s*<View style=\{styles\.sharingOnBanner\} testID="headout-sharing-on"/);
  assert.match(files.active, /sharingOnBanner: \{[\s\S]*?minHeight: 48/);
});

test('48 px minimum on the two 44 px Head Out controls under P9', () => {
  assert.equal((files.active.match(/minHeight: UI_V22_P9 \? 48 : 44/g) || []).length, 2);
  assert.doesNotMatch(files.active, /minHeight: 44[,\s]/);
});

test('presentation only: server calls in Head Out are unchanged', () => {
  // Endpoints the active screen talks to; the P9 additions must not add any.
  const apiCalls = (files.active.match(/\$\{API_BASE\}\/api\//g) || []).length;
  const p9Blocks = (files.active.match(/UI_V22_P9[\s\S]{0,400}?\$\{API_BASE\}/g) || []).length;
  assert.ok(apiCalls > 0);
  assert.equal(p9Blocks, 0, 'no API call may sit inside a P9 block');
});
