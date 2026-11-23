/**
 * v2.2 copy correction — Silent alert (screen-manifest id 34).
 * change_class: "Copy correction" only — NOT a visual reskin. The design
 * mockup (SilentAlert.dc.html) shows a full dark "Shield mode" press-and-hold
 * redesign, but the manifest's change_summary is narrowly "No 'Police
 * notified' claim", and route-component-map / screen-manifest are the
 * authoritative scope over the generic design mockup. The mockup's new
 * interaction model (big hold-to-confirm button) is out of scope for this
 * batch.
 *
 * This test locks in that the required copy state already holds in code
 * (verified by inspection — no change was needed): the alert message and
 * the SMS disclosure must never claim police are notified, and must keep
 * stating plainly that DHARA does not send anything by itself.
 *
 * Run with: node --experimental-strip-types --test src/__tests__/v22_copy_silent_alert.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const screen = readFileSync(join(root, 'app', 'women', 'silent-alert.tsx'), 'utf8');

test('no "police notified" style claim anywhere in the screen', () => {
  assert.doesNotMatch(screen, /police[^"']*(notif|alert|contact|inform)/i);
});

test('disclosure states DHARA never sends anything by itself', () => {
  assert.match(screen, /DHARA never sends anything by itself, and delivery is not confirmed\./);
});

test('message body makes no automated-notification claim', () => {
  assert.match(screen, /const message = 'I need help\. Please contact me and help me reach safety\. If I am in immediate danger, contact emergency services\.';/);
});
