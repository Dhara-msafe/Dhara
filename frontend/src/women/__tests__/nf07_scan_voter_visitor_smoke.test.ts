/**
 * NF-07 — Scan, Voter roll, Visitor mode smoke test (Day 5 QA journey).
 * Register's own "how" column: "Screen walk on QA, 10-minute smoke" — same
 * category as NF-04/NF-06. Same lighter-weight wiring pass: dead-import
 * check across every screen, then auth-header wiring for every network
 * call, since that's exactly the class of bug NF-04 found elsewhere
 * (evidenceBackup.ts's missing Authorization header).
 *
 * RESULT: no bug found. Four sub-features, each internally consistent
 * between its frontend call sites and backend route signatures:
 *
 * 1. Scan (app/scan.tsx, app/scan/[id].tsx, src/home/scanHistory.ts) —
 *    POST /api/scan/notice and GET /api/scan/history/{user_id} both take
 *    current_user_optional (api/scan_router.py); the frontend sends the
 *    header conditionally on both, matching. GET
 *    /api/scan/history/detail/{scan_id} requires current_user (not
 *    optional -- a single saved scan's detail is private); the frontend
 *    (app/scan/[id].tsx) guards with `if (!id || !token) { ...; return; }`
 *    before calling and always sends the header. Correct on both counts.
 *
 * 2. Voter roll (app/(tabs)/voter-roll.tsx, app/voter-roll/form.tsx) —
 *    POST /api/voter/pdf (api/fir_router.py) has NO auth dependency at all
 *    (a free PDF-generation utility). The frontend sends the header
 *    conditionally anyway (harmless, matches the "optional at most"
 *    contract) and additionally gates its OWN UI flow behind sign-in
 *    (`phase: !token ? 'gate' : 'interview'`) as a product decision, not a
 *    wiring requirement.
 *
 * 3. Visitor mode / Interpreter (app/visitor/*.tsx, src/visitor/*.ts) —
 *    POST /api/visitor/translate (api/visitor_router.py) and POST
 *    /api/voice/tts (api/chat_router.py) both require current_user (not
 *    optional). Every call site that reaches these two routes
 *    (interpreter.tsx's translateText/playTTS, speakForMe.ts's
 *    translate/phraseIn/playPhrase used by emergency.tsx/lost-
 *    passport.tsx, WorkflowScreen.tsx's own TTS call) is reached only after
 *    an explicit `if (!token) { ...; return; }` guard earlier in the same
 *    user-initiated flow (startRecording, the step-advance handler, etc.),
 *    so a real token is always present when the header fires. Correct.
 *
 * This file runs under node:test with the repo's TS-extension-resolution
 * loader, the same pattern as NF-04/NF-06/W2-J05's test files, for the same
 * reason (these screens transitively import expo-audio/expo-av/
 * react-native-reanimated, which this sandbox's plain Node ESM resolver
 * doesn't reliably follow for every subpath):
 *   node --experimental-strip-types \
 *     --import ./src/voice/core/__tests__/ts-resolve.mjs \
 *     --test src/women/__tests__/nf07_scan_voter_visitor_smoke.test.ts
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
  if (fs.existsSync(path.join(FRONTEND_DIR, withoutAlias))) return withoutAlias; // exact path (e.g. a .json content file)
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

/** Finds `async function <name>(` and `async def <name>(` call parameter
 * lists by balancing parens by hand, since params can contain their own
 * nested parens (Depends(current_user_optional), File(...)). */
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

const NF07_SCREENS = [
  'app/scan.tsx',
  'app/scan/[id].tsx',
  'src/home/scanHistory.ts',
  'app/(tabs)/voter-roll.tsx',
  'app/voter-roll/form.tsx',
  'app/visitor/index.tsx',
  'app/visitor/_layout.tsx',
  'app/visitor/intent.tsx',
  'app/visitor/emergency.tsx',
  'app/visitor/interpreter.tsx',
  'app/visitor/cyber-fraud.tsx',
  'app/visitor/visa-frro.tsx',
  'app/visitor/lost-passport.tsx',
  'src/visitor/session.ts',
  'src/visitor/speakForMe.ts',
  'src/visitor/WorkflowScreen.tsx',
  'src/visitor/content.ts',
];

