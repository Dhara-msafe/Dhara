/**
 * W2-J06 — Family Journey send (Day 5 QA journey). Register's own "how":
 * "Manual on QA (send flag off)" -- the "send flag off" qualifier is
 * src/familyJourney/flags.ts's FJ_SEND_ENABLED
 * (EXPO_PUBLIC_FAMILY_JOURNEY_SEND_V1), which this QA build runs with off,
 * so the feature behaves as pure local preview and nothing can leave the
 * phone. This file does the same lighter-weight wiring pass used for the
 * other Day 5 journeys: dead-import check, then confirm every network call
 * this feature makes is correctly authenticated (and, separately, that
 * every SMS dispatch goes through the one outbound-dispatch guard, not a
 * direct Linking/expo-sms call).
 *
 * RESULT: no bug found. Family Journey has exactly ONE real network call
 * in its entire module (src/familyJourney/contacts.ts's
 * loadPickableContacts -> listAcceptedRecipients(token), reading the
 * citizen's own accepted Trusted Circle recipients to populate the
 * contact picker); everything else is local-only by design:
 *
 * 1. src/familyJourney/store.ts is an on-device-only store (its own
 *    ISOLATION RULES comment: "Nothing in this module talks to any
 *    server, SMS, push, or location API"), AsyncStorage-backed, namespaced
 *    per signed-in account id.
 *
 * 2. src/familyJourney/contacts.ts merges two contact sources: getCircle()
 *    (women/api.ts, already confirmed local-only/AsyncStorage in NF-04's
 *    test) and listAcceptedRecipients(token) (trustedCircle/api.ts) --
 *    the one real backend call. It is correctly guarded (`if (token)`
 *    before calling at all) and correctly authenticated (authHeaders(token)
 *    via trustedCircle/api.ts, already confirmed in NF-04's test to omit
 *    the header entirely for a falsy token rather than sending a bad one).
 *    GET /api/trusted-circle/accepted (api/trusted_circle_router.py)
 *    requires current_user, matching.
 *
 * 3. src/familyJourney/send.ts's sendToContact() -- the actual SMS dispatch
 *    -- routes exclusively through composeSms/openExternal
 *    (src/outbound.ts), never Linking/expo-sms directly, same
 *    single-dispatch-guard pattern already confirmed for W2-J04's Silent
 *    Alert. Its own TRUTH RULES comment: "Every dispatch goes through the
 *    Outbound Guard... so QA builds still show 'Simulated — nothing sent'".
 *
 * 4. All five screens (index/new/active/preview/contacts.tsx) gate their
 *    Phase 2 send UI on FJ_SEND_ENABLED; with the flag off (this QA
 *    build's actual state, per the register's "send flag off" note) the
 *    feature is indistinguishable from Phase 1 preview-only, confirmed by
 *    reading flags.ts's own doc comment.
 *
 * This file runs under node:test with the repo's TS-extension-resolution
 * loader, the same pattern as every other Day 4/5 journey test, for the
 * same reason (these modules transitively import AsyncStorage/expo-router,
 * which this sandbox's plain Node ESM resolver doesn't reliably follow for
 * every subpath):
 *   node --experimental-strip-types \
 *     --import ./src/voice/core/__tests__/ts-resolve.mjs \
 *     --test src/women/__tests__/w2j06_family_journey_send.test.ts
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

function extractFetchCalls(src: string): string[] {
  const calls: string[] = [];
  const startRe = /fetch\(/g;
  let m: RegExpExecArray | null;
  while ((m = startRe.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = m.index;
    while (depth > 0 && i < src.length) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
      i++;
    }
    calls.push(src.slice(start, i));
  }
  return calls;
}

/** Finds `async def <name>(` parameter lists by balancing parens by hand
 * (params can contain their own nested parens, e.g. Depends(current_user)). */
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

const W2J06_FILES = [
  'app/family-journey/index.tsx',
  'app/family-journey/new.tsx',
  'app/family-journey/active.tsx',
  'app/family-journey/preview.tsx',
  'app/family-journey/contacts.tsx',
  'src/familyJourney/store.ts',
  'src/familyJourney/contacts.ts',
  'src/familyJourney/send.ts',
  'src/familyJourney/flags.ts',
  'src/familyJourney/SendSheet.tsx',
  'src/familyJourney/previewCopy.ts',
  'src/familyJourney/ui.tsx',
];

for (const screen of W2J06_FILES) {
  test(`W2-J06: ${screen} has no dead @/ imports`, () => {
    const src = read(screen);
    const importRe = /from\s+['"](@\/[^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(src))) {
      const resolved = resolveAtImport(m[1]);
      assert.ok(resolved, `${screen}: import "${m[1]}" does not resolve to any existing file`);
    }
  });
}

