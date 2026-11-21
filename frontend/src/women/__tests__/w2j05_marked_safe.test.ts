/** Fix 6 (owner finding, 21 Nov): "I'm safe" ends on a confirmation screen,
 * and its Done button must land on a REAL route — '/women' is unmatched. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = join(import.meta.dirname, '..', '..', '..');
const src = readFileSync(join(ROOT, 'app/women/head-out/index.tsx'), 'utf8');

test("marked-safe screen exists and only shows after the server confirmed", () => {
  assert.match(src, /headout-marked-safe/);
  assert.match(src, /setSafeConfirmed\(true\);/);
  assert.match(src, /!session && safeConfirmed/);
  // The wizard redirect must not race the confirmation away.
  assert.match(src, /!loading && !session && !safeConfirmed/);
});

test("Done goes to a route that exists; 'Plan another journey' to the wizard", () => {
  assert.match(src, /setSafeConfirmed\(false\); router\.replace\('\/women-shield'\)/);
  assert.ok(existsSync(join(ROOT, 'app/women-shield.tsx')), 'women-shield route file must exist');
  assert.match(src, /setSafeConfirmed\(false\); router\.replace\('\/women\/head-out\/destination'\)/);
  // The old unmatched route must be gone.
  assert.doesNotMatch(src, /router\.replace\('\/women'\)/);
});