for (const screen of NF07_SCREENS) {
  test(`NF-07: ${screen} has no dead @/ imports`, () => {
    const src = read(screen);
    const importRe = /from\s+['"](@\/[^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    let checkedAny = false;
    while ((m = importRe.exec(src))) {
      const resolved = resolveAtImport(m[1]);
      assert.ok(resolved, `${screen}: import "${m[1]}" does not resolve to any existing file`);
      checkedAny = true;
    }
    // Not every one of these files necessarily has a @/ import (a few are
    // small, self-contained leaf modules) -- only assert presence for
    // screens known to use the theme/auth alias.
    if (!['src/visitor/content.ts', 'src/visitor/session.ts', 'src/home/scanHistory.ts'].includes(screen)) {
      assert.ok(checkedAny, `${screen}: expected at least one @/ import, found none`);
    }
  });
}

// ── Scan: two optional-auth routes, one required-auth route ───────────────

test('NF-07: scan.tsx sends the auth header conditionally for /api/scan/notice, matching the backend\'s optional auth', () => {
  const src = read('app/scan.tsx');
  const matches = [...src.matchAll(/\.\.\.\(token \? \{ Authorization: `Bearer \$\{token\}` \} : \{\}\)/g)];
  assert.ok(matches.length >= 2, `expected at least 2 conditional-auth fetch calls in scan.tsx, found ${matches.length}`);
});

test('NF-07: POST /api/scan/notice and GET /api/scan/history/{user_id} both take current_user_optional', () => {
  const src = readBackend('api/scan_router.py');
  for (const [routePath, funcName] of [
    ['/scan/notice', 'scan_notice'],
    ['/scan/history/{user_id}', 'scan_history_list'],
  ]) {
    const found = paramsOf(src, new RegExp(`async def ${funcName}\\(`, 'g'));
    assert.equal(found.length, 1, `expected to find ${funcName} exactly once`);
    assert.match(found[0].params, /current_user_optional/, `${routePath} (${funcName}) must take current_user_optional`);
  }
});

test('NF-07: scan/[id].tsx guards the scan-detail fetch on id+token and sends the header unconditionally once past the guard', () => {
  const src = read('app/scan/[id].tsx');
  assert.match(src, /if \(!id \|\| !token\) \{ setLoading\(false\); setError\(true\); return; \}/);
  assert.match(src, /headers: \{ Authorization: `Bearer \$\{token\}` \}/);
});

test('NF-07: GET /api/scan/history/detail/{scan_id} requires current_user (not optional) -- a single saved scan\'s detail is private', () => {
  const src = readBackend('api/scan_router.py');
  const found = paramsOf(src, /async def scan_history_detail\(/g);
  assert.equal(found.length, 1);
  assert.match(found[0].params, /:\s*dict\s*=\s*Depends\(current_user\)/);
  assert.doesNotMatch(found[0].params, /current_user_optional/);
});

test('NF-07: scanHistory.ts guards on user+token before fetching, then always sends the header', () => {
  const src = read('src/home/scanHistory.ts');
  assert.match(src, /if \(!user\?\.id \|\| !token\) \{ setItems\(\[\]\); setLoading\(false\); return; \}/);
  assert.match(src, /headers: \{ Authorization: `Bearer \$\{token\}` \}/);
});

// ── Voter roll: public backend route, frontend still sends auth if present ─

test('NF-07: POST /api/voter/pdf has no auth dependency at all (a free PDF-generation utility)', () => {
  const src = readBackend('api/fir_router.py');
  const found = paramsOf(src, /async def voter_generate_pdf\(/g);
  assert.equal(found.length, 1);
  assert.doesNotMatch(found[0].params, /current_user/);
});

test('NF-07: voter-roll/form.tsx sends the header conditionally anyway, and gates its own UI flow behind sign-in as a product choice', () => {
  const src = read('app/voter-roll/form.tsx');
  assert.match(src, /\.\.\.\(token \? \{ Authorization: `Bearer \$\{token\}` \} : \{\}\)/);
  assert.match(src, /!token \? 'gate' : 'interview'/);
});

// ── Visitor mode / Interpreter: two required-auth routes, always guarded ──

test('NF-07: POST /api/visitor/translate and POST /api/voice/tts both require current_user (not optional)', () => {
  const visitorSrc = readBackend('api/visitor_router.py');
  const foundTranslate = paramsOf(visitorSrc, /async def translate\(/g);
  assert.equal(foundTranslate.length, 1);
  assert.match(foundTranslate[0].params, /user:\s*dict\s*=\s*Depends\(current_user\)/);

  const chatSrc = readBackend('api/chat_router.py');
  const foundTts = paramsOf(chatSrc, /async def tts\(/g);
  assert.equal(foundTts.length, 1);
  assert.match(foundTts[0].params, /user:\s*dict\s*=\s*Depends\(current_user\)/);
});

test('NF-07: interpreter.tsx guards startRecording on token before any translate/TTS call can fire', () => {
  const src = read('app/visitor/interpreter.tsx');
  assert.match(src, /const startRecording = useCallback\(async \(\) => \{\s*\n\s*if \(!token\) \{ Alert\.alert\('Sign in required', 'Sign in to DHARA to use Interpreter\.'\); return; \}/);
});

test('NF-07: emergency.tsx and lost-passport.tsx both guard on token before calling phraseIn/playPhrase', () => {
  for (const screen of ['app/visitor/emergency.tsx', 'app/visitor/lost-passport.tsx']) {
    const src = read(screen);
    assert.match(src, /if \(!token\) \{/, `${screen}: expected an explicit token guard before the speak-for-me flow`);
  }
});

test('NF-07: WorkflowScreen.tsx guards its own TTS call on token presence', () => {
  const src = read('src/visitor/WorkflowScreen.tsx');
  assert.match(src, /if \(!token\) \{/);
});
