// v2.2 Batch 4 audit (S9 Me & settings, S10 Entry): locks in confirmed-correct
// behaviour for the 7 of 8 screens that needed no code change.
// Run: node --experimental-strip-types --test src/__tests__/v22_s9_s10_audit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, ...p.split('/')), 'utf8');

// ── Me (manifest ids 19/44, app/(tabs)/me.tsx) ──────────────────────────────
test('Me screen already uses the shared v2.2 theme tokens, not hardcoded colours', () => {
  const me = read('app/(tabs)/me.tsx');
  assert.match(me, /import\s*\{\s*theme\s*\}\s*from\s*['"]@\/src\/theme['"]/);
  assert.match(me, /backgroundColor:\s*c\.background/);
  assert.match(me, /backgroundColor:\s*c\.navy/);
});

test('Me screen has no fake/sample personal details — name and email come from the signed-in user', () => {
  const me = read('app/(tabs)/me.tsx');
  assert.match(me, /const name = user\?\.name \|\| tr\('me\.guest', lang\)/);
  assert.match(me, /user\?\.email \|\| tr\('me\.guest', lang\)/);
});

// ── Edit profile (manifest id45, "Sample personal details removed") ────────
test('Edit profile has no hardcoded sample name or email', () => {
  const edit = read('app/edit-profile.tsx');
  assert.match(edit, /useState\(user\?\.name \|\| ''\)/);
  assert.match(edit, /user\?\.email \|\| '—'/);
  assert.doesNotMatch(edit, /Jane Doe|john@example|jane@example|test@|sample/i);
});

// ── Data privacy (manifest id46, "no blanket on-device or end-to-end claims") ─
test('Data privacy already uses the qualified "servers (encrypted at rest)" wording, no blanket claims', () => {
  const priv = read('app/settings/data-privacy.tsx');
  assert.match(priv, /stored on DHARA\\'s servers \(encrypted at rest\)/);
  assert.doesNotMatch(priv, /end-to-end|on-device only|never leaves your (phone|device)/i);
});

// ── Me and settings (app/(tabs)/settings.tsx) — no manifest id of its own ──
test('Settings tab has no overclaiming copy (audited despite no manifest entry)', () => {
  const settings = read('app/(tabs)/settings.tsx');
  assert.doesNotMatch(settings, /encrypted|guarantee|never leaves|end-to-end/i);
});

// ── DHARA splash (manifest id1) ─────────────────────────────────────────────
test('Splash is a minimal logo+spinner screen with no footnote/tagline text to correct', () => {
  const splash = read('app/index.tsx');
  assert.match(splash, /testID="splash-screen"/);
  assert.doesNotMatch(splash, /<Text/);
});

// ── How DHARA helps (manifest id3, excluded) ────────────────────────────────
test('How DHARA helps was already built fresh from the corrected mockup copy', () => {
  const welcome = read('app/how-it-helps.tsx');
  assert.match(welcome, /no\s*\*?\s*encryption\/offline overclaims/);
});

// ── Choose state (manifest id5) ─────────────────────────────────────────────
test('Choose state already has a selected-row checkmark and the shared contrast token', () => {
  const state = read('app/state.tsx');
  assert.match(state, /name="checkmark-circle"/);
  assert.match(state, /onSurfaceSecondary/);
});

test('Choose state\'s sub-48px touch target (skip/cancel) is already raised by the existing UI_REVISION_V1 flag', () => {
  const state = read('app/state.tsx');
  assert.match(state, /minHeight:\s*UI_REVISION_V1 \? 48 : 44/);
});
