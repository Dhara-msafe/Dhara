/** L1/L2 leftovers (21 Nov, manager GO): source-level wiring checks. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = join(import.meta.dirname, '..', '..', '..');
const dest = readFileSync(join(ROOT, 'app/women/head-out/destination.tsx'), 'utf8');
const active = readFileSync(join(ROOT, 'app/women/head-out/index.tsx'), 'utf8');

test("L1: 'Using your location' only while the pin is the current-location default", () => {
  assert.match(dest, /const \[coordsAreDefaultUi, setCoordsAreDefaultUi\] = useState\(false\)/);
  // Mirror set where the default is placed, cleared beside every deliberate choice.
  assert.match(dest, /autoDefaultCoordsRef\.current = true;\s*\n\s*setCoordsAreDefaultUi\(true\);/);
  const refClears = dest.match(/autoDefaultCoordsRef\.current = false;/g) ?? [];
  const uiClears = dest.match(/setCoordsAreDefaultUi\(false\);/g) ?? [];
  assert.ok(uiClears.length >= refClears.length, `mirror cleared ${uiClears.length} < ref cleared ${refClears.length}`);
  // The pill claims 'Using your location' only in the default case; a chosen
  // destination shows its own name instead.
  assert.match(dest, /live\.status === 'granted' && coordsAreDefaultUi && value\.latitude != null\s*\n\s*\? 'Using your location'/);
  assert.match(dest, /`Destination: \$\{value\.label\.trim\(\)\}`/);
});

test('L2: Need help is always on the active card and only uses existing flows', () => {
  // Circle branch: existing help_requested flow, with honest before/after copy.
  assert.match(active, /testID="headout-need-help"/);
  assert.match(active, /Sends a help alert to the people you picked for this journey\./);
  assert.match(active, /Your Trusted Circle has been asked for help with your latest shared location\./);
  // Empty-circle branch: existing emergency screen, honest about who is NOT told.
  assert.match(active, /testID="headout-need-help-emergency"/);
  assert.match(active, /router\.push\('\/emergency'\)/);
  assert.match(active, /No one in your Trusted Circle is alerted — nobody is selected for this journey\./);
  // No new send path: the only help POST is the existing journey help endpoint.
  const helpPosts = active.match(/\/help`/g) ?? [];
  assert.equal(helpPosts.length, 1, 'exactly one help endpoint reference (the existing one)');
});
