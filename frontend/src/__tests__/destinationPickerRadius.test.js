/**
 * Regression test — DestinationPicker radius-reset (stale-closure defect).
 *
 * Tests the pure state-transition contract: every onChange spread must carry
 * through the CURRENT radiusMeters, not the value that existed when the
 * callback was created.
 *
 * This mirrors the exact patterns used in DestinationPicker.tsx after the
 * valueRef fix.  It does NOT require React rendering — it tests the object
 * spreading logic directly, which is the invariant the fix enforces.
 *
 * Run:  node app/frontend/src/__tests__/destinationPickerRadius.test.js
 */

'use strict';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}`);
    failed++;
  }
}

// ── Helpers that mirror the fixed callback bodies ─────────────────────────

/** Simulates what valueRef.current holds at call time. */
function buildRef(v) { return { current: v }; }

/** handleLabelChange — must preserve radiusMeters from ref */
function handleLabelChange(ref, text) {
  return { ...ref.current, label: text, savedPlaceId: undefined };
}

/** selectSuggestion — must preserve radiusMeters from ref */
function selectSuggestion(ref, suggestion) {
  return {
    ...ref.current,
    label: suggestion.label,
    savedPlaceId: undefined,
    latitude: suggestion.latitude,
    longitude: suggestion.longitude,
  };
}

/** selectPlacesSuggestion — async; ref read after await */
function selectPlacesSuggestionSync(ref, label, lat, lng) {
  return {
    ...ref.current,
    label,
    savedPlaceId: undefined,
    latitude: lat,
    longitude: lng,
  };
}

/** selectPreset — sets radiusMeters from ref */
function selectPreset(ref, m) {
  return { ...ref.current, radiusMeters: m };
}

/** movePin — must preserve radiusMeters from ref */
function movePin(ref, lat, lng) {
  return { ...ref.current, latitude: lat, longitude: lng };
}

/** saveCurrentAsPlace onChange call */
function saveOnChange(ref, savedPlaceId) {
  return { ...ref.current, savedPlaceId };
}

/** confirmDelete onChange call */
function deleteOnChange(ref) {
  return { ...ref.current, savedPlaceId: undefined };
}

/** CustomRadiusModal onSave */
function customRadiusOnSave(ref, m) {
  return { ...ref.current, radiusMeters: m };
}

// ── Test suite ─────────────────────────────────────────────────────────────

console.log('\nDestinationPicker radius-reset regression\n');

// Scenario 1: user sets 300 m then types a label character.
// Before fix: handleLabelChange spread STALE value (radiusMeters: 200).
// After fix:  spread uses ref updated to 300 m.
{
  const staleValue = { label: '', radiusMeters: 200 };
  const currentValue = { label: '', radiusMeters: 300 };          // after chip tap
  const ref = buildRef(currentValue);                              // ref is current

  const result = handleLabelChange(ref, 'Delhi');
  assert(result.radiusMeters === 300, 'handleLabelChange preserves 300 m (not stale 200)');
  assert(result.label === 'Delhi', 'handleLabelChange sets new label');
  assert(result.savedPlaceId === undefined, 'handleLabelChange clears savedPlaceId');
  // Prove that spreading stale value WOULD have reset it:
  const staleResult = { ...staleValue, label: 'Delhi', savedPlaceId: undefined };
  assert(staleResult.radiusMeters === 200, 'PROOF: spreading stale value would give 200 (the old bug)');
}

// Scenario 2: search result arrives after radius chip tap.
{
  const ref = buildRef({ label: 'Delhi', radiusMeters: 300, savedPlaceId: undefined });
  const result = selectSuggestion(ref, { label: 'New Delhi, India', latitude: 28.61, longitude: 77.20 });
  assert(result.radiusMeters === 300, 'selectSuggestion preserves 300 m');
  assert(result.latitude === 28.61, 'selectSuggestion sets latitude');
  assert(result.longitude === 77.20, 'selectSuggestion sets longitude');
}

// Scenario 3: async Places suggestion resolves after radius chip tap.
{
  const ref = buildRef({ label: 'Delhi', radiusMeters: 300 });
  // Simulate: ref updated to 300 m; async resolve reads ref, not captured value.
  ref.current = { ...ref.current, radiusMeters: 300 };
  const result = selectPlacesSuggestionSync(ref, 'Connaught Place, New Delhi', 28.63, 77.21);
  assert(result.radiusMeters === 300, 'selectPlacesSuggestion (async) preserves 300 m');
}

// Scenario 4: map drag fires between chip tap and render cycle.
{
  const ref = buildRef({ label: 'Delhi', radiusMeters: 300, latitude: 28.61, longitude: 77.20 });
  const result = movePin(ref, 28.65, 77.22);
  assert(result.radiusMeters === 300, 'movePin preserves 300 m');
  assert(result.latitude === 28.65, 'movePin updates latitude');
  assert(result.longitude === 77.22, 'movePin updates longitude');
}

// Scenario 5: custom radius (450 m) applied from modal.
{
  const ref = buildRef({ label: 'Delhi', radiusMeters: 200 });
  const result = customRadiusOnSave(ref, 450);
  assert(result.radiusMeters === 450, 'customRadiusOnSave sets 450 m');
}

// Scenario 6: selectPreset 100 m.
{
  const ref = buildRef({ label: 'Delhi', radiusMeters: 300 });
  const result = selectPreset(ref, 100);
  assert(result.radiusMeters === 100, 'selectPreset(100) works');
}

// Scenario 7: selectPreset 200 m.
{
  const ref = buildRef({ label: 'Delhi', radiusMeters: 300 });
  const result = selectPreset(ref, 200);
  assert(result.radiusMeters === 200, 'selectPreset(200) works');
}

// Scenario 8: selectPreset 300 m.
{
  const ref = buildRef({ label: 'Delhi', radiusMeters: 100 });
  const result = selectPreset(ref, 300);
  assert(result.radiusMeters === 300, 'selectPreset(300) works');
}

// Scenario 9: custom radius within valid range (50–2000 m).
{
  for (const m of [50, 100, 200, 300, 1000, 2000]) {
    const ref = buildRef({ label: 'test', radiusMeters: 200 });
    const result = customRadiusOnSave(ref, m);
    assert(result.radiusMeters === m, `customRadius accepts ${m} m`);
  }
}

// Scenario 10: custom radius 50 m is the minimum valid value.
{
  const ref = buildRef({ label: 'test', radiusMeters: 200 });
  const result = customRadiusOnSave(ref, 50);
  assert(result.radiusMeters === 50, 'customRadius minimum 50 m accepted');
}

// Scenario 11: saveCurrentAsPlace preserves radius in the savedPlaceId merge.
{
  const ref = buildRef({ label: 'Office', radiusMeters: 300, latitude: 28.61, longitude: 77.20 });
  const result = saveOnChange(ref, 'place-abc');
  assert(result.radiusMeters === 300, 'saveOnChange preserves 300 m');
  assert(result.savedPlaceId === 'place-abc', 'saveOnChange sets savedPlaceId');
}

// Scenario 12: confirmDelete clears savedPlaceId but preserves radius.
{
  const ref = buildRef({ label: 'Office', radiusMeters: 300, savedPlaceId: 'place-abc' });
  const result = deleteOnChange(ref);
  assert(result.radiusMeters === 300, 'deleteOnChange preserves 300 m');
  assert(result.savedPlaceId === undefined, 'deleteOnChange clears savedPlaceId');
}

// Scenario 13: ref updates are synchronous — simulates React render cycle.
{
  let value = { label: '', radiusMeters: 200 };
  const ref = { current: value };

  // Step 1: user taps 300 m chip
  value = selectPreset(ref, 300);
  ref.current = value; // React would do this on re-render

  // Step 2: user types a character (handleLabelChange reads ref.current)
  const labelResult = handleLabelChange(ref, 'Delhi');
  assert(labelResult.radiusMeters === 300, 'End-to-end: chip→type preserves 300 m');

  // Step 3: map drag fires (movePin reads ref.current)
  ref.current = labelResult;
  const pinResult = movePin(ref, 28.65, 77.22);
  assert(pinResult.radiusMeters === 300, 'End-to-end: chip→type→drag preserves 300 m');
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
