/**
 * v2.2 copy correction — Guardian share (screen-manifest id 38).
 * change_class: "Copy correction" only — NOT a visual reskin. The
 * GuardianShare.dc.html mockup shows a different UI paradigm entirely (a
 * live-location share with a per-contact people-list, each row showing
 * "Invited", plus an overall "Not sharing yet" idle state) — that structure
 * does not exist in the current screen, which implements the SMS-based
 * journey/check-in engine (S3) instead. Building that people-list view would
 * be new functionality, out of scope for a "Copy correction" change_class.
 *
 * COPY_AND_CAPABILITY_AUDIT.csv's underlying concern — "Sharing active /
 * Viewing / Contact accepted" must not be claimed unless the app actually
 * reports that state — is checked here against the real screen: there is no
 * such literal claim in the code, and the one state this screen does show
 * (live-tracking wording) is already gated on gpsLive, which per its own
 * comment is '1' only when location sharing is actually running.
 *
 * Run with: node --experimental-strip-types --test src/__tests__/v22_copy_guardian_share.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const screen = readFileSync(join(root, 'app', 'women', 'guardian-share.tsx'), 'utf8');

test('no overclaiming "Sharing active" / "Viewing" / blanket "Accepted" status text', () => {
  assert.doesNotMatch(screen, /Sharing active|^\s*Viewing\s*$/m);
  assert.doesNotMatch(screen, /status(Text|Label)?\s*[:=]\s*['"]Accepted['"]/);
});

test('live-tracking wording is gated on gpsLive, which is only true when sharing is actually running', () => {
  assert.match(screen, /gpsLive\?: string;\s*\/\/ '1' only when location sharing is actually running/);
  assert.match(screen, /gpsLive\s*\?\s*'Track my journey live'\s*:\s*'Check my journey status'/);
});

test('withdrawal/disclosure copy stays accurate: nothing sent automatically, delivery not confirmed', () => {
  assert.match(screen, /Nothing is sent automatically\. DHARA opens your SMS app with a pre-filled message for one person at a time; you read it and press Send yourself, and delivery is not confirmed\./);
});
