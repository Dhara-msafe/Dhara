/**
 * B-86 — "Visitor pages break when opened directly by URL/refresh."
 * Tracker description: screens spin forever if opened directly with no
 * session; wording issue "Yes, I'm a citizen of British High Commission";
 * state picker silently defaults to Maharashtra.
 *
 * Source-level wiring test (no RN renderer available in plain Node): reads
 * the real .ts/.tsx source and asserts on its text content, following the
 * convention used by the other B-xx wiring tests in this folder.
 *
 * Three sub-fixes, verified independently:
 *
 * 1. Infinite spinner on a direct hit / refresh — intent.tsx, emergency.tsx
 *    and lost-passport.tsx used to gate on `if (!session) return <spinner>`,
 *    fed by a plain `loadVisitorSession().then(setSession)` useEffect. That
 *    can't tell "still loading" apart from "confirmed no session ever
 *    saved", so a visitor who landed directly on e.g. /visitor/emergency
 *    (no prior /visitor setup) saw a spinner that never went away. Fixed by
 *    a new src/visitor/session.ts hook, useVisitorSessionOrRedirect(), that
 *    tracks loading/found/missing as three distinct states and calls
 *    router.replace('/visitor') only once status resolves to "missing" --
 *    wired into all three screens.
 *
 * 2. Embassy wording -- lost-passport.tsx used to build "Yes, I'm a citizen
 *    of {suggestedEmb.name.replace(/^(The |Embassy of |Embassy |High
 *    Commission)/i, '')}", which strips the regex but not the rest of an
 *    institution name ("British High Commission" -> "British" survives,
 *    but others like "Embassy of the United States" degrade oddly). Fixed
 *    by adding an explicit countryAdjective field to every
 *    EMBASSY_CONTACTS entry in content.ts and using that directly.
 *
 * 3. Maharashtra default -- visitor/index.tsx's state picker used to start
 *    at useState(INDIAN_STATES[0]) (Maharashtra is first in the array), so
 *    a visitor who never opened the picker silently got Maharashtra's
 *    local-language phrases. Fixed by starting with no state selected and
 *    blocking "Get Help" until one is explicitly chosen.
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

const sessionSrc      = readFileSync(join(__dirname, '../visitor/session.ts'), 'utf8');
const contentSrc      = readFileSync(join(__dirname, '../visitor/content.ts'), 'utf8');
const intentSrc       = readFileSync(join(__dirname, '../../app/visitor/intent.tsx'), 'utf8');
const emergencySrc    = readFileSync(join(__dirname, '../../app/visitor/emergency.tsx'), 'utf8');
const lostPassportSrc = readFileSync(join(__dirname, '../../app/visitor/lost-passport.tsx'), 'utf8');
const visitorIndexSrc = readFileSync(join(__dirname, '../../app/visitor/index.tsx'), 'utf8');

console.log('\n── 1. Direct-URL / refresh redirect (no infinite spinner) ──────');

test('session.ts exports useVisitorSessionOrRedirect with distinct loading/found/missing states', () => {
  assert.ok(sessionSrc.includes('export function useVisitorSessionOrRedirect'));
  assert.ok(/\{ kind: 'loading' \}/.test(sessionSrc));
  assert.ok(/\{ kind: 'found'; session: VisitorSession \}/.test(sessionSrc));
  assert.ok(/\{ kind: 'missing' \}/.test(sessionSrc));
});

test('the hook redirects to /visitor only once status is confirmed "missing", not while still loading', () => {
  const idx = sessionSrc.indexOf('export function useVisitorSessionOrRedirect');
  const body = sessionSrc.slice(idx, idx + 1200);
  assert.ok(body.includes("if (status.kind === 'missing') router.replace('/visitor');"));
  // Must not redirect unconditionally / while loading.
  assert.ok(!/router\.replace\('\/visitor'\);\s*\n\s*\}, \[\]\)/.test(body));
});

for (const [name, src] of [
  ['intent.tsx', intentSrc],
  ['emergency.tsx', emergencySrc],
  ['lost-passport.tsx', lostPassportSrc],
]) {
  test(`${name} uses useVisitorSessionOrRedirect() instead of the old manual loadVisitorSession().then(setSession) pattern`, () => {
    assert.ok(src.includes('useVisitorSessionOrRedirect'), `${name} should import/call the new hook`);
    assert.ok(src.includes('const session = useVisitorSessionOrRedirect();'), `${name} should assign session from the hook`);
    assert.ok(!/loadVisitorSession\(\)\.then\(s => setSession\(s\)\)/.test(src), `${name} should no longer call loadVisitorSession().then(setSession) directly for its session state`);
  });
  test(`${name} still has a loading/redirecting fallback while session is null`, () => {
    assert.ok(/if \(!session\) \{/.test(src), `${name} should still gate its main render on session being present`);
  });
}

test('lost-passport.tsx keeps its separate embassy-key AsyncStorage read working alongside the new hook', () => {
  assert.ok(lostPassportSrc.includes("AsyncStorage.getItem(EMBASSY_KEY_STORAGE)"));
});

console.log('\n── 2. Embassy wording fix ("Yes, I\'m a citizen of...") ─────────');

test('every EMBASSY_CONTACTS entry has a countryAdjective field', () => {
  const idx = contentSrc.indexOf('EMBASSY_CONTACTS');
  assert.ok(idx !== -1, 'EMBASSY_CONTACTS should exist in content.ts');
  const block = contentSrc.slice(idx, idx + 2500);
  const nameCount = (block.match(/name:\s*'/g) || []).length;
  const adjCount = (block.match(/countryAdjective:\s*'/g) || []).length;
  assert.ok(nameCount > 0, 'expected at least one embassy entry');
  assert.equal(adjCount, nameCount, 'every embassy entry with a name should also have a countryAdjective');
});

test('lost-passport.tsx renders countryAdjective, not the old name-stripping regex', () => {
  assert.ok(lostPassportSrc.includes('suggestedEmb.countryAdjective'));
  assert.ok(!/suggestedEmb\.name\.replace\(\/\^/.test(lostPassportSrc), 'the broken regex-stripped name should be gone');
});

console.log('\n── 3. State picker no longer silently defaults to Maharashtra ─────');

test('visitor/index.tsx starts with no state selected instead of INDIAN_STATES[0]', () => {
  assert.ok(/useState<typeof INDIAN_STATES\[number\] \| null>\(null\)/.test(visitorIndexSrc));
  assert.ok(!/useState\(INDIAN_STATES\[0\]\)/.test(visitorIndexSrc), 'should no longer default to the first state in the array (Maharashtra)');
});

test('proceed() blocks and reopens the picker when no state has been chosen', () => {
  const idx = visitorIndexSrc.indexOf('const proceed = useCallback');
  const body = visitorIndexSrc.slice(idx, idx + 600);
  assert.ok(body.includes('if (!selectedState) {'));
  assert.ok(body.includes('setShowStatePicker(true)'));
});

test('the state picker shows a neutral placeholder, not a pre-chosen state name, until one is picked', () => {
  assert.ok(visitorIndexSrc.includes("selectedState ? selectedState.name : 'Select your state'"));
});

console.log(`\n${'═'.repeat(60)}`);
console.log(`  ${passed} passed   ${failed} failed   ${passed + failed} total`);
if (failed > 0) process.exit(1);
