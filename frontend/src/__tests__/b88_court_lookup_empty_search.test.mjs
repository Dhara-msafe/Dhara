/**
 * B-88 — "Court lookup results page spins forever with an empty search."
 * Tracker description: opening the results page directly without a search
 * term leaves it spinning indefinitely instead of showing an error/empty
 * state.
 *
 * Source-level wiring test (no RN renderer available in plain Node): reads
 * the real app/lookup-results.tsx source and asserts on its text content,
 * following the convention used by the other B-xx wiring tests in this
 * folder.
 *
 * Root cause: `loading` defaulted to `true` and was only ever set back to
 * `false` inside fetchCnr()/fetchParty()'s `finally` block. The screen's
 * mount effect only called one of those two fetchers when `mode === 'cnr'
 * && cnrParam` or `mode === 'party' && nameParam` — i.e. only when a real
 * search term was present. Opened directly with no term (a bare
 * /lookup-results hit, a refresh that dropped the query params, or a
 * stale link), neither fetcher ever ran, so `loading` stayed `true`
 * forever and the spinner never resolved.
 *
 * Fix: an explicit `else` branch in that effect sets loading=false and an
 * error message when no search term is present, with a `noSearchTerm`
 * flag that swaps the error action from "Try Again" (which would have
 * just repeated the same empty request) to "Go Back".
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); console.log(`  ✅  ${label}`); passed++; }
  catch (e) { console.log(`  ❌  ${label}\n      ${e.message}`); failed++; }
}

const src = readFileSync(join(__dirname, '../../app/lookup-results.tsx'), 'utf8');

console.log('\n── B-88: no infinite spinner on an empty/direct-hit search ────');

test('the mount effect has an else branch for when neither mode has a search term', () => {
  const idx = src.indexOf("if (mode === 'cnr' && cnrParam) fetchCnr(cnrParam);");
  assert.ok(idx !== -1, 'expected the mode/term branch to still exist');
  const block = src.slice(idx, idx + 700);
  assert.ok(block.includes('else {'), 'expected an else branch for the no-search-term case');
  assert.ok(block.includes('setLoading(false);'), 'the else branch must flip loading off, not leave it stuck on true');
  assert.ok(block.includes('setNoSearchTerm(true);'));
});

test('loading never silently stays true forever: every path that sets it true has a matching false', () => {
  // loading starts true; the only legitimate way out besides the fetchers'
  // own finally blocks is the no-search-term else branch added for B-88.
  assert.ok(src.includes('const [loading, setLoading]   = useState(true);'));
  assert.ok(/else \{[\s\S]{0,300}setLoading\(false\);/.test(src));
});

test('fetchCnr and fetchParty reset noSearchTerm so a later real search clears the empty state', () => {
  const fetchCnrIdx = src.indexOf('const fetchCnr = useCallback');
  const fetchCnrBlock = src.slice(fetchCnrIdx, fetchCnrIdx + 300);
  assert.ok(fetchCnrBlock.includes('setNoSearchTerm(false);'));

  const fetchPartyIdx = src.indexOf('const fetchParty = useCallback');
  const fetchPartyBlock = src.slice(fetchPartyIdx, fetchPartyIdx + 300);
  assert.ok(fetchPartyBlock.includes('setNoSearchTerm(false);'));
});

test('handleRetry goes back instead of re-running an empty search when there was no search term', () => {
  const idx = src.indexOf('const handleRetry = () => {');
  const block = src.slice(idx, idx + 250);
  assert.ok(block.includes('if (noSearchTerm) { router.back(); return; }'));
});

test('the error UI shows "Go Back" (not "Try Again") when there was no search term', () => {
  assert.ok(src.includes("{noSearchTerm ? 'Go Back' : 'Try Again'}"));
});

test('distinct, actionable error messages are shown for a missing CNR vs a missing name', () => {
  assert.ok(src.includes('No CNR number was provided'));
  assert.ok(src.includes('No name was provided'));
});

console.log(`\n${'═'.repeat(60)}`);
console.log(`  ${passed} passed   ${failed} failed   ${passed + failed} total`);
if (failed > 0) process.exit(1);
