/**
 * B-87 — the Advocate Consultation Notetaker must be hidden/scoped for Wave 1,
 * the same way B-97 hides the rest of advocate/lawyer mode.
 *
 * Before this fix, the Notetaker's own dashboard entry card lived inside the
 * already-gated advocate.tsx screen (so it was reachable only through a
 * screen that already redirects home for Wave 1) -- but its four underlying
 * routes (/notetaker, /notetaker/matter/[id], /notetaker/consultation/new,
 * /notetaker/consultation/[id], /notetaker/tasks) had no gate of their own:
 * a direct URL hit or a deep link reached a live screen regardless of the
 * ADVOCATE_MODE_ENABLED flag, same class of bug as B-97's four screens.
 *
 * Source-level wiring checks only (no RN renderer in this plain-Node test
 * setup) -- same convention as adminUpiReviewGate.test.mjs / qaModeBanner.test.mjs.
 *
 * Run with:
 *   node --experimental-strip-types --test src/__tests__/b87_notetaker_wave1_gate.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, '..', '..', 'app');
const FLAGS = join(__dirname, '..', 'advocateMode', 'flags.ts');

const SCREENS = {
  'notetaker/index.tsx': join(APP, 'notetaker', 'index.tsx'),
  'notetaker/matter/[id].tsx': join(APP, 'notetaker', 'matter', '[id].tsx'),
  'notetaker/consultation/new.tsx': join(APP, 'notetaker', 'consultation', 'new.tsx'),
  'notetaker/consultation/[id].tsx': join(APP, 'notetaker', 'consultation', '[id].tsx'),
  'notetaker/tasks.tsx': join(APP, 'notetaker', 'tasks.tsx'),
};

const flagsSrc = readFileSync(FLAGS, 'utf8');
const screenSrcs = Object.fromEntries(
  Object.entries(SCREENS).map(([name, path]) => [name, readFileSync(path, 'utf8')])
);

test('the shared advocate-mode flag module exists and defaults to hidden', () => {
  assert.ok(flagsSrc.includes('ADVOCATE_MODE_ENABLED'));
  assert.ok(flagsSrc.includes("process.env.EXPO_PUBLIC_ADVOCATE_MODE_V2 === 'true'"));
});

for (const [name, src] of Object.entries(screenSrcs)) {
  test(`${name} imports the shared ADVOCATE_MODE_ENABLED flag (same source of truth as B-97)`, () => {
    assert.ok(
      src.includes("import { ADVOCATE_MODE_ENABLED } from '@/src/advocateMode/flags';"),
      `${name} does not import ADVOCATE_MODE_ENABLED`
    );
  });

  test(`${name} redirects home for every profile except when the flag is enabled`, () => {
    assert.ok(
      /if \(!ADVOCATE_MODE_ENABLED\) return <Redirect href="\/\(tabs\)\/home" \/>;/.test(src),
      `${name} has no unconditional ADVOCATE_MODE_ENABLED gate`
    );
  });

  test(`${name} gates before any hook or data fetch can run`, () => {
    const gateIdx = src.search(/if \(!ADVOCATE_MODE_ENABLED\)/);
    const useStateIdx = src.search(/use(State|Callback|Effect|FocusEffect|LocalSearchParams|SafeAreaInsets|Auth)\(/);
    assert.ok(gateIdx !== -1, 'gate not found');
    assert.ok(useStateIdx !== -1, 'no hook call found to compare against');
    assert.ok(gateIdx < useStateIdx, 'gate must appear before the first hook call in source order');
  });
}

test('backend notetaker endpoints are already gated server-side (FEATURE_ADVOCATE_NOTETAKER), unaffected by this frontend-only fix', () => {
  const routerSrc = readFileSync(
    join(__dirname, '..', '..', '..', 'backend', 'api', 'advocate_notetaker_router.py'),
    'utf8'
  );
  assert.ok(routerSrc.includes('FEATURE_ADVOCATE_NOTETAKER'));
  assert.ok(routerSrc.includes('def _guard()'));
  // Every endpoint must route through _require_advocate (which calls _guard()),
  // never take a bare current_user dependency that would skip the flag check.
  const bareCurrentUserDeps = (routerSrc.match(/Depends\(current_user\)/g) || []).length;
  assert.equal(
    bareCurrentUserDeps, 1,
    'exactly one Depends(current_user) is expected: inside _require_advocate itself -- ' +
    'any additional one means some endpoint bypasses the FEATURE_ADVOCATE_NOTETAKER guard'
  );
});
