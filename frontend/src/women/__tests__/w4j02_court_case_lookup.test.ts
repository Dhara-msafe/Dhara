/**
 * W4-J02 — Court case lookup (CNR / party name) (Day 5 QA journey).
 * Register's own "how" column: "Manual". Same lighter-weight wiring pass
 * used for the other Day 5 journeys: dead-import check, then auth-header
 * wiring for every network call, cross-referenced against the backend
 * route's actual dependency.
 *
 * RESULT: functionally correct, no app-breaking bug -- but ONE real finding
 * worth flagging to the TL (not a functional break, a dead-code cleanup
 * item):
 *
 * src/courtData.ts exports buildCNRUrl() and buildPartySearchUrl(), which
 * build direct https://services.ecourts.gov.in/... URLs for a WebView-based
 * flow. Neither function is imported anywhere in the app any more (confirmed
 * by grepping every .ts/.tsx file for their names -- the only matches are
 * their own definitions). app/lookup-results.tsx's own header comment
 * explains why: "Replaces the old broken WebView flow (eCourts blocks
 * requests without a valid app_token). Both CNR and party-name search now
 * call our own backend proxy (/api/cases/cnr/{cnr} and /api/cases/search)".
 * The two URL-builder functions are leftover from before that rewrite --
 * harmless (nothing calls them, so they can't produce a wrong result) but
 * dead weight in courtData.ts. Flagged for the TL to decide whether to
 * delete them; not deleted here since cleanup wasn't asked for and doesn't
 * affect any shipped behaviour.
 *
 * Everything that IS live and reachable is wired correctly:
 *
 * 1. app/(tabs)/lookup.tsx (the search entry screen) imports STATES_UTS,
 *    DISTRICTS, CNR_STATE_CODES, CNR_COURT_CODES from courtData.ts (all
 *    live, all used) and parseSpokenCaseRef from
 *    src/voice/spokenCnrParser.ts for voice-dictated CNR/party input.
 *    Voice input (POST /api/voice/transcribe, api/chat_router.py) requires
 *    current_user; the frontend guards with `if (!API_BASE || !token)
 *    throw ...` before calling and always sends the header -- matches.
 *
 * 2. app/lookup-results.tsx calls GET /api/cases/cnr/{cnr} and
 *    GET /api/cases/search (server.py, case_by_cnr / search_cases), both
 *    of which require current_user. The frontend always sends
 *    `Authorization: Bearer ${token}` and, on a 401, calls forceLogout()
 *    rather than silently failing. The fetch effect itself waits for
 *    `authLoading` to resolve before firing (`if (authLoading) return;`),
 *    so it never races a not-yet-hydrated token -- by the time it fires,
 *    `token` is the real (possibly guest) session token. Guest sessions do
 *    carry a real JWT from POST /api/auth/guest (src/auth.tsx), so a guest
 *    is not blocked by this required-auth route any more than a signed-in
 *    user would be.
 *
 * This file runs under node:test with the repo's TS-extension-resolution
 * loader, the same pattern as every other Day 4/5 journey test, for the
 * same reason (these screens transitively import expo-audio/expo-router,
 * which this sandbox's plain Node ESM resolver doesn't reliably follow for
 * every subpath):
 *   node --experimental-strip-types \
 *     --import ./src/voice/core/__tests__/ts-resolve.mjs \
 *     --test src/women/__tests__/w4j02_court_case_lookup.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const FRONTEND_DIR = path.resolve(import.meta.dirname, '..', '..', '..');
const BACKEND_DIR = path.resolve(FRONTEND_DIR, '..', 'backend');

function read(relPath: string): string {
  return fs.readFileSync(path.join(FRONTEND_DIR, relPath), 'utf-8');
}
function readBackend(relPath: string): string {
  return fs.readFileSync(path.join(BACKEND_DIR, relPath), 'utf-8');
}

function resolveAtImport(importPath: string): string | null {
  const withoutAlias = importPath.replace(/^@\//, '');
  if (fs.existsSync(path.join(FRONTEND_DIR, withoutAlias))) return withoutAlias;
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

function paramsOf(src: string, pattern: RegExp): { match: RegExpExecArray; params: string }[] {
  const results: { match: RegExpExecArray; params: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (depth > 0 && i < src.length) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
      i++;
    }
    results.push({ match: m, params: src.slice(start, i - 1) });
  }
  return results;
}

const W4J02_FILES = [
  'app/(tabs)/lookup.tsx',
  'app/lookup-results.tsx',
  'src/courtData.ts',
  'src/voice/spokenCnrParser.ts',
];

for (const screen of W4J02_FILES) {
  test(`W4-J02: ${screen} has no dead @/ imports`, () => {
    const src = read(screen);
    const importRe = /from\s+['"](@\/[^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(src))) {
      const resolved = resolveAtImport(m[1]);
      assert.ok(resolved, `${screen}: import "${m[1]}" does not resolve to any existing file`);
    }
  });
}

test('W4-J02 finding: buildCNRUrl/buildPartySearchUrl in courtData.ts are dead code, superseded by the backend proxy -- not imported anywhere else', () => {
  const allSourceFiles: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) allSourceFiles.push(full);
    }
  }
  walk(path.join(FRONTEND_DIR, 'app'));
  walk(path.join(FRONTEND_DIR, 'src'));

  for (const fnName of ['buildCNRUrl', 'buildPartySearchUrl']) {
    const thisTestFile = path.join(FRONTEND_DIR, 'src/women/__tests__/w4j02_court_case_lookup.test.ts');
    const referencingFiles = allSourceFiles.filter(f => {
      if (f === path.join(FRONTEND_DIR, 'src/courtData.ts')) return false; // its own definition
      if (f === thisTestFile) return false; // this file's own doc comment names them
      const src = fs.readFileSync(f, 'utf-8');
      return src.includes(fnName);
    });
    assert.equal(
      referencingFiles.length,
      0,
      `${fnName} is referenced outside courtData.ts (${referencingFiles.join(', ')}) -- ` +
      `this test's premise (dead code, safe to leave or remove) no longer holds; re-investigate before changing anything`,
    );
  }
});

test('W4-J02: lookup.tsx imports only the live courtData exports (STATES_UTS/DISTRICTS/CNR_STATE_CODES/CNR_COURT_CODES), not the dead URL builders', () => {
  const src = read('app/(tabs)/lookup.tsx');
  assert.match(src, /STATES_UTS, DISTRICTS, CNR_STATE_CODES, CNR_COURT_CODES,?\s*\n?\s*\} from '@\/src\/courtData';/);
  assert.doesNotMatch(src, /buildCNRUrl|buildPartySearchUrl/);
});

test('W4-J02: voice-dictated CNR/party input (whisperTranscribeFile) is guarded on token presence and always sends Authorization', () => {
  const src = read('app/(tabs)/lookup.tsx');
  const guardMatches = [...src.matchAll(/if \(!API_BASE \|\| !token\) throw new Error\('Voice input is unavailable'\);/g)];
  assert.ok(guardMatches.length >= 2, `expected at least 2 token guards before whisperTranscribeFile calls, found ${guardMatches.length}`);

  const sttSrc = read('src/voice/stt.ts');
  assert.match(sttSrc, /headers: \{ Authorization: `Bearer \$\{token\}` \}/);
});

test('W4-J02: POST /api/voice/transcribe requires current_user server-side (confirms the frontend is right to always authenticate it)', () => {
  const src = readBackend('api/chat_router.py');
  const found = paramsOf(src, /async def transcribe\(/g);
  assert.equal(found.length, 1);
  assert.match(found[0].params, /user:\s*dict\s*=\s*Depends\(current_user\)/);
});

test('W4-J02: lookup-results.tsx waits for authLoading before fetching, then always sends Authorization, and forceLogout()s on a 401', () => {
  const src = read('app/lookup-results.tsx');
  assert.match(src, /const \{ token, loading: authLoading, forceLogout \} = useAuth\(\);/);
  assert.match(src, /const authHeaders = \{ Authorization: `Bearer \$\{token\}` \};/);
  assert.match(src, /if \(authLoading\) return;/);

  const fetchCalls = [...src.matchAll(/if \(r\.status === 401\) \{ await forceLogout\(\); return; \}/g)];
  assert.ok(fetchCalls.length >= 2, `expected at least 2 fetch call sites to forceLogout() on 401, found ${fetchCalls.length}`);
});

test('W4-J02: GET /api/cases/cnr/{cnr} and GET /api/cases/search both require current_user server-side (confirms the frontend is right to always authenticate them)', () => {
  const src = readBackend('server.py');
  for (const funcName of ['case_by_cnr', 'search_cases']) {
    const found = paramsOf(src, new RegExp(`async def ${funcName}\\(`, 'g'));
    assert.equal(found.length, 1, `expected to find ${funcName} exactly once`);
    assert.match(found[0].params, /user:\s*dict\s*=\s*Depends\(current_user\)/, `${funcName} does not require current_user`);
  }
});

test('W4-J02: guest sessions carry a real JWT (POST /api/auth/guest), so the required-auth case-lookup routes do not block guests any more than signed-in users', () => {
  const src = read('src/auth.tsx');
  assert.match(src, /const r = await fetch\(`\$\{API\}\/api\/auth\/guest`, \{/);
  assert.match(src, /is_guest\?: boolean;/);
});
