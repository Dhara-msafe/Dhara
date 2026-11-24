/**
 * v2.2 rollout — step S4 (Shield tools): Safety plan reskin to the dark
 * "Shield mode" palette (memory/dhara_redesign/v2_2/editable_screens/SafetyPlan.dc.html).
 * screen-manifest id 37: "retained ... Visual only" — the Plus Code card,
 * the phone-safety checklist content, and the 8 journal questions (plus
 * save/load logic) are unchanged; this is presentation only.
 * Behind EXPO_PUBLIC_UI_V22_S4 (default OFF, shared with Panic lesson).
 *
 * Source-level tests, v22_s4_panic_lesson.test.mjs convention.
 * Run with: node --experimental-strip-types --test src/__tests__/v22_s4_safety_plan.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const screen = readFileSync(join(root, 'app', 'women', 'safety-plan.tsx'), 'utf8');

test('screen imports the S4 flag and shield palette', () => {
  assert.match(screen, /import \{ UI_V22_S4 \} from '@\/src\/uiV22Flags';/);
  assert.match(screen, /import \{ shieldColors, shieldGradient \} from '@\/src\/shieldTheme';/);
});

test('gradient background only renders with the flag on; flag OFF keeps the plain View', () => {
  assert.match(screen, /if \(UI_V22_S4\) \{\s*\n\s*return \(\s*\n\s*<LinearGradient colors=\{shieldGradient\.colors\}/);
  assert.match(screen, /return <View style=\{styles\.root\}>\{body\}<\/View>;/);
});

test('root style is transparent under the gradient, opaque cream otherwise', () => {
  assert.match(screen, /root: \{ flex: 1, backgroundColor: UI_V22_S4 \? 'transparent' : c\.background \},/);
});

test('Plus Code card, checklist and question cards all switch to the shield card background', () => {
  assert.match(screen, /plusCodeCard: UI_V22_S4 \? \{\s*\n\s*backgroundColor: shieldColors\.cardBg,/);
  assert.match(screen, /checklistHeader: UI_V22_S4 \? \{\s*\n\s*flexDirection: 'row',\s*\n\s*alignItems: 'center',\s*\n\s*backgroundColor: shieldColors\.cardBg,/);
  assert.match(screen, /qCard: UI_V22_S4\s*\n\s*\? \{ backgroundColor: shieldColors\.cardBg,/);
});

test('ScreenHeader (shared navy header) and all data/logic are untouched', () => {
  assert.match(screen, /<ScreenHeader title="My safety plan" subtitle="Private · stored only on this phone" \/>/);
  assert.match(screen, /useEffect\(\(\) => \{ getPlan\(\)\.then\(setAns\); \}, \[\]\);/);
  assert.match(screen, /const save = async \(\) => \{ await savePlan\(ans\); setDone\(true\); setTimeout\(\(\) => router\.back\(\), 1200\); \};/);
  assert.match(screen, /FAILSAFE_ITEMS\.map/);
  assert.match(screen, /QUESTIONS\.map/);
});
