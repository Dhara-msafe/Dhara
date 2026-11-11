/**
 * W2-J04 — Code phrase → Silent Alert / Evidence Locker (Day 5 QA journey).
 * Register's own "how" column: "Manual" (a real device + microphone is
 * needed to actually hear/type the phrase and confirm recording starts,
 * same category as W2-J05's GPS requirement). This file does the same
 * lighter-weight wiring pass used for the other Day 5 journeys: confirm
 * the phrase-match → recording → navigation chain is wired correctly, and
 * confirm the auth-header question that mattered for NF-04/NF-06/NF-07
 * simply does not apply here.
 *
 * RESULT: no bug found. This entire journey is local-only by design (the
 * module's own PRIVACY CONTRACT comment: "No audio data leaves the
 * device"):
 *
 * 1. Code phrase match (app/(tabs)/index.tsx's send()) — SOS phrase is
 *    checked FIRST (before the D1-V hide-phrase check, before
 *    trackEvent/setMessages/LLM), so a true positive is swallowed and
 *    never reaches the backend, analytics, or chat history. On match it
 *    calls triggerSafetySequence({ scope, startEvidenceRecording:
 *    startTriggerRecording, navigateToSilentAlert }) and returns.
 *
 * 2. safetyTriggerCoordinator.triggerSafetySequence() — starts evidence
 *    recording (if a callback is given) THEN navigates to Silent Alert
 *    regardless of whether recording succeeded, so the user always lands
 *    on a reachable screen. Every step is wrapped so a recorder failure
 *    (mic permission denied, already recording) never blocks navigation.
 *    Gated on EXPO_PUBLIC_SAFE_WORD_V1 (default-on; only an explicit
 *    'false' disables it).
 *
 * 3. EvidenceRecorderProvider.startTriggerRecording() — local
 *    expo-audio recorder only (AudioModule permission check,
 *    recorder.prepareToRecordAsync/record(), claimMic() for the shared-mic
 *    arbiter). No fetch(), no network call, no Authorization header of any
 *    kind -- there is nothing to wire to auth here. (The *separate*,
 *    user-initiated "Back up to cloud" button on the Evidence Locker
 *    screen is a different, already-covered code path -- NF-04 found and
 *    fixed its missing auth header in evidenceBackup.ts; this phrase-
 *    triggered recording-start path never touches that file.)
 *
 * 4. app/women/silent-alert.tsx — zero fetch() calls. "Prepare SMS" calls
 *    src/women/helpActions.ts's composeAlert(), which routes through
 *    src/outbound.ts's composeSms() (the app's single outbound-dispatch
 *    guard), never Linking/expo-sms directly. The register's "send flag
 *    off" qualifier is this same guard: EXPO_PUBLIC_OUTBOUND_MODE !==
 *    'live' simulates every dispatch (shows "Simulated — nothing sent",
 *    opens no real SMS composer) so QA can exercise the full flow without
 *    actually texting anyone.
 *
 * 5. triggerFromSilentAlert() (the toggle-evidence-on-send path) is gated
 *    on EXPO_PUBLIC_SILENT_ALERT_EVIDENCE_V1 and, like triggerSafetySequence,
 *    only ever calls the local startEvidenceRecording callback -- no
 *    network call here either.
 *
 * This file runs under node:test with the repo's TS-extension-resolution
 * loader, the same pattern as every other Day 4/5 journey test, for the
 * same reason (these modules transitively import expo-audio/expo-location/
 * expo-router, which this sandbox's plain Node ESM resolver doesn't
 * reliably follow for every subpath):
 *   node --experimental-strip-types \
 *     --import ./src/voice/core/__tests__/ts-resolve.mjs \
 *     --test src/women/__tests__/w2j04_code_phrase_silent_alert_evidence_locker.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const FRONTEND_DIR = path.resolve(import.meta.dirname, '..', '..', '..');

function read(relPath: string): string {
  return fs.readFileSync(path.join(FRONTEND_DIR, relPath), 'utf-8');
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

/** Every `fetch(...)` call in a file, as its full call-expression text
 * (balances parens so a multi-line call isn't cut off at the first inner
 * `)`). */
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

const W2J04_FILES = [
  'app/women/code-phrase.tsx',
  'app/women/silent-alert.tsx',
  'src/women/codePhraseMatcher.ts',
  'src/women/codePhraseHelpers.ts',
  'src/women/codePhraseStore.ts',
  'src/women/safetyTriggerCoordinator.ts',
  'src/women/EvidenceRecorderProvider.tsx',
  'src/outbound.ts',
  'src/women/helpActions.ts',
];

for (const screen of W2J04_FILES) {
  test(`W2-J04: ${screen} has no dead @/ imports`, () => {
    const src = read(screen);
    const importRe = /from\s+['"](@\/[^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(src))) {
      const resolved = resolveAtImport(m[1]);
      assert.ok(resolved, `${screen}: import "${m[1]}" does not resolve to any existing file`);
    }
  });
}

