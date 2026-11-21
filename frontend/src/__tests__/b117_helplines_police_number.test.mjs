/**
 * B-117 — the FIR result page's "Emergency Helplines" card listed Police as
 * "100" (the legacy standalone police line) while the FIR letter the citizen
 * is about to send always cites "112" (the unified emergency number) in its
 * own footer, in every supported language. A citizen comparing the result
 * page to the letter they're about to file would see two different numbers
 * for what is supposed to be the same emergency contact.
 *
 * Fix verified here (source-level, no RN renderer in this plain-Node test
 * setup — same convention as b107_b80_preserve_unsent_fir_input.test.mjs):
 * the result page's HELPLINES list now cites 112, matching the letter.
 *
 * Run with:
 *   node --experimental-strip-types --test src/__tests__/b117_helplines_police_number.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULT_SCREEN = join(__dirname, '..', '..', 'app', 'fir-draft', 'result.tsx');
const FIR_ENGINE = join(__dirname, '..', '..', '..', 'backend', 'fir_engine.py');

const resultSrc = readFileSync(RESULT_SCREEN, 'utf8');
const engineSrc = readFileSync(FIR_ENGINE, 'utf8');

test('the result page no longer lists the legacy standalone police number (100)', () => {
  const policeEntry = resultSrc.match(/\{\s*label:\s*'Police[^']*',\s*number:\s*'(\d+)'/);
  assert.ok(policeEntry, 'expected a Police/Emergency entry in HELPLINES');
  assert.notEqual(policeEntry[1], '100', 'the police entry must not be the legacy 100 number');
});

test("the result page's Police/Emergency entry cites 112, matching the FIR letter's own footer", () => {
  const policeEntry = resultSrc.match(/\{\s*label:\s*'Police[^']*',\s*number:\s*'(\d+)'/);
  assert.ok(policeEntry);
  assert.equal(policeEntry[1], '112');

  // The letter template (fir_engine.py) always cites 112 as "Emergency" in
  // its own footer, across every language — this is the source of truth
  // the result page must agree with.
  assert.ok(
    engineSrc.includes('Emergency: 112') || engineSrc.includes('आपातकाल: 112'),
    'sanity check: the FIR letter footer itself still cites 112 as Emergency',
  );
});

test('the other helpline numbers (Women, NALSA, Cybercrime, Childline) are untouched', () => {
  assert.ok(resultSrc.includes("{ label: 'Women Helpline', number: '181'"));
  assert.ok(resultSrc.includes("number: '15100', icon: 'briefcase-outline' }"));
  assert.ok(resultSrc.includes("number: '1930',  icon: 'laptop-outline' }"));
  assert.ok(resultSrc.includes("number: '1098',  icon: 'people-outline' }"));
});
