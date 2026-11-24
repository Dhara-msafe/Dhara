// v2.2 Batch 3 (S7+S8) audit lock-in. Per screen-manifest.csv and
// DESIGN_CHANGELOG.md, most Batch 3 screens needed no code change beyond the
// one real S7 fix (see v22_s7_firdraft_attach_button.test.mjs). This confirms
// the specific, already-correct behaviour so a future edit can't silently
// regress it. See the tracking sheet's "Progress Notes" column for the full
// reasoning per screen.
// Run: node --experimental-strip-types --test src/__tests__/v22_s7_s8_audit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, ...p.split('/')), 'utf8');

// -- id9 Scan document: manifest's caution is "do NOT redirect scan
// completion to /heard without confirming the OCR workflow". Lock in that
// no such redirect exists.
test('Scan screen never redirects to the Ask flow\'s /heard route', () => {
  const scan = read('app/scan.tsx');
  assert.doesNotMatch(scan, /\/heard/);
});

// -- id11 Action plan: "sample content is placeholder", audited for
// overclaiming copy, found clean.
test('Action plan has no overclaiming copy (encrypted/guarantee/notified)', () => {
  const actionPlan = read('app/action-plan.tsx');
  assert.doesNotMatch(actionPlan, /\bencrypted\b/i);
  assert.doesNotMatch(actionPlan, /\bguarantee/i);
  assert.doesNotMatch(actionPlan, /police (has been |is )?notified/i);
});

// -- ids 16/17 Letter saved / Your letter: manifest says both are states of
// app/drafts/[type].tsx and change_class is "Existing behaviour to
// preserve" -- i.e. explicitly do not touch. Lock in it stays untouched/clean.
test('the draft-letter screen (Letter saved + Your letter states) has no overclaiming copy', () => {
  const draftType = read('app/drafts/[type].tsx');
  assert.doesNotMatch(draftType, /\bencrypted\b/i);
  assert.doesNotMatch(draftType, /\bverified\b/i);
});

// -- id32 Ready notices: the manifest corrects the tracking sheet's route --
// the real "Ready notices" screen is app/drafts/index.tsx (titled "Ready
// notices" in its header), not app/drafts/[type].tsx. Lock in the title.
test('app/drafts/index.tsx is titled "Ready notices" (corrects the tracking sheet\'s old route mapping)', () => {
  const notices = read('app/drafts/index.tsx');
  assert.match(notices, /<Text style=\{styles\.h1\}>Ready notices<\/Text>/);
});

// -- id31 File a complaint: manifest's caution is "fraud-help navigation
// NOT replaced by Advocate Register". Lock in there is no Advocate
// Register reference in this file.
test('File a complaint has no Advocate Register reference (fraud-help nav not replaced)', () => {
  const firDraft = read('app/fir-draft/index.tsx');
  assert.doesNotMatch(firDraft, /advocate/i);
});

// -- id41/42 Missing person / Missing interview: already built on the v2.2
// theme tokens (not a separate hardcoded palette). Lock in they read the
// shared theme rather than a legacy one-off palette.
test('Missing person and Missing interview use the shared v2.2 theme tokens, not a one-off palette', () => {
  const missing = read('app/missing/index.tsx');
  const interview = read('app/missing/interview.tsx');
  for (const f of [missing, interview]) {
    assert.match(f, /const NAVY = theme\.colors\.primary;/);
    assert.match(f, /const RED = theme\.colors\.error;/);
    assert.match(f, /const BG = theme\.colors\.background;/);
  }
});

// -- id43 Alerts: manifest's "sample alerts removed" is already true -- the
// live screen fetches real data and has no hardcoded sample rows.
test('Alerts screen has no hardcoded sample alert data, only a real API fetch and an honest empty state', () => {
  const alerts = read('app/alerts/index.tsx');
  assert.match(alerts, /listAlerts\(token, filter as any\)/);
  assert.match(alerts, /Nothing here yet\./);
  assert.doesNotMatch(alerts, /missed_checkin.{0,40}2026|sample|placeholder/i);
});
