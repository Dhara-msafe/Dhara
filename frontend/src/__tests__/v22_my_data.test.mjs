/**
 * v2.2 — My Data copy and wrapping (UI_V22_MYDATA, default OFF).
 * Client finding (22 Nov): "Fir Drafts", "Otp Logs", values cut off
 * ("Indefinite (legal ...").
 * Run with: node --experimental-strip-types --test src/__tests__/v22_my_data.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');
const { retentionLabel } = await import(join(root, 'src', 'myDataLabels.ts'));

test('flag defaults OFF', () => {
  assert.match(read('src', 'uiV22Flags.ts'), /export const UI_V22_MYDATA = process\.env\.EXPO_PUBLIC_UI_V22_MYDATA === 'true';/);
});

test('every backend retention key gets a plain label with correct acronyms', () => {
  const server = read('..', 'backend', 'server.py');
  const block = server.slice(server.indexOf('"retention_policy": {'), server.indexOf('},', server.indexOf('"retention_policy": {')));
  const keys = [...block.matchAll(/"([a-z_]+)":\s+"/g)].map((m) => m[1]);
  assert.ok(keys.length >= 6, 'found the backend keys');
  const expected = {
    chat_history: 'Chat history', fir_drafts: 'FIR drafts', voice_recordings: 'Voice recordings',
    payment_records: 'Payment records', consent_records: 'Consent records', otp_logs: 'OTP logs',
  };
  for (const k of keys) assert.equal(retentionLabel(k), expected[k] ?? retentionLabel(k));
  for (const [k, v] of Object.entries(expected)) assert.equal(retentionLabel(k), v);
});

test('unknown keys fall back to sentence case, acronyms kept', () => {
  assert.equal(retentionLabel('upi_refund_logs'), 'UPI refund logs');
  assert.equal(retentionLabel('sos_events'), 'SOS events');
  assert.equal(retentionLabel('saved_answers'), 'Saved answers');
  assert.ok(!/Fir |Otp /.test(retentionLabel('fir_otp_check')));
});

test('values wrap in full with the flag on; old 2-line cap with it off', () => {
  const s = read('app', 'my-data.tsx');
  assert.match(s, /numberOfLines=\{UI_V22_MYDATA \? undefined : 2\}/);
  assert.match(s, /UI_V22_MYDATA && styles\.dataRowWrap/);
  assert.match(s, /dataRowWrap: \{ alignItems: 'flex-start' \}/);
  assert.match(s, /label=\{UI_V22_MYDATA \? retentionLabel\(key\) :/);
});
