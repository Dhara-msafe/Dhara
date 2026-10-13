/**
 * Step 5 helper — classifyFact(). Heuristic only; false negatives must
 * default to 'free_text' (the safe, no-extra-tap outcome).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFact } from '../../factClassifier';

test('empty / plain narrative text is free_text', () => {
  assert.equal(classifyFact(''), 'free_text');
  assert.equal(classifyFact('he hit me near the bus stand'), 'free_text');
});

test('section numbers are detected', () => {
  assert.equal(classifyFact('section 354 applies here'), 'section_number');
  assert.equal(classifyFact('this falls under BNS 85'), 'section_number');
});

test('amounts are detected', () => {
  assert.equal(classifyFact('he took rupees 5000 from me'), 'amount');
  assert.equal(classifyFact('₹12,000 was stolen'), 'amount');
});

test('dates are detected', () => {
  assert.equal(classifyFact('it happened on 12/03/2026'), 'date');
  assert.equal(classifyFact('this was yesterday evening'), 'date');
});

test('Indian state names are detected', () => {
  assert.equal(classifyFact('I live in Maharashtra'), 'state');
  assert.equal(classifyFact('the incident was in Tamil Nadu'), 'state');
});

test('section/amount/date win over a state mention in the same sentence', () => {
  // SECTION_RE / AMOUNT_RE / DATE_RE are checked before the state list.
  assert.equal(classifyFact('in Kerala, section 420 applies'), 'section_number');
});
