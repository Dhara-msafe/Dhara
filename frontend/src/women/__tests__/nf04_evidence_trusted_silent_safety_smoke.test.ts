/**
 * NF-04 (Day 4 QA journey) — Evidence Locker, Trusted Circle, Silent Alert,
 * Safety Plan smoke test. Register's own "how" column says "Screen walk on
 * QA, 10-minute smoke" — this is a manual-QA-style journey, not meant to be
 * replaced wholesale by automation. This file covers what IS checkable from
 * here: dead-import wiring across all five screens, and a regression guard
 * for the real bug this pass found (see below). The remaining device-level
 * walk (does the screen actually render, do taps work) still needs a real
 * device/QA build — tracked as Pending/yellow, same as this session's other
 * device-only items (W2-J01/J03, B-02).
 *
 * BUG FOUND AND FIXED this pass: src/women/evidenceBackup.ts's anchorItem()
 * and backupItem() sent all four of their network calls (POST
 * /api/evidence/anchor, /upload/init, /upload/chunk, /upload/complete) with
 * NO Authorization header at all. Every one of those routes requires
 * current_user server-side (api/evidence_vault_router.py; dependencies.py's
 * current_user raises 401 "Missing token" with no Bearer header present) --
 * so Evidence Locker's cloud anchor/backup feature would 401 on every real
 * attempt, in every environment, for every user. This is exactly the class
 * of break a 10-minute screen walk is meant to catch (tap "Back up" -> see
 * an error), caught here first by reading the wiring instead.
 *
 * Root cause: anchorItem/backupItem took no token parameter at all, and
 * app/women/evidence-locker.tsx only destructured `{ user }` from useAuth()
 * (needed for the per-user storage `scope`), never `token` -- so there was
 * no token in scope to pass even if the functions had accepted one.
 *
 * Fix: both functions now take a `token: string | null` parameter and send
 * it via an `authHeader(token)` helper (same `Authorization: Bearer ${token}`
 * shape already used by src/trustedCircle/api.ts's authHeaders()); the
 * screen now destructures `token` too and passes it through both call sites.
 *
 * Trusted Circle, Silent Alert and Safety Plan do NOT have this class of bug:
 *  - src/trustedCircle/api.ts's inviteContact/listInvitations/revokeInvitation
 *    already send `Authorization: Bearer ${token}` via authHeaders(), and
 *    app/women/trusted-circle.tsx already passes `token` from useAuth() to
 *    every one of those calls (confirmed below, source-level).
 *  - Trusted Circle's own contact list (getCircle/saveCircle), Silent
 *    Alert's evidence-recording preference (getSilentAlertEvidencePref/
 *    setSilentAlertEvidencePref) and Safety Plan's saved answers
 *    (getPlan/savePlan) are all local-only (AsyncStorage under a per-
 *    identity key) -- no network call, so no auth-header question applies.
 *  - women/api.ts's fetchFlags/fetchHelplines/safetyRoute intentionally send
 *    no auth header -- the matching backend routes (api/women_router.py)
 *    have no current_user dependency either (public static-content/route
 *    endpoints, confirmed earlier this session during W4-J01).
 *
 * This file runs under node:test with the repo's TS-extension-resolution
 * loader (see package.json's test:voice script), the same way
 * src/women/__tests__/evidenceSession.test.ts and
 * safetyTriggerCoordinator.test.ts already do:
 *   node --experimental-strip-types \
 *     --import ./src/voice/core/__tests__/ts-resolve.mjs \
 *     --test src/women/__tests__/nf04_evidence_trusted_silent_safety_smoke.test.ts
 *
 * It is a source-level guard, not an import-and-invoke test: evidenceBackup.ts
 * transitively imports AsyncStorage / expo-crypto / expo-file-system's
 * `/legacy` subpath, which this sandbox's plain Node ESM resolver cannot
 * follow (expo-file-system's package.json has no "./legacy" export Node
 * understands outside Metro) -- confirmed by a direct import attempt, which
 * failed with "Cannot find module '.../expo-file-system/legacy'" even with
 * node_modules fully installed. Reading the exact source text sidesteps
 * that entirely and still catches a reintroduced "forgot the header" bug,
 * the same tradeoff this session's backend AST-based admin-key scanner
 * (test_xcsec_admin_gating_and_security_review.py) already made deliberately.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const FRONTEND_DIR = path.resolve(import.meta.dirname, '..', '..', '..');

function read(relPath: string): string {
  return fs.readFileSync(path.join(FRONTEND_DIR, relPath), 'utf-8');
}

// ── Dead-import check across all five NF-04 screens ─────────────────────────
// Resolves every `@/...` import in each screen to confirm the file it names
// actually exists (.ts/.tsx/index.ts/index.tsx) -- the same check this
// session already ran once over these screens; re-asserted here as a
// regression guard now that evidenceBackup.ts's signature changed.

const NF04_SCREENS = [
  'app/women/evidence-locker.tsx',
  'app/women/trusted-circle.tsx',
  'app/women/silent-alert.tsx',
  'app/women/safety-plan.tsx',
  'app/women/code-phrase.tsx',
];

function resolveAtImport(fromScreenRelPath: string, importPath: string): string | null {
  // importPath looks like '@/src/women/api' -- '@' is the repo root alias.
  const withoutAlias = importPath.replace(/^@\//, '');
  const candidates = [
    `${withoutAlias}.ts`,
    `${withoutAlias}.tsx`,
    `${withoutAlias}/index.ts`,
    `${withoutAlias}/index.tsx`,
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(FRONTEND_DIR, c))) return c;
  }
  return null;
}

for (const screen of NF04_SCREENS) {
  test(`NF-04: ${screen} has no dead @/ imports`, () => {
    const src = read(screen);
    const importRe = /from\s+['"](@\/[^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    const checked: string[] = [];
    while ((m = importRe.exec(src))) {
      const resolved = resolveAtImport(screen, m[1]);
      assert.ok(resolved, `${screen}: import "${m[1]}" does not resolve to any existing file`);
      checked.push(m[1]);
    }
    // Confidence check on the scan itself: every one of these screens is
    // known to use at least one @/ import (theme, auth, or an api module) --
    // if this ever found zero, the regex itself broke silently.
    assert.ok(checked.length > 0, `${screen}: expected at least one @/ import, found none`);
  });
}

// ── Regression guard for the auth-header bug this pass fixed ───────────────

test('NF-04 fix: evidenceBackup.ts anchorItem/backupItem accept a token and send it on every request', () => {
  const src = read('src/women/evidenceBackup.ts');

  // Signatures must declare a token parameter (not rely on module-level
  // state or a closed-over value -- the caller must supply it explicitly).
  assert.match(
    src,
    /export async function anchorItem\(\s*scope: string,\s*item: RecordingItem,\s*gps: GpsPoint \| null \| undefined,\s*token: string \| null,/,
    'anchorItem() must take an explicit token parameter',
  );
  assert.match(
    src,
    /export async function backupItem\(\s*scope: string,\s*item: RecordingItem,\s*onProgress: \(\(fraction: number\) => void\) \| undefined,\s*token: string \| null,/,
    'backupItem() must take an explicit token parameter',
  );

  // Every fetch() call against this router must spread the auth header in.
  const fetchBlocks = [...src.matchAll(/await fetch\(`\$\{base\}[^`]*`,\s*\{[\s\S]*?\}\);/g)].map(m => m[0]);
  assert.equal(fetchBlocks.length, 4, `expected exactly 4 fetch() calls in evidenceBackup.ts, found ${fetchBlocks.length}`);
  for (const block of fetchBlocks) {
    assert.match(
      block,
      /\.\.\.authHeader\(token\)/,
      `every evidenceBackup.ts fetch() call must include ...authHeader(token) in its headers -- got:\n${block}`,
    );
  }

  // The helper itself: omits the header entirely for a null/empty token
  // (never sends "Authorization: Bearer null"), matching
  // src/trustedCircle/api.ts's authHeaders() pattern exactly.
  assert.match(src, /function authHeader\(token: string \| null\): Record<string, string> \{/);
  assert.match(src, /return token \? \{ Authorization: `Bearer \$\{token\}` \} : \{\};/);
});

test('NF-04 fix: evidence-locker.tsx pulls token from useAuth() and threads it through both call sites', () => {
  const src = read('app/women/evidence-locker.tsx');

  assert.match(
    src,
    /const \{ user, token \} = useAuth\(\);/,
    'evidence-locker.tsx must destructure token from useAuth(), not just user',
  );
  assert.match(src, /await anchorItem\(scope, item, gps, token\);/);
  assert.match(
    src,
    /await backupItem\(scope, item, fraction => setBackingUp\(prev => \(\{ \.\.\.prev, \[item\.id\]: fraction \}\)\), token\);/,
  );

  // useCallback dependency arrays must list token too, or the closures
  // would keep calling anchorItem/backupItem with a stale (possibly null)
  // token after the real one loads in.
  assert.match(src, /\}, \[scope, token\]\);/g as any);
  const depArrayMatches = [...src.matchAll(/\}, \[scope, token\]\);/g)];
  assert.equal(depArrayMatches.length, 2, 'expected both doAnchor and handleBackup to list [scope, token] as deps');
});

// ── Confirms the three screens that did NOT need this fix, so a future
// regression in any of them is caught the same way ─────────────────────────

test('NF-04: trusted-circle.tsx already threads token through every trustedCircle/api.ts call', () => {
  const src = read('app/women/trusted-circle.tsx');
  assert.match(src, /const \{ token: authToken \} = useAuth\(\);/);
  assert.match(src, /listInvitations\(authToken, 'sent'\)/);
  assert.match(src, /inviteContact\(authToken, \{/);
  assert.match(src, /revokeInvitation\(authToken, invite\.id\)/);
});

test('NF-04: trustedCircle/api.ts sends Authorization on every network call, omitting it for a falsy token', () => {
  const src = read('src/trustedCircle/api.ts');
  assert.match(src, /function authHeaders\(token: string \| null\): Record<string, string> \{/);
  assert.match(src, /return token \? \{ Authorization: `Bearer \$\{token\}` \} : \{\};/);
});

test('NF-04: Silent Alert and Safety Plan preferences are local-only (no network call, so no auth-header question applies)', () => {
  const src = read('src/women/api.ts');
  // getSilentAlertEvidencePref/setSilentAlertEvidencePref and getPlan/savePlan
  // must not call fetch() at all -- they are AsyncStorage-backed, per-
  // identity local state, same as getCircle/saveCircle.
  const localOnlyFns = [
    'getSilentAlertEvidencePref', 'setSilentAlertEvidencePref', 'getPlan', 'savePlan',
  ];
  for (const fnName of localOnlyFns) {
    const re = new RegExp(`export async function ${fnName}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`);
    const m = src.match(re);
    assert.ok(m, `${fnName} not found in src/women/api.ts`);
    assert.doesNotMatch(m![1], /fetch\(/, `${fnName} unexpectedly calls fetch() -- it was expected to be AsyncStorage-only`);
  }
});

test('NF-04: fetchFlags/fetchHelplines/safetyRoute remain intentionally public (no Authorization header)', () => {
  const src = read('src/women/api.ts');
  for (const fnName of ['fetchFlags', 'fetchHelplines', 'safetyRoute']) {
    const re = new RegExp(`export async function ${fnName}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`);
    const m = src.match(re);
    assert.ok(m, `${fnName} not found in src/women/api.ts`);
    assert.doesNotMatch(m![1], /Authorization/, `${fnName} unexpectedly sends an Authorization header -- confirmed public/unauthenticated by design (matching backend's women_router.py routes, which have no current_user dependency)`);
  }
});
