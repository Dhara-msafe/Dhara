/**
 * v2.2 copy correction — Record proof / Evidence Locker (screen-manifest id 26,
 * "Copy correction + Visual change"). change_summary: 'Pause and "Make the
 * screen dark, keep recording" removed from the design: neither exists in
 * the app. Local-only storage confirmed in code; the exact words "Saved to
 * this phone" were not found, so the design says "Saved on this phone.
 * Sharing is your choice." Save-failure state still to be designed.'
 *
 * The Record.dc.html mockup itself still contains a full-screen dark
 * "tap to show" recording view — but COPY_AND_CAPABILITY_AUDIT.csv confirms
 * that control was removed from the design and was never in the app, so it
 * is explicitly out of scope here (same treatment as Silent alert/Safety
 * phrases/Guardian share: the manifest's narrow change_summary overrides the
 * fuller mockup). The screen's styles already use the current v2.2 design
 * tokens throughout (c.background/c.navy/c.ink/c.surface/c.redBg/c.redDeep),
 * so no broader re-theme was needed — just the one copy fix below.
 *
 * The PIN gate (PinGate component, same file) shares these same styles, so
 * it picks up the correct v2.2 token palette automatically; screen-manifest
 * id 15 ("Set PIN") is excluded — no new app-wide PIN system — so the
 * existing local Evidence Locker PIN gate is left structurally untouched.
 *
 * Run with: node --experimental-strip-types --test src/__tests__/v22_copy_record_proof.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const screen = readFileSync(join(root, 'app', 'women', 'evidence-locker.tsx'), 'utf8');

test('storage notice uses the corrected opening wording', () => {
  assert.match(screen, /Saved on this phone\. Sharing is your choice\. Nobody else gets it unless you choose to share it, anchor it, or back it up\./);
  assert.doesNotMatch(screen, /Saved to this phone\./);
});

test('no Pause / "make the screen dark, keep recording" control exists', () => {
  assert.doesNotMatch(screen, /make the screen dark/i);
  assert.doesNotMatch(screen, /\bPause\b/);
});

test('the local PIN gate (PinGate) is untouched and still has no app-wide counterpart: hasPin/setPin/verifyPin local API only', () => {
  assert.match(screen, /function PinGate\(\{ onUnlock \}: \{ onUnlock: \(\) => void \}\)/);
  assert.match(screen, /hasPin\(\)/);
  assert.match(screen, /await setPin\(entered\); onUnlock\(\); return;/);
  assert.match(screen, /const result = await verifyPin\(entered\);/);
});

test('PIN gate shares the main screen\'s styles, which already use v2.2 tokens', () => {
  assert.match(screen, /heading: \{ fontFamily: theme\.fonts\.displayBold, fontSize: 23, color: c\.ink, marginTop: 10 \},/);
  assert.match(screen, /button: \{ minHeight: 56, backgroundColor: c\.navy, borderRadius: 14, padding: 16, alignItems: 'center' \},/);
});
