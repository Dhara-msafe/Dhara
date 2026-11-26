import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sheet = readFileSync(new URL('../../chat/VoiceSheet.tsx', import.meta.url), 'utf8');
const ask = readFileSync(new URL('../../../app/(tabs)/index.tsx', import.meta.url), 'utf8');

test('voice pop-up: three ways out while listening, and none by a stray tap', () => {
  assert.match(sheet, /testID="voice-sheet-back"/);
  assert.match(sheet, /testID="voice-sheet-cancel"/);
  assert.match(sheet, /onRequestClose=\{\(\) => \{ if \(listening\) onCancel\(\); \}\}/);
  // The dimmed area is a plain View: no press handler that could discard speech.
  assert.match(sheet, /<View style=\{s\.scrim\} testID="voice-sheet-scrim">/);
});

test('voice pop-up: rings move by scale only, and respect reduce-motion', () => {
  assert.match(sheet, /transform: \[\{ scale: rings\[0\] \}\]/);
  assert.match(sheet, /isReduceMotionEnabled/);
  assert.ok(!/Animated\.timing\([^)]*\b(width|height)\b/.test(sheet), 'never animate layout sizes');
});

test('Ask screen: pop-up is on by default with an off switch, old mic kept', () => {
  assert.match(ask, /const VOICE_SHEET = process\.env\.EXPO_PUBLIC_VOICE_SHEET !== 'false';/);
  // VOICE-DONE-01 (26 Nov): Done finishes a hands-free (locked) recording too.
  assert.match(ask, /onDone=\{onVoiceSheetDone\}/);
  assert.match(ask, /if \(lockedRef\.current\) onLockedFinish\(\);\s*else onMicPressOut\(\);/);
  assert.match(ask, /onCancel=\{onLockedCancel\}/);
  assert.match(ask, /\(Platform\.OS === 'web' \|\| VOICE_SHEET\) \? \(/);
  assert.match(ask, /micPanResponder/, 'press-and-hold code stays for the off switch');
});