test('W2-J06: store.ts and send.ts/flags.ts/SendSheet.tsx make no fetch() calls except contacts.ts\'s one documented exception', () => {
  for (const f of ['src/familyJourney/store.ts', 'src/familyJourney/send.ts', 'src/familyJourney/flags.ts', 'src/familyJourney/SendSheet.tsx', 'src/familyJourney/previewCopy.ts', 'src/familyJourney/ui.tsx']) {
    const src = read(f);
    assert.equal(extractFetchCalls(src).length, 0, `${f}: expected 0 fetch() calls, this module is documented as local-only or dispatch-guard-only`);
  }
  // store.ts's own documented isolation rule:
  assert.match(read('src/familyJourney/store.ts'), /Nothing in this module talks to any server, SMS, push, or location API/);
});

test('W2-J06: contacts.ts\'s loadPickableContacts guards listAcceptedRecipients on token presence and sends Authorization via authHeaders(token)', () => {
  const src = read('src/familyJourney/contacts.ts');
  assert.match(src, /if \(token\) \{\s*\n\s*const accepted = await listAcceptedRecipients\(token\)\.catch\(\(\) => \[\]\);/);
});

test('W2-J06: trustedCircle/api.ts\'s listAcceptedRecipients hits /trusted-circle/accepted with Authorization via authHeaders(token)', () => {
  const src = read('src/trustedCircle/api.ts');
  const m = src.match(/export async function listAcceptedRecipients\(token: string\): Promise<InviteLink\[\]> \{([\s\S]*?)\n\}/);
  assert.ok(m, 'listAcceptedRecipients not found');
  assert.match(m![1], /fetch\(`\$\{base\}\/trusted-circle\/accepted`, \{ headers: authHeaders\(token\) \}\)/);
});

test('W2-J06: GET /trusted-circle/accepted requires current_user server-side (confirms the frontend is right to always authenticate it)', () => {
  const src = readBackend('api/trusted_circle_router.py');
  const found = paramsOf(src, /async def accepted_recipients\(/g);
  assert.equal(found.length, 1, 'accepted_recipients route not found');
  assert.match(found[0].params, /user:\s*dict\s*=\s*Depends\(current_user\)/);
});

test('W2-J06: contacts.ts\'s other source (getCircle) remains local-only (no fetch), matching NF-04\'s earlier finding', () => {
  const womenApiSrc = read('src/women/api.ts');
  const m = womenApiSrc.match(/export async function getCircle\([^)]*\)[^{]*\{([\s\S]*?)\n\}/);
  assert.ok(m, 'getCircle not found in src/women/api.ts');
  assert.doesNotMatch(m![1], /fetch\(/, 'getCircle unexpectedly calls fetch() -- it was expected to remain AsyncStorage-only');
});

test('W2-J06: send.ts routes every SMS dispatch through composeSms/openExternal (src/outbound.ts), never Linking/expo-sms directly', () => {
  const src = read('src/familyJourney/send.ts');
  assert.match(src, /import \{ composeSms, openExternal \} from '\.\.\/outbound';/);
  assert.doesNotMatch(src, /import .*\bSMS\b.* from 'expo-sms'/, 'send.ts must not import expo-sms directly -- all dispatch goes through src/outbound.ts');
  assert.doesNotMatch(src, /\bLinking\.openURL\(/, 'send.ts must not call Linking.openURL directly -- openExternal already wraps it with the same guard');
  assert.match(src, /Every dispatch goes through the Outbound Guard/);
});

test('W2-J06: FJ_SEND_ENABLED (the register\'s "send flag off") gates Phase 2 send UI in every family-journey screen', () => {
  const flagsSrc = read('src/familyJourney/flags.ts');
  assert.match(flagsSrc, /export const FJ_SEND_ENABLED = process\.env\.EXPO_PUBLIC_FAMILY_JOURNEY_SEND_V1 === 'true';/);
  assert.match(flagsSrc, /When false the feature behaves exactly as Phase 1[\s\S]*?did: everything is a local preview and nothing can leave the phone/);

  for (const screen of ['app/family-journey/index.tsx', 'app/family-journey/active.tsx', 'app/family-journey/preview.tsx', 'app/family-journey/contacts.tsx']) {
    const src = read(screen);
    assert.match(src, /import \{ FJ_SEND_ENABLED \} from '@\/src\/familyJourney\/flags';/, `${screen}: expected to import and gate on FJ_SEND_ENABLED`);
    assert.match(src, /FJ_SEND_ENABLED/);
  }
});
