// B-100 follow-up (24 Nov 2026): Chat history and the UPI pay page showed
// dates month-first (11/20/2026) via a bare toLocale*String(). Both now use
// the day-first helpers in src/dateFormat.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => readFileSync(path.join(root, p), 'utf8');

// Load the helpers by stripping the TypeScript types.
const src = read('src/dateFormat.ts')
  .replace(/export function/g, 'function')
  .replace(/\(input: [^)]*\): string/g, '(input)')
  .replace(/ as string \| number/g, '');
const { formatDateDMY, formatDateTimeDMY } = new Function(`${src}; return { formatDateDMY, formatDateTimeDMY };`)();

test('date and time are day-first, 12-hour', () => {
  assert.equal(formatDateTimeDMY(new Date(2026, 10, 20, 15, 30)), '20/11/2026, 3:30 PM');
  assert.equal(formatDateTimeDMY(new Date(2026, 0, 5, 0, 7)), '05/01/2026, 12:07 AM');
  assert.equal(formatDateTimeDMY(new Date(2026, 0, 5, 12, 0)), '05/01/2026, 12:00 PM');
  assert.equal(formatDateTimeDMY('not a date'), '');
  assert.equal(formatDateTimeDMY(null), '');
  assert.equal(formatDateDMY(new Date(2026, 10, 24)), '24/11/2026');
});

test('Chat history uses the day-first helper', () => {
  const h = read('app/(tabs)/history.tsx');
  assert.match(h, /formatDateTimeDMY\(item\.updated_at\)/);
  assert.doesNotMatch(h, /toLocaleString\(\)/);
});

test('UPI pay page dates are day-first', () => {
  const p = read('app/pay-upi.tsx');
  assert.match(p, /sent \{formatDateDMY\(mine\.created_at\)\}/);
  assert.match(p, /answer due by \$\{formatDateDMY\(mine\.expires_at\)\}/);
  assert.doesNotMatch(p, /toLocaleDateString\(\)/);
});
