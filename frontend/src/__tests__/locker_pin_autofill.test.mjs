/**
 * Evidence Locker PIN autofill (owner GO, 22 Nov).
 * Chrome autofilled the PIN box (dots shown) but the value never reached
 * state, so Unlock said "Enter at least 4 digits". Fix: on submit read the
 * box's real value (only if 4–6 digits) and turn autofill off on PIN boxes.
 * Run with: node --experimental-strip-types --test src/__tests__/locker_pin_autofill.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const { pinFromBox, PIN_NO_AUTOFILL } = await import(join(root, 'src', 'women', 'pinInput.ts'));
const screen = readFileSync(join(root, 'app', 'women', 'evidence-locker.tsx'), 'utf8');

test('web: an autofilled 4-6 digit value in the box is used when state is empty', () => {
  assert.equal(pinFromBox('', { value: '4821' }, 'web'), '4821');
  assert.equal(pinFromBox('', { value: '482193' }, 'web'), '482193');
});

test('web: anything that is not 4-6 digits is ignored (e.g. an autofilled password)', () => {
  assert.equal(pinFromBox('', { value: 'hunter22' }, 'web'), '');
  assert.equal(pinFromBox('', { value: '123' }, 'web'), '');
  assert.equal(pinFromBox('', { value: '1234567' }, 'web'), '');
  assert.equal(pinFromBox('', { value: '12 34' }, 'web'), '');
  assert.equal(pinFromBox('', null, 'web'), '');
});

test('typed PIN wins when state already has it; phones always use state', () => {
  assert.equal(pinFromBox('4821', { value: '4821' }, 'web'), '4821');
  assert.equal(pinFromBox('48211', { value: '4821' }, 'web'), '48211');
  assert.equal(pinFromBox('', { value: '4821' }, 'android'), '');
  assert.equal(pinFromBox('9999', { value: '4821' }, 'ios'), '9999');
});

test('autofill is turned off on PIN boxes (gate and Change PIN)', () => {
  assert.deepEqual(PIN_NO_AUTOFILL, { autoComplete: 'one-time-code', textContentType: 'oneTimeCode', importantForAutofill: 'no' });
  assert.equal((screen.match(/\{\.\.\.PIN_NO_AUTOFILL\}/g) || []).length, 2);
  assert.match(screen, /ref=\{pinInputRef\}\s*\n\s*testID="evidence-pin-input"/);
});

test('submit reads the box only after the lockout check, and uses the result everywhere', () => {
  const sub = screen.slice(screen.indexOf('const submit = useCallback'), screen.indexOf('}, [pin, mode, firstPin, onUnlock]);'));
  const lockIdx = sub.indexOf('const freshLockoutMs = await getLockoutRemainingMs();');
  const readIdx = sub.indexOf('const entered = pinFromBox(pin, pinInputRef.current, Platform.OS);');
  assert.ok(lockIdx > 0 && readIdx > lockIdx, 'box is read only after the lockout re-check');
  assert.match(sub, /if \(entered\.length < 4\) \{ setError\('Enter at least 4 digits\.'\); return; \}/);
  assert.match(sub, /await verifyPin\(entered\)/);
  assert.match(sub, /await setPin\(entered\)/);
  assert.ok(!/verifyPin\(pin\)|setPin\(pin\)/.test(sub), 'no leftover use of the raw state value');
});
