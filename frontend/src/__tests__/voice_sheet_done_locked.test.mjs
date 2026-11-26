// 26 Nov 2026 (Vivek, live app): starting voice from Home's mic or the Ask
// tab opened the voice pop-up recording hands-free, but Done did nothing
// (only Cancel / Back worked). Done called onMicPressOut, which ignores a
// locked recording by design. It now finishes a locked recording.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(path.join(root, 'app/(tabs)/index.tsx'), 'utf8');

test('voice pop-up Done uses the handler that knows about hands-free mode', () => {
  assert.match(src, /onDone=\{onVoiceSheetDone\}/);
  assert.doesNotMatch(src, /onDone=\{onMicPressOut\}/);
});

test('Done finishes a locked recording, otherwise ends a held one', () => {
  const fn = src.slice(src.indexOf('const onVoiceSheetDone = useCallback'), src.indexOf('// Consume each explicit voice-entry request once.'));
  assert.match(fn, /if \(lockedRef\.current\) onLockedFinish\(\);\s*else onMicPressOut\(\);/);
});

test('auto-started voice is hands-free (why Done needed this)', () => {
  assert.match(src, /onMicPressIn\(\);\s*lockedRef\.current = true; setLocked\(true\);/);
  assert.match(src, /if \(lockedRef\.current\) \{\s*slideX\.setValue\(0\);\s*slideY\.setValue\(0\);\s*return;/);
});

test('onLockedFinish is defined before the Done handler uses it', () => {
  assert.ok(src.indexOf('const onLockedFinish = useCallback') < src.indexOf('const onVoiceSheetDone = useCallback'));
});
