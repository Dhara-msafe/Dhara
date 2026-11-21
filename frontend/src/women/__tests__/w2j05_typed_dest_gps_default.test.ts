/** Fix 1 (21 Nov owner finding): a typed label riding on the current-location
 * DEFAULT pin must be geocoded + confirmed at Next, never trusted silently. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const src = readFileSync(join(import.meta.dirname, '..', '..', '..', 'app/women/head-out/destination.tsx'), 'utf8');

test('auto-default coords are flagged and every deliberate choice clears the flag', () => {
  assert.match(src, /const autoDefaultCoordsRef = useRef\(false\)/);
  // L1 added a render-visible mirror between the ref write and the setValue.
  assert.match(src, /autoDefaultCoordsRef\.current = true;\s*\n\s*setCoordsAreDefaultUi\(true\);\s*\n\s*setValue\(v => \(\{ \.\.\.v, latitude: live\.point!/);
  // Every coordsFromSelectionRef assignment (selection, pin, custom, geocode) clears it.
  const assigns = src.match(/coordsFromSelectionRef\.current = (true|false);/g) ?? [];
  const clears = src.match(/autoDefaultCoordsRef\.current = false;/g) ?? [];
  assert.ok(assigns.length > 0 && clears.length >= assigns.length,
    `expected a clear beside each of ${assigns.length} assignments, found ${clears.length}`);
});

test('Next treats default-only coords as unchosen: geocode + confirm, and drops them on a geocode miss', () => {
  assert.match(src, /const coordsAreDefaultOnly = autoDefaultCoordsRef\.current;/);
  assert.match(src, /final\.latitude != null && final\.longitude != null && !coordsAreDefaultOnly/);
  assert.match(src, /await proceed\(\{ \.\.\.final, latitude: null, longitude: null \}\);/);
});
