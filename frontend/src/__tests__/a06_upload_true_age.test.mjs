/**
 * A06 — every location upload says how old the fix really is.
 *
 * The server stamped each upload with the time it arrived, so a delayed,
 * retried or queued fix looked brand new to the trusted person. The app now
 * sends `age_seconds` (measured at the moment of sending) and `source: 'gps'`
 * on all three upload paths: the live upload, the retry queue, and the
 * last-gasp upload. The server (A07) turns the age into a capture time on its
 * own clock, so a wrong phone clock or time zone cannot distort it.
 *
 * Two layers: pure-logic tests of src/safety/locationUploadBody.ts, and
 * source-level wiring checks on the three call sites (they import
 * react-native / expo modules and cannot run in plain Node).
 *
 * Run: node --experimental-strip-types src/__tests__/a06_upload_true_age.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ageSeconds, buildLocationUploadBody, capturedAtToMs, MAX_AGE_SECONDS } from '../safety/locationUploadBody.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); console.log(`  ✅  ${label}`); passed++; }
  catch (e) { console.log(`  ❌  ${label}\n      ${e.message}`); failed++; }
}
const NOW = Date.parse('2026-11-20T12:00:00.000Z');

console.log('\n── A06 — the age of a fix ──────────────────────────────────────');

test('a fix taken 45 seconds ago is 45 seconds old', () => {
  assert.equal(ageSeconds(NOW - 45_000, NOW), 45);
});
test('a fix that waited 20 minutes in the queue is 1200 seconds old', () => {
  assert.equal(ageSeconds(NOW - 20 * 60_000, NOW), 1200);
});
test('a fix stamped slightly ahead of the clock is 0, never negative', () => {
  assert.equal(ageSeconds(NOW + 3_000, NOW), 0);
});
test('the age is capped at 24 hours, which is what the server accepts', () => {
  assert.equal(MAX_AGE_SECONDS, 86_400);
  assert.equal(ageSeconds(NOW - 3 * 86_400_000, NOW), 86_400);
});
test('an unknown capture time gives null, not a guess', () => {
  for (const v of [null, undefined, NaN, 0, -5, 'yesterday']) assert.equal(ageSeconds(v, NOW), null);
});
test('a wrong phone clock does not change the age', () => {
  // Phone clock is 3 hours fast: both the capture time and "now" are 3 hours
  // ahead, so the difference is still the real 90 seconds.
  const skew = 3 * 3_600_000;
  assert.equal(ageSeconds(NOW - 90_000 + skew, NOW + skew), 90);
});

console.log('\n── A06 — the body sent to the server ───────────────────────────');

const base = { lat: 17.4652, lng: 78.3488, accuracy: 12, area: 'Gachibowli, Hyderabad' };

test('a live fix carries its age and is marked as a real device fix', () => {
  assert.deepEqual(
    buildLocationUploadBody({ ...base, capturedAtMs: NOW - 4_000, nowMs: NOW }),
    { ...base, source: 'gps', age_seconds: 4 },
  );
});
test('unknown capture time: age is left out, source is still sent', () => {
  const body = buildLocationUploadBody({ ...base, capturedAtMs: null, nowMs: NOW });
  assert.ok(!('age_seconds' in body));
  assert.equal(body.source, 'gps');
});
test('a missing or bad accuracy becomes 0, which the server accepts', () => {
  for (const a of [null, undefined, NaN, -3]) {
    assert.equal(buildLocationUploadBody({ ...base, accuracy: a, capturedAtMs: NOW, nowMs: NOW }).accuracy, 0);
  }
});
test('the body never claims any source other than gps', () => {
  assert.equal(buildLocationUploadBody({ ...base, capturedAtMs: NOW, nowMs: NOW }).source, 'gps');
});
test('the age always fits the server rule (0 to 86400)', () => {
  for (const ago of [0, 1, 59_999, 3_600_000, 10 * 86_400_000, -50_000]) {
    const a = buildLocationUploadBody({ ...base, capturedAtMs: NOW - ago, nowMs: NOW }).age_seconds;
    assert.ok(a >= 0 && a <= 86_400, `age ${a} out of range`);
  }
});

console.log('\n── A06 — reading a saved capture time ──────────────────────────');

test('an ISO time from the queue or the phone store is read correctly', () => {
  assert.equal(capturedAtToMs('2026-11-20T11:59:30.000Z'), NOW - 30_000);
});
test('unreadable values give null', () => {
  for (const v of ['', 'not a date', null, undefined, 12345]) assert.equal(capturedAtToMs(v), null);
});

console.log('\n── A06 — wiring on the three upload paths ──────────────────────');

const read = (rel) => readFileSync(join(__dirname, rel), 'utf8');
const hookSrc = read('../hooks/useJourneyGPS.ts');
const uploadSrc = read('../hooks/useLocationUpload.ts');
const headOutSrc = read('../../app/women/head-out/index.tsx');

test('live upload: builds the body from the fix\'s own capture time', () => {
  assert.match(hookSrc, /import \{ buildLocationUploadBody \} from '@\/src\/safety\/locationUploadBody';/);
  assert.match(hookSrc, /body: JSON\.stringify\(buildLocationUploadBody\(\{ lat, lng, accuracy, area, capturedAtMs \}\)\),/);
  assert.match(hookSrc, /await pushUpdate\(latitude, longitude, accuracy \?\? 0, area, fixMs\);/);
});
test('live upload: the capture time is the fix timestamp, not the send time', () => {
  assert.match(hookSrc, /const fixMs = Number\.isFinite\(pos\.timestamp\) && pos\.timestamp > 0 \? pos\.timestamp : nowMs;/);
});
test('no upload path sends the old four-field body any more', () => {
  const old = 'JSON.stringify({ lat, lng, accuracy, area })';
  assert.ok(!hookSrc.includes(old));
  assert.ok(!uploadSrc.includes(old));
});
test('queue and last-gasp: the body is built at the moment of sending', () => {
  assert.match(uploadSrc, /body: JSON\.stringify\(buildLocationUploadBody\(\{ lat, lng, accuracy, area, capturedAtMs \}\)\),/);
});
test('queue: a drained entry is sent with the time it was captured', () => {
  assert.match(uploadSrc, /entry\.area,\s+capturedAtToMs\(entry\.capturedAt\),/);
});
test('queue: a fix is queued with its capture time, not the time it was queued', () => {
  assert.match(uploadSrc, /const capturedAt = new Date\(capturedAtMs\)\.toISOString\(\);/);
  assert.ok(!uploadSrc.includes('capturedAt: new Date().toISOString()'));
});
test('last-gasp: sends the cached fix\'s own capture time', () => {
  assert.match(uploadSrc, /await _rawUpload\(authToken, journeyToken, lat, lng, accuracy \?\? 0, area, capturedAtToMs\(capturedAt\)\);/);
  assert.match(headOutSrc, /cached\.plusCode \|\| 'Unknown area',\s+cached\.capturedAt,/);
});

console.log(`\n  ${passed} passed   ${failed} failed   ${passed + failed} total\n`);
if (failed > 0) process.exit(1);
