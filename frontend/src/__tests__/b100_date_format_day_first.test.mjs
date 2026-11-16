// B-100 (14 Nov 2026): a few screens called `toLocaleDateString()` with no
// locale argument, which resolves to whatever locale the JS engine thinks
// it's running in -- on some Hermes builds that falls back to en-US
// (month-first, "11/14/2026") regardless of the device's own region
// setting, while the rest of the app (which always passes an explicit
// locale/options) correctly shows dates day-first.
//
// Fix: a locale-independent `formatDateDMY` helper that builds DD/MM/YYYY
// directly from the Date object's own fields (no Intl/locale resolution
// involved), used by the three screens that had the bare, locale-less call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');

// ── Real executed behavioral test of the algorithm itself ──────────────────
// formatDateDMY has no RN/Expo imports, so it can be required directly.
test('formatDateDMY always renders day-first regardless of host locale', async () => {
  const mod = await import(path.join(root, 'src', 'dateFormat.ts').replace(/\.ts$/, '.ts'));
  const { formatDateDMY } = mod;
  // 14 Nov 2026 -> "14/11/2026", never "11/14/2026"
  assert.equal(formatDateDMY('2026-11-14T10:00:00.000Z'), '14/11/2026');
  // Single-digit day and month both zero-padded.
  assert.equal(formatDateDMY('2026-01-05T00:00:00.000Z'), '05/01/2026');
  // Invalid / absent input never throws, just renders empty.
  assert.equal(formatDateDMY('not-a-date'), '');
  assert.equal(formatDateDMY(null), '');
  assert.equal(formatDateDMY(undefined), '');
});

// ── Source-wiring checks: the three screens that had the bare, locale-less
// toLocaleDateString() call now use the shared day-first helper instead ──
function assertUsesFormatDateDMY(relPath) {
  const src = readFileSync(path.join(root, relPath), 'utf8');
  assert.match(src, /from '@\/src\/dateFormat'/, `${relPath} should import formatDateDMY`);
  assert.ok(!/\.toLocaleDateString\(\)/.test(src), `${relPath} should no longer call toLocaleDateString() with no locale`);
  assert.match(src, /formatDateDMY\(/, `${relPath} should call formatDateDMY`);
}

test('app/(tabs)/saved.tsx no longer uses a locale-less toLocaleDateString()', () => {
  assertUsesFormatDateDMY('app/(tabs)/saved.tsx');
});

test('app/(tabs)/settings.tsx no longer uses a locale-less toLocaleDateString()', () => {
  assertUsesFormatDateDMY('app/(tabs)/settings.tsx');
});

test('app/drafts/history.tsx no longer uses a locale-less toLocaleDateString()', () => {
  assertUsesFormatDateDMY('app/drafts/history.tsx');
});
