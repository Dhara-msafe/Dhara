/**
 * Ask DHARA auto-read + mute button — source-level wiring checks (same
 * convention as chatVoiceWiring.test.mjs: the screen imports react-native
 * and cannot run in plain Node, so this asserts on the real source).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const chatSrc = readFileSync(join(root, 'app', '(tabs)', 'index.tsx'), 'utf8');
const gateSrc = readFileSync(join(root, 'src', 'voice', 'speechGate.ts'), 'utf8');

test('sending a question while not muted opens the gate for that reply', () => {
  assert.ok(/if \(!q \|\| streaming \|\| !token\) return;[\s\S]{0,300}if \(autoSpeakRef\.current\) noteAutoReadQuestion\(\);/.test(chatSrc));
});

test('auto-read reads the LIVE mute state, so muting mid-reply is honoured', () => {
  assert.ok(chatSrc.includes('if (autoSpeakRef.current && displayText.trim().length && !hadError)'));
  assert.ok(!chatSrc.includes('if (autoSpeak && displayText.trim().length'));
});

test('the Ask header has a mute button wired to toggleMute', () => {
  assert.ok(/testID="ask-mute-btn"[\s\S]{0,200}onPress=\{toggleMute\}/.test(chatSrc));
});

test('muting stops current speech and saves the choice; unmuting saves it too', () => {
  const m = chatSrc.match(/const toggleMute = useCallback\(\(\) => \{([\s\S]*?)\}, \[setAutoSpeak, stopCloudTTS\]\);/);
  assert.ok(m, 'toggleMute not found');
  const body = m[1];
  assert.ok(body.includes('stopCloudTTS();') && body.includes('stopNativeTTS();'));
  assert.ok(body.includes('setAutoSpeak(false)') && body.includes('setAutoSpeak(true)'));
});

test('noteAutoReadQuestion never touches Quiet, Women\'s Shield or Quick exit', () => {
  const m = gateSrc.match(/export function noteAutoReadQuestion\(\): void \{([\s\S]*?)\n\}/);
  assert.ok(m, 'noteAutoReadQuestion not found');
  const body = m[1];
  assert.ok(body.includes("type: 'resume_requested'"));
  assert.ok(!/quiet|inWomensShield|quietAfterQuickExit/.test(body));
});