test('W2-J04: app/(tabs)/index.tsx checks the SOS code phrase before trackEvent/LLM send and swallows a match', () => {
  const src = read('app/(tabs)/index.tsx');
  assert.match(src, /import \{ isCodePhraseMatch \} from '@\/src\/women\/codePhraseMatcher';/);
  assert.match(src, /import \{ triggerSafetySequence \} from '@\/src\/women\/safetyTriggerCoordinator';/);

  // The SOS check must run, and its match branch must return before any
  // send-to-backend/analytics code further down in the same function.
  const sosBlockMatch = src.match(
    /if \(stored && isCodePhraseMatch\(q, stored\)\) \{[\s\S]*?await triggerSafetySequence\(\{[\s\S]*?startEvidenceRecording: startTriggerRecording,[\s\S]*?navigateToSilentAlert: \(\) => router\.push\('\/women\/silent-alert'\),[\s\S]*?\}\);[\s\S]*?setInput\(''\);[\s\S]*?return; \/\/ DO NOT send to LLM, analytics, or chat history/,
  );
  assert.ok(sosBlockMatch, 'SOS code-phrase match block must call triggerSafetySequence with startEvidenceRecording + navigateToSilentAlert, then return before any send/analytics');
});

test('W2-J04: triggerSafetySequence always attempts recording then navigation, with every recorder step wrapped against failure', () => {
  const src = read('src/women/safetyTriggerCoordinator.ts');
  const fnMatch = src.match(/export async function triggerSafetySequence\(([\s\S]*?)\n\}\n/);
  assert.ok(fnMatch, 'triggerSafetySequence not found');
  const body = fnMatch![1];

  // Default-on gate: only an explicit 'false' disables it (never a missing var).
  assert.match(body, /if \(process\.env\.EXPO_PUBLIC_SAFE_WORD_V1 === 'false'\)/);

  // Recording attempt wrapped in try/catch so a recorder failure can't throw
  // out of the whole sequence.
  assert.match(body, /try \{[\s\S]*?callbacks\.startEvidenceRecording\(callbacks\.scope\)[\s\S]*?\} catch \{/);

  // Navigation happens unconditionally after the recording attempt (not
  // gated on evidenceStarted), and is itself wrapped in try/catch.
  assert.match(body, /if \(callbacks\.navigateToSilentAlert\) \{\s*\n\s*try \{ callbacks\.navigateToSilentAlert\(\); alertNavigated = true; \} catch \{\}/);
});

test('W2-J04: triggerFromSilentAlert is gated on EXPO_PUBLIC_SILENT_ALERT_EVIDENCE_V1 and only calls the local recording callback (no network)', () => {
  const src = read('src/women/safetyTriggerCoordinator.ts');
  const fnMatch = src.match(/export async function triggerFromSilentAlert\(([\s\S]*?)\n\}\n?$/);
  assert.ok(fnMatch, 'triggerFromSilentAlert not found');
  const body = fnMatch![1];
  assert.match(body, /if \(process\.env\.EXPO_PUBLIC_SILENT_ALERT_EVIDENCE_V1 !== 'true'\)/);
  assert.doesNotMatch(body, /fetch\(/, 'triggerFromSilentAlert must not make any network call');
});

test('W2-J04: EvidenceRecorderProvider.startTriggerRecording is a local-only mic recorder with no fetch()/Authorization anywhere in the file', () => {
  const src = read('src/women/EvidenceRecorderProvider.tsx');
  assert.doesNotMatch(src, /fetch\(/, 'EvidenceRecorderProvider.tsx must not make any network call -- recording is local-only per its own PRIVACY CONTRACT comment');
  assert.doesNotMatch(src, /Authorization/);
  assert.match(src, /PRIVACY CONTRACT: No audio data leaves the device/);
  assert.match(src, /const startTriggerRecording = useCallback\(async \(_scope: string\): Promise<StartRecordingOutcome> => \{/);
  assert.match(src, /await AudioModule\.getRecordingPermissionsAsync\(\)/);
});

test('W2-J04: silent-alert.tsx makes zero fetch() calls (SMS composed locally via the outbound guard, never a backend call)', () => {
  const src = read('app/women/silent-alert.tsx');
  const calls = extractFetchCalls(src);
  assert.equal(calls.length, 0, `expected 0 fetch() calls in silent-alert.tsx, found ${calls.length}`);
  assert.match(src, /import \{ composeAlert \} from '@\/src\/women\/helpActions';/);
  assert.match(src, /import \{ OUTBOUND_LIVE, SIMULATED_TEXT \} from '@\/src\/outbound';/);
});

test('W2-J04: helpActions.composeAlert routes every SMS dispatch through outbound.ts\'s composeSms guard, never Linking/expo-sms directly', () => {
  const src = read('src/women/helpActions.ts');
  assert.match(src, /import \{ openExternal, composeSms, SIMULATED_TEXT \} from '@\/src\/outbound';/);
  assert.doesNotMatch(src, /import .*\bSMS\b.* from 'expo-sms'/, 'helpActions.ts must not import expo-sms directly -- all dispatch goes through src/outbound.ts');
  const composeSmsCalls = [...src.matchAll(/composeSms\(/g)];
  assert.ok(composeSmsCalls.length >= 1, 'expected at least one composeSms(...) call in helpActions.ts');
});

test('W2-J04: outbound.ts is the sole gate for SMS dispatch -- a static test already enforces this app-wide', () => {
  // src/__tests__/outboundGuard.test.mjs is the existing, broader static
  // check ("fails the build if any file other than this one calls
  // Linking.openURL, SMS.sendSMSAsync or Share.share directly") -- confirm
  // it still exists and still covers helpActions.ts's call site, rather
  // than re-implementing that scan here.
  const outboundSrc = read('src/outbound.ts');
  assert.match(outboundSrc, /export const OUTBOUND_LIVE = process\.env\.EXPO_PUBLIC_OUTBOUND_MODE === 'live';/);
  assert.match(outboundSrc, /export async function composeSms\(recipients: string\[\], body: string\): Promise<SmsResult> \{/);
  assert.match(outboundSrc, /if \(!shouldDispatch\('sms'\)\) \{/);
  const guardTestExists = fs.existsSync(path.join(FRONTEND_DIR, 'src/__tests__/outboundGuard.test.mjs'));
  assert.ok(guardTestExists, 'expected src/__tests__/outboundGuard.test.mjs to exist as the app-wide dispatch-guard regression test');
});
