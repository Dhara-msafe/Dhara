/**
 * B-107 / B-80 — a mid-draft FIR session resume (triggered by a backend
 * reconnect/host restart, e.g. Preview's sleep-wake cycle) must not wipe
 * whatever the citizen had just typed or voice-transcribed into the
 * composer but not yet sent.
 *
 * Root cause: the composer's unsent text (`textInput`) only ever lived in
 * React component state. A host restart tears down the whole page, and the
 * screen remounts with `useState('')` -- there was nothing to restore from,
 * so the citizen's last (often just-spoken) answer silently vanished the
 * moment "Welcome back! ..." appeared, with no indication anything was lost.
 *
 * Fix verified here (source-level, no RN renderer in this plain-Node test
 * setup -- same convention as adminUpiReviewGate.test.mjs): the unsent text
 * is persisted to AsyncStorage on every change, scoped per session_id so an
 * abandoned draft from one session can never leak into a different,
 * later-resumed session, and resumeSession() restores it for the session
 * being resumed.
 *
 * Run with:
 *   node --experimental-strip-types --test src/__tests__/b107_b80_preserve_unsent_fir_input.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREEN = join(__dirname, '..', '..', 'app', 'fir-draft', 'index.tsx');
const src = readFileSync(SCREEN, 'utf8');

test('a dedicated, versioned storage key exists for the unsent-input draft', () => {
  assert.ok(src.includes("const FIR_DRAFT_INPUT_KEY = 'fir_draft_pending_input_v1';"));
});

test('the composer persists textInput on every change, scoped by session_id', () => {
  const effectMatch = src.match(
    /useEffect\(\(\) => \{\s*if \(!sessionId\) return;\s*AsyncStorage\.setItem\(`\$\{FIR_DRAFT_INPUT_KEY\}:\$\{sessionId\}`, textInput\)\.catch\(\(\) => \{\}\);\s*\}, \[textInput, sessionId\]\);/
  );
  assert.ok(effectMatch, 'persistence effect not found or not scoped by sessionId');
});

test('the persistence effect never throws past a write failure (no unhandled rejection reaching the caller)', () => {
  // The .catch(() => {}) right after setItem is the whole safety net here --
  // assert it is literally adjacent to the write, not bolted on elsewhere.
  assert.ok(/AsyncStorage\.setItem\(`\$\{FIR_DRAFT_INPUT_KEY\}:\$\{sessionId\}`, textInput\)\.catch\(\(\) => \{\}\)/.test(src));
});

test('resumeSession restores the pending draft for the session actually being resumed (uses `sid`, not some other id)', () => {
  assert.ok(
    src.includes('AsyncStorage.getItem(`${FIR_DRAFT_INPUT_KEY}:${sid}`)'),
    'restore call missing, or not scoped to the resumed session id (sid)'
  );
});

test('the restore sets textInput only when a draft was actually found (never clobbers with an empty/undefined value)', () => {
  const restoreBlock = src.match(
    /const pendingInput = await AsyncStorage\.getItem\(`\$\{FIR_DRAFT_INPUT_KEY\}:\$\{sid\}`\);\s*if \(pendingInput\) setTextInput\(pendingInput\);/
  );
  assert.ok(restoreBlock, 'restore does not guard on pendingInput being truthy before calling setTextInput');
});

test('the restore happens inside resumeSession, after the existing narrative-turn/probe restore logic (so it runs on every resume path)', () => {
  const resumeFnIdx = src.indexOf('const resumeSession = useCallback(async (sid: string) => {');
  const narrativeRestoreIdx = src.indexOf('Restore FULL conversation thread');
  const draftRestoreIdx = src.indexOf('AsyncStorage.getItem(`${FIR_DRAFT_INPUT_KEY}:${sid}`)');
  assert.ok(resumeFnIdx !== -1 && narrativeRestoreIdx !== -1 && draftRestoreIdx !== -1, 'one of the anchors was not found');
  assert.ok(resumeFnIdx < narrativeRestoreIdx, 'narrative restore is not inside resumeSession');
  assert.ok(narrativeRestoreIdx < draftRestoreIdx, 'draft restore must come after the existing resume logic, not before it');
});
