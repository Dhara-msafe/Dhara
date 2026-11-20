/**
 * A09 — the last-gasp upload must never send a made-up or stale location.
 *
 * Reported in the location code review (19 Nov 2026): when the app leaves
 * the foreground during a Head Out journey, app/women/head-out/index.tsx
 * uploaded whatever src/safety/locationCache.ts returned. That cache never
 * returns null: with nothing stored it returns a hardcoded demo coordinate
 * (Chennai city centre, source 'demo'). The trusted circle could be shown a
 * place the traveller has never been.
 *
 * The emergency-SMS path in the same file already refuses a demo fix
 * (`cached.source !== 'demo'`). This brings the last-gasp upload in line and
 * also refuses a stale fix, because the server stamps uploads with its own
 * receive time and an old point would look fresh.
 *
 * Two layers:
 *   1. Pure-logic tests of isUploadableLastGaspFix (runs in plain Node).
 *   2. Source-level wiring checks on index.tsx, which imports react-native
 *      and cannot run directly in Node (same convention as the B-96 test).
 *
 * Run: node --experimental-strip-types src/__tests__/a09_last_gasp_no_fake_location.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isUploadableLastGaspFix, LAST_GASP_MAX_AGE_MS } from '../safety/lastGaspGuard.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); console.log(`  ✅  ${label}`); passed++; }
  catch (e) { console.log(`  ❌  ${label}\n      ${e.message}`); failed++; }
}

const NOW = Date.parse('2026-11-20T12:00:00.000Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const fix = (over = {}) => ({ lat: 17.385, lng: 78.4867, capturedAt: iso(30_000), source: 'gps', ...over });

console.log('\n── A09 — guard logic ───────────────────────────────────────────');

test('a fresh device fix is uploadable', () => {
  assert.equal(isUploadableLastGaspFix(fix(), NOW), true);
});

test('the demo fallback is never uploadable, even when "fresh"', () => {
  // This is exactly what getLastLocation() returns on an empty cache.
  const demo = { lat: 13.0827, lng: 80.2707, capturedAt: iso(0), source: 'demo' };
  assert.equal(isUploadableLastGaspFix(demo, NOW), false);
});

test('a server-seeded point is not re-uploaded as a new fix', () => {
  assert.equal(isUploadableLastGaspFix(fix({ source: 'server' }), NOW), false);
});

test('an unknown source is refused', () => {
  assert.equal(isUploadableLastGaspFix(fix({ source: 'cached' }), NOW), false);
  assert.equal(isUploadableLastGaspFix(fix({ source: undefined }), NOW), false);
});

test('a fix exactly at the age limit is allowed; one millisecond older is not', () => {
  assert.equal(isUploadableLastGaspFix(fix({ capturedAt: iso(LAST_GASP_MAX_AGE_MS) }), NOW), true);
  assert.equal(isUploadableLastGaspFix(fix({ capturedAt: iso(LAST_GASP_MAX_AGE_MS + 1) }), NOW), false);
});

test('the age limit is 10 minutes', () => {
  assert.equal(LAST_GASP_MAX_AGE_MS, 10 * 60 * 1000);
});

test('a fix from hours ago is refused', () => {
  assert.equal(isUploadableLastGaspFix(fix({ capturedAt: iso(3 * 60 * 60 * 1000) }), NOW), false);
});

test('a capture time far in the future is refused (wrong phone clock)', () => {
  assert.equal(isUploadableLastGaspFix(fix({ capturedAt: iso(-5 * 60 * 1000) }), NOW), false);
});

test('a capture time a few seconds ahead is tolerated', () => {
  assert.equal(isUploadableLastGaspFix(fix({ capturedAt: iso(-5_000) }), NOW), true);
});

test('a missing or unreadable capture time is refused', () => {
  assert.equal(isUploadableLastGaspFix(fix({ capturedAt: '' }), NOW), false);
  assert.equal(isUploadableLastGaspFix(fix({ capturedAt: 'not a date' }), NOW), false);
  assert.equal(isUploadableLastGaspFix(fix({ capturedAt: undefined }), NOW), false);
});

test('invalid coordinates are refused', () => {
  assert.equal(isUploadableLastGaspFix(fix({ lat: NaN }), NOW), false);
  assert.equal(isUploadableLastGaspFix(fix({ lat: 91 }), NOW), false);
  assert.equal(isUploadableLastGaspFix(fix({ lng: -181 }), NOW), false);
  assert.equal(isUploadableLastGaspFix(fix({ lat: '17.385' }), NOW), false);
});

test('null and undefined are refused', () => {
  assert.equal(isUploadableLastGaspFix(null, NOW), false);
  assert.equal(isUploadableLastGaspFix(undefined, NOW), false);
});

console.log('\n── A09 — wiring in head-out/index.tsx ──────────────────────────');

const headOutSrc = readFileSync(join(__dirname, '../../app/women/head-out/index.tsx'), 'utf8');
const cacheSrc = readFileSync(join(__dirname, '../safety/locationCache.ts'), 'utf8');

test('index.tsx imports the guard', () => {
  assert.match(headOutSrc, /import \{ isUploadableLastGaspFix \} from '@\/src\/safety\/lastGaspGuard';/);
});

test('the guard runs between reading the cache and the last-gasp upload', () => {
  const read = headOutSrc.indexOf('const cached = await getLastLocation(uid);');
  const guard = headOutSrc.indexOf('if (!isUploadableLastGaspFix(cached)) return;');
  const upload = headOutSrc.indexOf('await lastGaspUploadRef.current(');
  assert.ok(read > -1, 'cache read not found');
  assert.ok(guard > -1, 'guard not found');
  assert.ok(upload > -1, 'last-gasp upload call not found');
  assert.ok(read < guard && guard < upload, 'guard must sit between the cache read and the upload');
});

test('there is exactly one last-gasp upload call site, and it is guarded', () => {
  const calls = headOutSrc.split('lastGaspUploadRef.current(').length - 1;
  assert.equal(calls, 1);
});

test('the cache still returns a demo entry on empty (so the guard is what protects the upload)', () => {
  // If this ever changes, revisit the guard rather than deleting it.
  assert.match(cacheSrc, /source:\s+'demo'/);
  assert.match(cacheSrc, /return _demoEntry\(\);/);
});

test('the emergency-SMS path keeps its own demo guard', () => {
  assert.match(headOutSrc, /cached\.source !== 'demo' && cached\.plusCode/);
});

console.log(`\n  ${passed} passed   ${failed} failed   ${passed + failed} total\n`);
if (failed > 0) process.exit(1);
