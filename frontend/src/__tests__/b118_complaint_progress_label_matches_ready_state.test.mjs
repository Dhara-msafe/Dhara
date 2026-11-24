/**
 * B-118 — the Home screen's "For you right now" card showed a stale
 * "Preparing your draft" body line underneath a correct "DRAFT READY" tag
 * for the same case.
 *
 * Root cause: app/(tabs)/home.tsx's card reads two different things for the
 * tag vs. the body text --
 *   tag:  isDraftReady(primaryCase) ? 'DRAFT READY' : `STEP ...`
 *   body: primaryProgress.label                          (= complaintProgress(item).label)
 * complaintProgress()'s `label` was computed purely from LABELS[item.stage],
 * with no regard for isDraftReady(item) -- unlike the `step` field right
 * beside it in the very same return statement, which already checks
 * isDraftReady() first. So a case whose `status` reached 'completed' while
 * `stage` was still e.g. 'draft' showed a correct ready tag and a stale
 * "Preparing your draft" body at the same time.
 *
 * Fix verified here (source-level, no RN renderer in this plain-Node test
 * setup -- same convention as b122_sos_overlay_matches_chat_column.test.mjs):
 * complaintProgress()'s `label` now checks isDraftReady(item) first, the
 * same way `step` already does, so the two can never disagree again.
 *
 * Run with:
 *   node --experimental-strip-types --test src/__tests__/b118_complaint_progress_label_matches_ready_state.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMPLAINTS_SRC = join(__dirname, '..', 'home', 'complaints.ts');
const HOME_SRC = join(__dirname, '..', '..', 'app', '(tabs)', 'home.tsx');

const complaintsSrc = readFileSync(COMPLAINTS_SRC, 'utf8');
const homeSrc = readFileSync(HOME_SRC, 'utf8');

// Pull out isDraftReady, LABELS and complaintProgress from the real source
// and eval them directly, so this test runs the actual shipped logic rather
// than a hand-copied re-implementation that could silently drift from it.
function loadComplaintsLogic(src) {
  const isDraftReadyMatch = src.match(/export const isDraftReady = \(item: Complaint\) => (.+);/);
  const labelsMatch = src.match(/const LABELS: Record<string, string> = \{([\s\S]*?)\};/);
  const stagesMatch = src.match(/const STAGES = (\[[^\]]*\]);/);
  const progressBodyMatch = src.match(/export function complaintProgress\(item: Complaint\) \{([\s\S]*?)\n\}/);
  assert.ok(isDraftReadyMatch, 'isDraftReady not found in complaints.ts');
  assert.ok(labelsMatch, 'LABELS not found in complaints.ts');
  assert.ok(stagesMatch, 'STAGES not found in complaints.ts');
  assert.ok(progressBodyMatch, 'complaintProgress not found in complaints.ts');

  const isDraftReadyExpr = isDraftReadyMatch[1];
  const labelsBody = labelsMatch[1];
  const stagesExpr = stagesMatch[1];
  // Strip the explanatory comment lines inside complaintProgress's body —
  // they're prose, not code, and would break a direct eval.
  const progressBody = progressBodyMatch[1].replace(/^\s*\/\/.*$/gm, '');

  const factory = new Function(`
    const STAGES = ${stagesExpr};
    const LABELS = { ${labelsBody} };
    const isDraftReady = (item) => (${isDraftReadyExpr});
    function complaintProgress(item) {
      ${progressBody}
    }
    return { isDraftReady, complaintProgress };
  `);
  return factory();
}

const { isDraftReady, complaintProgress } = loadComplaintsLogic(complaintsSrc);

test('a case with status completed but stage still draft reports label "Draft ready", matching the ready tag', () => {
  const item = { session_id: 's1', stage: 'draft', status: 'completed' };
  assert.equal(isDraftReady(item), true);
  const progress = complaintProgress(item);
  assert.equal(progress.label, 'Draft ready');
  assert.equal(progress.step, 6);
});

test('a case with stage completed (status not yet completed) also reports label "Draft ready"', () => {
  const item = { session_id: 's2', stage: 'completed', status: 'in_progress' };
  assert.equal(isDraftReady(item), true);
  const progress = complaintProgress(item);
  assert.equal(progress.label, 'Draft ready');
});

test('an in-progress case (not ready) still shows its real stage label, unaffected by the fix', () => {
  const item = { session_id: 's3', stage: 'probe', status: 'in_progress' };
  assert.equal(isDraftReady(item), false);
  const progress = complaintProgress(item);
  assert.equal(progress.label, 'Incident details');
  assert.equal(progress.step, 3);
});

test('home.tsx\'s card reads isDraftReady() for the tag and primaryProgress.label for the body, from the same primaryCase', () => {
  assert.match(homeSrc, /isDraftReady\(primaryCase\)\s*\?\s*'DRAFT READY'/);
  assert.match(homeSrc, /primaryProgress\.label/);
});
