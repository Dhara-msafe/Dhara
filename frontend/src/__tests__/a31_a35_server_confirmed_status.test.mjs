/**
 * A31 + A35 — the journey screen follows the server, not its own timer.
 *
 * A31. After a missed check-in the screen said "Your trusted circle has been
 * notified" as soon as the phone's own countdown reached zero, without
 * asking the server. Now it reports the server's actual reply: who an alert
 * was raised for, that nothing was raised and why, or that the server could
 * not be reached (and it keeps trying).
 *
 * Found on the way: when she chose "Do nothing" for missed check-ins, the
 * phone still reported the missed check-in automatically and the server
 * alerted her circle. The automatic report now respects that choice.
 *
 * A35. "I'm safe" and "Stop sharing" were each sent once. A failed "I'm safe"
 * still ended the journey on the phone, so the server's alarm kept running.
 * A failed "Stop sharing" did nothing and showed nothing. Both now stay
 * pending, are shown as pending, and are retried until the server confirms.
 *
 * Two layers: pure-logic tests of src/safety/journeyAlarm.ts, and source-level
 * wiring checks on index.tsx (it imports react-native and cannot run in Node).
 *
 * Run: node --experimental-strip-types src/__tests__/a31_a35_server_confirmed_status.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  IDLE_ALERT_REPORT, parseMissedCheckinReply, alertStatusText, recipientAlertLabel,
  closeOutcome, CLOSE_COPY, DO_NOTHING_TEXT,
} from '../safety/journeyAlarm.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); console.log(`  ✅  ${label}`); passed++; }
  catch (e) { console.log(`  ❌  ${label}\n      ${e.message}`); failed++; }
}
const st = (over = {}) => ({ ...IDLE_ALERT_REPORT, ...over });
const text = (state, over = {}) => alertStatusText({ state, autoNotifyOff: false, pendingSafe: false, graceCountdown: '4:59', ...over });
const label = (state, linkId = 'L1', over = {}) => recipientAlertLabel({ state, linkId, autoNotifyOff: false, pendingSafe: false, graceCountdown: '4:59', ...over });

console.log('\n── A31 — reading the server\'s reply ────────────────────────────');

test('alerts raised for two of three people', () => {
  const s = parseMissedCheckinReply({ ok: true, alerted_link_ids: ['L1', 'L2'], selected: 3 });
  assert.deepEqual(s, { report: 'confirmed', alertedLinkIds: ['L1', 'L2'], selected: 3, skippedReason: null });
});
test('an older server that only says ok: confirmed, counts unknown', () => {
  const s = parseMissedCheckinReply({ ok: true });
  assert.equal(s.report, 'confirmed');
  assert.equal(s.alertedLinkIds, null);
  assert.equal(s.selected, null);
});
test('skipped because sharing was stopped', () => {
  const s = parseMissedCheckinReply({ ok: true, skipped: 'x', skipped_reason: 'sharing_withdrawn', alerted_link_ids: [], selected: 2 });
  assert.equal(s.report, 'skipped');
  assert.equal(s.skippedReason, 'sharing_withdrawn');
  assert.deepEqual(s.alertedLinkIds, []);
});
test('skipped with a reason this build does not know', () => {
  assert.equal(parseMissedCheckinReply({ ok: true, skipped: 'x', skipped_reason: 'something_new' }).skippedReason, 'unknown');
  assert.equal(parseMissedCheckinReply({ ok: true, skipped: 'journey already completed or sharing withdrawn' }).skippedReason, 'unknown');
});
test('junk in the reply is ignored, never trusted', () => {
  const s = parseMissedCheckinReply({ ok: true, alerted_link_ids: ['L1', 7, null, {}], selected: -4 });
  assert.deepEqual(s.alertedLinkIds, ['L1']);
  assert.equal(s.selected, null);
  assert.equal(parseMissedCheckinReply(null).report, 'confirmed');
});

console.log('\n── A31 — what the status line says ─────────────────────────────');

test('before the grace period ends: the countdown', () => {
  assert.equal(text(st()), 'Will notify your circle in 4:59');
});
test('she chose "Do nothing": says so, no countdown', () => {
  assert.equal(text(st(), { autoNotifyOff: true }), DO_NOTHING_TEXT);
});
test('while the report is on its way', () => {
  assert.match(text(st({ report: 'sending' })), /Raising the alert/);
});
test('server unreachable: "Not confirmed", never "notified"', () => {
  const t = text(st({ report: 'failed' }));
  assert.match(t, /^Not confirmed\./);
  assert.match(t, /Trying again/);
  assert.doesNotMatch(t, /notified|alerted your/i);
});
test('raised for 2 of 3 people', () => {
  assert.equal(
    text(st({ report: 'confirmed', alertedLinkIds: ['L1', 'L2'], selected: 3 })),
    'Alert raised for 2 of 3 people. DHARA cannot tell yet whether they have seen it.',
  );
});
test('raised for 1 of 1 person (singular)', () => {
  assert.match(text(st({ report: 'confirmed', alertedLinkIds: ['L1'], selected: 1 })), /^Alert raised for 1 of 1 person\./);
});
test('server accepted the report but raised it for nobody', () => {
  const t = text(st({ report: 'confirmed', alertedLinkIds: [], selected: 2 }));
  assert.match(t, /^No alert was raised\./);
  assert.match(t, /not accepted your invitation or have not allowed late alerts/);
});
test('older server, counts unknown: says raised, still no claim it was seen', () => {
  assert.equal(text(st({ report: 'confirmed' })), "DHARA's server has raised the alert. DHARA cannot tell yet whether they have seen it.");
});
test('skipped because she stopped sharing', () => {
  assert.equal(text(st({ report: 'skipped', skippedReason: 'sharing_withdrawn' })), 'No alert was raised, because you stopped sharing this journey.');
});
test('skipped because the journey was already marked safe', () => {
  assert.match(text(st({ report: 'skipped', skippedReason: 'journey_completed' })), /already marked safe/);
});
test('an "I\'m safe" that has not reached the server overrides everything else', () => {
  const t = text(st({ report: 'confirmed', alertedLinkIds: ['L1'], selected: 1 }), { pendingSafe: true });
  assert.match(t, /^You marked yourself safe, but this phone could not tell DHARA's server\./);
  assert.match(t, /may still alert your circle/);
});
test('no state ever uses the old unconditional sentence', () => {
  const states = [st(), st({ report: 'sending' }), st({ report: 'failed' }), st({ report: 'confirmed' }),
    st({ report: 'confirmed', alertedLinkIds: [], selected: 1 }), st({ report: 'skipped', skippedReason: 'unknown' })];
  for (const s of states) for (const off of [true, false]) for (const ps of [true, false]) {
    assert.notEqual(text(s, { autoNotifyOff: off, pendingSafe: ps }), 'Your trusted circle has been notified');
  }
});

console.log('\n── A31 — the label beside each person ──────────────────────────');

test('countdown, then alerting, then the real outcome per person', () => {
  assert.equal(label(st()), 'In 4:59');
  assert.equal(label(st({ report: 'sending' })), 'Alerting…');
  const done = st({ report: 'confirmed', alertedLinkIds: ['L1'], selected: 2 });
  assert.equal(label(done, 'L1'), 'Alert raised');
  assert.equal(label(done, 'L2'), 'Not alerted');
});
test('unreachable server or a pending "I\'m safe": Not confirmed', () => {
  assert.equal(label(st({ report: 'failed' })), 'Not confirmed');
  assert.equal(label(st({ report: 'confirmed', alertedLinkIds: ['L1'] }), 'L1', { pendingSafe: true }), 'Not confirmed');
});
test('"Do nothing" and skipped reports', () => {
  assert.equal(label(st(), 'L1', { autoNotifyOff: true }), 'Not auto-notified');
  assert.equal(label(st({ report: 'skipped', skippedReason: 'sharing_withdrawn' })), 'Not alerted');
  assert.equal(label(st({ report: 'skipped', skippedReason: 'auto_notify_off' })), 'Not auto-notified');
});
test('the old label "Notified" is never produced', () => {
  for (const r of ['idle', 'sending', 'failed', 'confirmed', 'skipped']) {
    assert.notEqual(label(st({ report: r, alertedLinkIds: ['L1'] })), 'Notified');
  }
});

console.log('\n── A35 — what a reply to "safe" or "stop sharing" means ────────');

test('2xx: done', () => {
  for (const c of [200, 201, 204]) assert.equal(closeOutcome(c), 'done');
});
test('403, 404, 410: nothing of hers left to close, so done', () => {
  for (const c of [403, 404, 410]) assert.equal(closeOutcome(c), 'done');
});
test('no reply, server errors, auth or rate-limit errors: retry', () => {
  for (const c of [null, undefined, NaN, 0, 401, 408, 429, 500, 502, 503]) assert.equal(closeOutcome(c), 'retry');
});
test('the pending wording says plainly what is still true', () => {
  assert.match(CLOSE_COPY.safe_pending.title, /still open on DHARA's server/);
  assert.match(CLOSE_COPY.safe_pending.body, /may still be alerted when your check-in time passes/);
  assert.equal(CLOSE_COPY.revoke_pending.title, 'Sharing has NOT stopped yet');
  assert.match(CLOSE_COPY.revoke_pending.body, /can still see this journey/);
});

console.log('\n── Wiring in head-out/index.tsx ────────────────────────────────');

const src = readFileSync(join(__dirname, '../../app/women/head-out/index.tsx'), 'utf8');
const block = (startMark, endMark) => {
  const a = src.indexOf(startMark); const b = src.indexOf(endMark, a);
  assert.ok(a > -1 && b > a, `block not found: ${startMark.slice(0, 50)}`);
  return src.slice(a, b + endMark.length);
};

test('A31: the old phone-timer state and sentences are gone', () => {
  assert.ok(!src.includes('alertRaised'));
  assert.ok(!src.includes("'Your trusted circle has been notified'"));
  assert.ok(!src.includes("? 'Notified'"));
});
test('A31: the report waits for the reply and records it', () => {
  const b = block('const reportMissedCheckin = useCallback(async (trigger', '}, [authToken, journeyToken]);');
  assert.match(b, /body: JSON\.stringify\(\{ trigger \}\)/);
  assert.match(b, /if \(!r\.ok\) throw new Error/);
  assert.match(b, /setAlertReport\(parseMissedCheckinReply\(await r\.json\(\)\)\);/);
  assert.match(b, /setAlertReport\(prev => \(\{ \.\.\.prev, report: 'failed' \}\)\);/);
  assert.ok(!b.includes('.catch(() => {})'));
});
test('A31: the automatic report respects "Do nothing" and a pending "I\'m safe"', () => {
  assert.match(src, /!missedReportedRef\.current &&\s+!autoNotifyOff && !pendingSafe\s+\) \{\s+missedReportedRef\.current = true;\s+alertTriggerRef\.current = 'auto';\s+void reportMissedCheckin\('auto'\);/);
});
test('A31: "Raise alert now" is sent as a manual report', () => {
  assert.match(src, /alertTriggerRef\.current = 'manual';\s+void reportMissedCheckin\('manual'\);/);
});
test('A31: a failed report is retried with the shared timing', () => {
  assert.match(src, /if \(alertReport\.report !== 'failed' \|\| !expired \|\| !alertTriggerRef\.current \|\| pendingSafe\) return;/);
  assert.match(src, /void reportMissedCheckin\(trigger\); \}, retryDelayMs\(alertReportFailures\)\);/);
});
test('A31: both screen texts come from the tested helpers', () => {
  assert.match(src, /\{alertStatusText\(\{\s+state: alertReport, autoNotifyOff, pendingSafe,/);
  assert.match(src, /\{recipientAlertLabel\(\{\s+state: alertReport, linkId: link\.id, autoNotifyOff, pendingSafe,/);
});
test('A31: "Raise alert now" hides once a report has started', () => {
  assert.match(src, /alertReport\.report === 'idle' && graceSecsLeft !== 0 && !pendingSafe && \(\s+<Pressable testID="headout-raise-alert-now"/);
});

const endBlock = block('const endSession = useCallback(async () => {', '}, [authToken, journeyToken, user]);');

test('A35: "I\'m safe" waits for the server before clearing the journey', () => {
  const sent = endBlock.indexOf('/safe`');
  const check = endBlock.indexOf("if (closeOutcome(status) !== 'done') {");
  const clear = endBlock.indexOf('await AsyncStorage.removeItem(SESSION_KEY)');
  const drop = endBlock.indexOf('setSession(null);');
  assert.ok(sent > -1 && check > sent && clear > check && drop > clear, 'order must be: send, check, then clear');
  assert.match(endBlock, /const r = await fetch\(/);
});
test('A35: an unconfirmed "I\'m safe" is saved as pending and returns without clearing', () => {
  const a = endBlock.indexOf("if (closeOutcome(status) !== 'done') {");
  const b = endBlock.indexOf('setCloseFailures(0);');
  const fail = endBlock.slice(a, b);
  assert.match(fail, /const updated = \{ \.\.\.current, pendingSafe: true \};/);
  assert.match(fail, /AsyncStorage\.setItem\(SESSION_KEY, JSON\.stringify\(updated\)\)/);
  assert.match(fail, /return;\s+\}\s+\}\s*$/);
  assert.ok(!fail.includes('setSession(null)'));
});
test('A35: two "safe" requests can never overlap', () => {
  assert.match(endBlock, /if \(closeInFlightRef\.current\) return;/);
});
test('A35: a pending "I\'m safe" is retried, also after the app is reopened', () => {
  assert.match(src, /const pendingSafe = !!session\?\.pendingSafe;/);
  assert.match(src, /if \(!pendingSafe \|\| !authToken \|\| !journeyToken\) return;\s+const timer = setTimeout\(\(\) => \{ void endSession\(\); \}, retryDelayMs\(closeFailures\)\);/);
  assert.match(src, /pendingSafe\?: boolean;/);
});
test('A35: location stops being read and sent once she has said she is safe', () => {
  assert.match(src, /locationConsentGiven && !session\.pendingSafe,/);
  assert.match(src, /sessionRef\.current\.pendingSafe \|\|/);
});

const stopBlock = block('const stopSharing = useCallback(async () => {', '}, [journeyToken, authToken, revokingShare]);');

test('A35: "Stop sharing" shows stopped only when the server confirms', () => {
  const ok = stopBlock.indexOf("if (closeOutcome(status) === 'done') {");
  const set = stopBlock.indexOf('setSharingRevoked(true);');
  assert.ok(ok > -1 && set > ok);
  assert.equal(stopBlock.split('setSharingRevoked(true)').length - 1, 1);
});
test('A35: a failed "Stop sharing" is saved as pending, not swallowed', () => {
  assert.match(stopBlock, /setRevokeFailures\(n => n \+ 1\);/);
  assert.match(stopBlock, /const updated = \{ \.\.\.current, pendingRevoke: true \};/);
  assert.ok(!stopBlock.includes('} catch {} finally {'));
});
test('A35: a pending "Stop sharing" is retried', () => {
  assert.match(src, /const pendingRevoke = !!session\?\.pendingRevoke && !sharingRevoked;/);
  assert.match(src, /setTimeout\(\(\) => \{ void stopSharing\(\); \}, retryDelayMs\(revokeFailures\)\);/);
});
test('A35: both pending states are shown, with a retry button, and announced', () => {
  for (const id of ['headout-safe-pending', 'headout-safe-retry', 'headout-revoke-pending', 'headout-revoke-retry']) {
    assert.ok(src.includes(`testID="${id}"`), `missing ${id}`);
  }
  for (const id of ['headout-safe-pending', 'headout-revoke-pending']) {
    const i = src.indexOf(`testID="${id}"`);
    assert.match(src.slice(i, i + 90), /accessibilityRole="alert"/);
  }
});
test('no hook-level name is declared twice in the journey screen', () => {
  const names = [...src.matchAll(/^  const (?:\[([^\]]+)\]|(\w+))/gm)]
    .flatMap(m => (m[1] ? m[1].split(',').map(x => x.trim()) : [m[2]])).filter(Boolean);
  const seen = new Set(); const dup = new Set();
  for (const n of names) { if (seen.has(n)) dup.add(n); seen.add(n); }
  assert.deepEqual([...dup], []);
});

console.log(`\n  ${passed} passed   ${failed} failed   ${passed + failed} total\n`);
if (failed > 0) process.exit(1);
