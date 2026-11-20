/**
 * A40 — save real GPS fixes to the on-phone store, and clear them.
 *
 * Found while fixing A09 (20 Nov 2026): src/safety/locationCache.ts had a
 * working save function and a working clear function, but nothing in the app
 * ever called either. The store was therefore always empty, getLastLocation()
 * always returned its demo fallback, and three features could never use a
 * real location: the last-gasp upload, the Plus Code in her own alert SMS,
 * and the Plus Code card in My Safety Plan.
 *
 * This change adds the missing calls:
 *   1. useJourneyGPS saves each real fix (at most once per 20 s).
 *   2. head-out/index.tsx clears the store when the journey ends.
 *   3. auth.tsx clears the store on sign-out.
 *
 * The files below import react-native / expo modules and cannot run in plain
 * Node, so these are source-level wiring checks (same convention as the B-96
 * and A09 tests), plus a logic check that a fix saved the A40 way is accepted
 * by the A09 guard.
 *
 * Run: node --experimental-strip-types src/__tests__/a40_save_real_fix_on_phone.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isUploadableLastGaspFix } from '../safety/lastGaspGuard.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); console.log(`  ✅  ${label}`); passed++; }
  catch (e) { console.log(`  ❌  ${label}\n      ${e.message}`); failed++; }
}
const read = (rel) => readFileSync(join(__dirname, rel), 'utf8');
const hookSrc    = read('../hooks/useJourneyGPS.ts');
const headOutSrc = read('../../app/women/head-out/index.tsx');
const authSrc    = read('../auth.tsx');
const cacheSrc   = read('../safety/locationCache.ts');

console.log('\n── A40 — real fixes are saved (useJourneyGPS.ts) ───────────────');

test('the hook imports the store', () => {
  assert.match(hookSrc, /import \{ cacheLocation \} from '@\/src\/safety\/locationCache';/);
});

test('each saved fix is marked as a real device fix', () => {
  const block = hookSrc.slice(hookSrc.indexOf('void cacheLocation('), hookSrc.indexOf('const area = await geocode('));
  assert.ok(block.length > 0, 'cacheLocation call not found before the area lookup');
  assert.match(block, /source: 'gps'/);
  assert.match(block, /lat: latitude/);
  assert.match(block, /lng: longitude/);
});

test('the fix is saved before the area lookup, which can fail offline', () => {
  const save = hookSrc.indexOf('void cacheLocation(');
  const geo  = hookSrc.indexOf('const area = await geocode(latitude, longitude);');
  const push = hookSrc.indexOf('await pushUpdate(latitude, longitude');
  assert.ok(save > -1 && geo > -1 && push > -1);
  assert.ok(save < geo && geo < push);
});

test('the capture time comes from the fix itself, not from when it was saved', () => {
  assert.match(hookSrc, /pos\.timestamp/);
  assert.match(hookSrc, /capturedAt: new Date\(fixMs\)\.toISOString\(\)/);
});

test('saving is limited to once per interval', () => {
  assert.match(hookSrc, /const CACHE_INTERVAL_MS = 20_000;/);
  assert.match(hookSrc, /if \(nowMs - lastCached\.current >= CACHE_INTERVAL_MS\)/);
});

test('the store is keyed by the signed-in user', () => {
  assert.match(hookSrc, /const \{ token: authToken, user \} = useAuth\(\);/);
  assert.match(hookSrc, /userIdRef\.current = user\?\.id \?\? 'anon'/);
  assert.match(hookSrc, /cacheLocation\(userIdRef\.current,/);
});

test('saving does not change the upload sent to the server', () => {
  assert.match(hookSrc, /body: JSON\.stringify\(\{ lat, lng, accuracy, area \}\)/);
});

console.log('\n── A40 — cleared when the journey ends (head-out/index.tsx) ────');

test('index.tsx imports the clear function', () => {
  assert.match(headOutSrc, /import \{ getLastLocation, clearLocationCache \} from '@\/src\/safety\/locationCache';/);
});

test('endSession clears the store before the session is dropped', () => {
  const start = headOutSrc.indexOf('const endSession = useCallback(async () => {');
  const end   = headOutSrc.indexOf('}, [authToken, journeyToken, user]);', start);
  assert.ok(start > -1 && end > -1, 'endSession not found with the expected dependencies');
  const body = headOutSrc.slice(start, end);
  const clear = body.indexOf('await clearLocationCache(');
  const drop  = body.indexOf('setSession(null);');
  assert.ok(clear > -1, 'clear call missing from endSession');
  assert.ok(clear < drop, 'clear must run before setSession(null)');
});

test('the store is cleared in exactly one place in index.tsx (journey end only)', () => {
  // Not on a missed check-in: she may still need the Plus Code for her SMS.
  assert.equal(headOutSrc.split('clearLocationCache(').length - 1, 1);
});

console.log('\n── A40 — cleared on sign-out (auth.tsx) ────────────────────────');

test('auth.tsx imports the clear function', () => {
  assert.match(authSrc, /import \{ clearLocationCache \} from '\.\/safety\/locationCache';/);
});

test('logout clears the departing user and the signed-out slot', () => {
  const start = authSrc.indexOf('const logout = async () => {');
  const end   = authSrc.indexOf('setUser(null);', start);
  const body  = authSrc.slice(start, end);
  assert.match(body, /if \(user\?\.id\) await clearLocationCache\(user\.id\);/);
  assert.match(body, /await clearLocationCache\('anon'\);/);
});

test('the clear runs before the user is dropped from state', () => {
  const start = authSrc.indexOf('const logout = async () => {');
  const clear = authSrc.indexOf("await clearLocationCache('anon');", start);
  const drop  = authSrc.indexOf('setUser(null);', start);
  assert.ok(clear > -1 && clear < drop);
});

console.log('\n── A40 + A09 — a saved fix is usable, the fallback is not ──────');

const NOW = Date.parse('2026-11-20T12:00:00.000Z');

test('a fix saved the A40 way passes the A09 guard while it is recent', () => {
  const saved = { lat: 17.4652, lng: 78.3488, accuracyM: 12, capturedAt: new Date(NOW - 45_000).toISOString(), source: 'gps' };
  assert.equal(isUploadableLastGaspFix(saved, NOW), true);
});

test('the same fix is refused once it is older than 10 minutes', () => {
  const saved = { lat: 17.4652, lng: 78.3488, accuracyM: 12, capturedAt: new Date(NOW - 11 * 60_000).toISOString(), source: 'gps' };
  assert.equal(isUploadableLastGaspFix(saved, NOW), false);
});

test('after a clear the store falls back to demo, which the guard refuses', () => {
  assert.match(cacheSrc, /return _demoEntry\(\);/);
  const demo = { lat: 13.0827, lng: 80.2707, accuracyM: null, capturedAt: new Date(NOW).toISOString(), source: 'demo' };
  assert.equal(isUploadableLastGaspFix(demo, NOW), false);
});

console.log(`\n  ${passed} passed   ${failed} failed   ${passed + failed} total\n`);
if (failed > 0) process.exit(1);
