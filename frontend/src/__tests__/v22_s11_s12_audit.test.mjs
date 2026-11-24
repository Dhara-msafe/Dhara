// v2.2 Batch 5 audit (S11 Family & visitor, S12 Advocate): locks in
// confirmed-correct behaviour for the 6 of 7 screens that needed no code
// change.
// Run: node --experimental-strip-types --test src/__tests__/v22_s11_s12_audit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, ...p.split('/')), 'utf8');

// ── Family journey (manifest id39, "Renamed 'Support a family member'") ────
test('Family journey hub is already titled "Support a family member"', () => {
  const hub = read('app/family-journey/index.tsx');
  assert.match(hub, /<JourneyHeader title="Support a family member"/);
});

test('Family journey has no court-update / legal-case-tracking content', () => {
  const hub = read('app/family-journey/index.tsx');
  assert.doesNotMatch(hub, /court update|case tracking|legal.case/i);
});

// ── Family contacts (manifest id40, "Labelled icon buttons; 48px targets") ──
test('Family Journey shared chrome already labels every icon button', () => {
  const ui = read('src/familyJourney/ui.tsx');
  assert.match(ui, /accessibilityLabel="Go back"/);
  assert.match(ui, /accessibilityLabel="Emergency help"/);
  assert.match(ui, /accessibilityLabel="Legal help"/);
});

test('Family Journey shared chrome\'s touch targets are already raised to 48px via the pre-existing UI_REVISION_V1 flag', () => {
  const ui = read('src/familyJourney/ui.tsx');
  assert.match(ui, /back:\s*\{\s*width:\s*UI_REVISION_V1 \? 48 : 44,\s*height:\s*UI_REVISION_V1 \? 48 : 44/);
  assert.match(ui, /minHeight:\s*UI_REVISION_V1 \? 48 : 44/);
});

// ── Visitor help (manifest id53, "Visual only") ─────────────────────────────
test('Visitor help already uses the shared theme token (primary === navy), not a hardcoded colour', () => {
  const visitor = read('app/visitor/index.tsx');
  assert.match(visitor, /const C = theme\.colors/);
  assert.match(visitor, /backgroundColor:\s*C\.primary/);
});

test('Visitor help\'s touch targets are already raised to 48px via the pre-existing UI_REVISION_V1 flag', () => {
  const visitor = read('app/visitor/index.tsx');
  assert.match(visitor, /minHeight:\s*UI_REVISION_V1 \? 48 : undefined/);
});

// ── Find advocate / Advocate profile / Case notes (ids 49/50/51, deferred) ──
test('Find advocate, Advocate profile and Case notes are all already gated behind ADVOCATE_MODE_ENABLED', () => {
  const register = read('app/advocate-register.tsx');
  const lawyer = read('app/lawyer-home.tsx');
  const notetaker = read('app/notetaker/index.tsx');
  for (const f of [register, lawyer, notetaker]) {
    assert.match(f, /import\s*\{\s*ADVOCATE_MODE_ENABLED\s*\}\s*from\s*['"]@\/src\/advocateMode\/flags['"]/);
    assert.match(f, /if \(!ADVOCATE_MODE_ENABLED\) return <Redirect/);
  }
});

test('Advocate profile\'s verified badge reads a real API fetch, not sample ratings or a "cases won" count', () => {
  const lawyer = read('app/lawyer-home.tsx');
  assert.match(lawyer, /fetch\(`\$\{API_BASE\}\/api\/advocate\/profile\/\$\{user\.id\}`/);
  assert.doesNotMatch(lawyer, /rating|cases won|★/i);
});
