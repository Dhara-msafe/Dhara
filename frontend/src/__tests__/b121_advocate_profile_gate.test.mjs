/**
 * B-121 — advocate/lawyer/Notetaker screens must be locked to users who
 * actually have an advocate profile, not just to a build with
 * ADVOCATE_MODE_ENABLED on.
 *
 * Before this fix: ADVOCATE_MODE_ENABLED only controls whether the feature
 * exists in this build at all (see B-97/B-87's own gate, still correct and
 * unchanged). With the flag on -- which it is for this release, per D-14's
 * 16 Nov reversal -- any signed-in account, citizen or advocate, could
 * reach lawyer-home.tsx, intakes.tsx, and all five Notetaker screens
 * directly by URL and see the full advocate-facing UI shell (titles,
 * cards, "+ Matter" / "+ Intake" controls) before any API call had a
 * chance to 403. The backend already rejects a non-advocate's requests
 * (advocate_notetaker_router.py's _require_advocate), but the screen
 * itself had already rendered.
 *
 * Fix: a shared hook, useAdvocateProfile() (src/advocateMode/useAdvocateProfile.ts),
 * resolves whether the signed-in user has an advocate profile at all. Every
 * screen below calls it as an unconditional hook (so it can't violate the
 * Rules of Hooks the way branching before other hooks would), then redirects
 * home if the result is 'none', after all of the screen's own hooks have run.
 *
 * (tabs)/advocate.tsx and advocate-register.tsx are NOT part of this fix:
 * advocate.tsx already branches correctly on profile === 'none' vs a real
 * profile (shows the "Register as Advocate" prompt, never the dashboard),
 * and advocate-register.tsx is the registration form itself -- it is
 * supposed to be open to any signed-in citizen, since registering is how
 * someone becomes an advocate in the first place.
 *
 * Source-level wiring checks only (no RN renderer in this plain-Node test
 * setup) -- same convention as b87_notetaker_wave1_gate.test.mjs.
 *
 * Run with:
 *   node --experimental-strip-types --test src/__tests__/b121_advocate_profile_gate.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, '..', '..', 'app');
const HOOK = join(__dirname, '..', 'advocateMode', 'useAdvocateProfile.ts');

const SCREENS = {
  'lawyer-home.tsx': join(APP, 'lawyer-home.tsx'),
  'intakes.tsx': join(APP, 'intakes.tsx'),
  'notetaker/index.tsx': join(APP, 'notetaker', 'index.tsx'),
  'notetaker/matter/[id].tsx': join(APP, 'notetaker', 'matter', '[id].tsx'),
  'notetaker/consultation/new.tsx': join(APP, 'notetaker', 'consultation', 'new.tsx'),
  'notetaker/consultation/[id].tsx': join(APP, 'notetaker', 'consultation', '[id].tsx'),
  'notetaker/tasks.tsx': join(APP, 'notetaker', 'tasks.tsx'),
};

const hookSrc = readFileSync(HOOK, 'utf8');
const screenSrcs = Object.fromEntries(
  Object.entries(SCREENS).map(([name, path]) => [name, readFileSync(path, 'utf8')])
);

test('useAdvocateProfile fetches the advocate profile and resolves to loading/none/found', () => {
  assert.ok(hookSrc.includes('/api/advocate/profile/'));
  assert.ok(hookSrc.includes("status: 'loading'"));
  assert.ok(hookSrc.includes("status: 'none'"));
  assert.ok(hookSrc.includes("status: 'found'"));
});

for (const [name, src] of Object.entries(screenSrcs)) {
  test(`${name} still keeps the B-97/B-87 ADVOCATE_MODE_ENABLED build-flag gate`, () => {
    assert.ok(
      /if \(!ADVOCATE_MODE_ENABLED\) return <Redirect href="\/\(tabs\)\/home" \/>;/.test(src),
      `${name} lost its ADVOCATE_MODE_ENABLED gate`
    );
  });

  test(`${name} imports and calls useAdvocateProfile`, () => {
    assert.ok(
      src.includes("import { useAdvocateProfile } from '@/src/advocateMode/useAdvocateProfile';"),
      `${name} does not import useAdvocateProfile`
    );
    assert.ok(
      /const advocateGate = useAdvocateProfile\(\);/.test(src),
      `${name} does not call useAdvocateProfile()`
    );
  });

  test(`${name} redirects home when no advocate profile is found, and renders nothing while checking`, () => {
    assert.ok(
      /if \(advocateGate\.status === 'none'\) return <Redirect href="\/\(tabs\)\/home" \/>;/.test(src),
      `${name} has no redirect for advocateGate.status === 'none'`
    );
    assert.ok(
      /if \(advocateGate\.status === 'loading'\) return null;/.test(src),
      `${name} does not guard the loading state`
    );
  });

  test(`${name} calls useAdvocateProfile as an unconditional hook, before its own early-returning status checks`, () => {
    const gateCallIdx = src.search(/const advocateGate = useAdvocateProfile\(\);/);
    const noneCheckIdx = src.search(/if \(advocateGate\.status === 'none'\)/);
    assert.ok(gateCallIdx !== -1 && noneCheckIdx !== -1, 'could not locate both the hook call and the status check');
    assert.ok(
      gateCallIdx < noneCheckIdx,
      `${name}: useAdvocateProfile() must be called before any early return based on its result`
    );
  });
}

test('(tabs)/advocate.tsx is untouched by this fix -- it already branches on profile === \'none\' vs a real profile', () => {
  const src = readFileSync(join(APP, '(tabs)', 'advocate.tsx'), 'utf8');
  assert.ok(src.includes("profile === 'none'"), 'advocate.tsx should still show the register prompt for a non-advocate');
  assert.ok(
    !src.includes('useAdvocateProfile'),
    'advocate.tsx has its own correct profile branching already -- it should not need the shared hook'
  );
});

test('advocate-register.tsx is untouched by this fix -- registering must stay open to any signed-in citizen', () => {
  const src = readFileSync(join(APP, 'advocate-register.tsx'), 'utf8');
  assert.ok(
    !src.includes('useAdvocateProfile'),
    'advocate-register.tsx is the registration form itself and must remain reachable by non-advocates'
  );
});

test('backend notetaker endpoints remain gated server-side too (defense in depth, unaffected by this frontend fix)', () => {
  const routerSrc = readFileSync(
    join(__dirname, '..', '..', '..', 'backend', 'api', 'advocate_notetaker_router.py'),
    'utf8'
  );
  assert.ok(routerSrc.includes('async def _require_advocate('));
  assert.ok(routerSrc.includes('raise HTTPException(403, "An advocate profile is required'));
});
