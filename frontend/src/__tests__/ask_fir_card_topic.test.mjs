/**
 * Ask: the FIR card only for crime / danger questions (owner GO, 22 Nov).
 * "What is the time limit to file a consumer complaint?" got "Start Guided
 * FIR Draft": detectFirIntent matched any "file ... complaint". Now a plain
 * complaint needs a crime/danger signal, and non-criminal complaints get the
 * matching notice or steps (civilComplaintAction).
 * Run with: node --experimental-strip-types --test src/__tests__/ask_fir_card_topic.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const { detectFirIntent, civilComplaintAction } = await import(join(root, 'src', 'chat', 'messageUtils.ts'));

test("owner's example: consumer complaint -> no FIR card, consumer steps instead", () => {
  const q = 'What is the time limit to file a consumer complaint?';
  assert.equal(detectFirIntent(q), false);
  assert.deepEqual(civilComplaintAction(q), { label: 'See the steps for a consumer complaint', route: '/action-plan', icon: 'cart-outline' });
});

test('crime and danger questions still get the FIR card (and no civil action)', () => {
  for (const q of [
    'Help me draft an FIR',
    'I want to file an FIR for my stolen phone',
    'How do I lodge a police complaint?',
    'I want to report a theft',
    'File a complaint against my husband for dowry harassment',
    'How to file a complaint about online fraud',
    'I want to file a complaint, someone is stalking me',
    'Register a complaint about domestic violence',
    'How do I write a complaint about being threatened?',
  ]) {
    assert.equal(detectFirIntent(q), true, `FIR card expected: ${q}`);
    assert.equal(civilComplaintAction(q), null, `no civil action expected: ${q}`);
  }
});

test('civil complaints get the matching ready notice', () => {
  const cases = [
    ['How do I file a complaint against my landlord for my deposit?', '/drafts/deposit_refund'],
    ['My employer has not paid my salary, how do I file a complaint?', '/drafts/unpaid_salary'],
    ['Can I file a case for a cheque bounce?', '/drafts/cheque_bounce'],
    ['How to file a complaint for a defective product refund', '/action-plan'],
  ];
  for (const [q, route] of cases) {
    assert.equal(detectFirIntent(q), false, `no FIR card: ${q}`);
    assert.equal(civilComplaintAction(q)?.route, route, q);
  }
});

test('unrelated questions get neither', () => {
  for (const q of ['What are my rights at a police stop?', 'How do I get a voter ID?', 'Explain BNS section 318']) {
    assert.equal(detectFirIntent(q), false, q);
    assert.equal(civilComplaintAction(q), null, q);
  }
});

test('Ask screen: civil button only when there is no FIR card and no same next-step', () => {
  const s = readFileSync(join(root, 'app', '(tabs)', 'index.tsx'), 'utf8');
  assert.match(s, /firIntent: detectFirIntent\(q\), civilAction: civilComplaintAction\(q\) \}/);
  assert.match(s, /if \(m\.role !== 'assistant' \|\| m\.firIntent \|\| !m\.civilAction\) return null;/);
  assert.match(s, /if \(nextStepFor\(m\.citations\)\?\.route === act\.route\) return null;/);
});
