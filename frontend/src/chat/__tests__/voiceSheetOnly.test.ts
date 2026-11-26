import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ask = readFileSync(new URL('../../../app/(tabs)/index.tsx', import.meta.url), 'utf8');

test('with the voice pop-up on, the old red recording bar is not drawn under it', () => {
  assert.match(ask, /\{locked && recording && !VOICE_SHEET \? \(/);
  assert.match(ask, /recording && !VOICE_SHEET \? styles\.recordingBar : styles\.inputBar/);
  assert.match(ask, /\{recording && !VOICE_SHEET \? \(/);
});

test('the pop-up opens while listening and while understanding', () => {
  assert.match(ask, /<VoiceSheet\s+visible=\{recording \|\| transcribing\}/);
});

test('Done finishes a hands-free recording and a tapped one', () => {
  assert.match(ask, /onDone=\{onVoiceSheetDone\}/);
  assert.match(ask, /if \(lockedRef\.current\) onLockedFinish\(\);\s+else onMicPressOut\(\);/);
});

test('Home mic and the Ask tab button both open Ask listening straight away', () => {
  const home = readFileSync(new URL('../../../app/(tabs)/home.tsx', import.meta.url), 'utf8');
  const tab = readFileSync(new URL('../../components/AppTabBar.tsx', import.meta.url), 'utf8');
  for (const s of [home, tab]) assert.match(s, /params: \{ autostartMic: Date\.now\(\)\.toString\(\) \}/);
});

test('the pop-up is always solid: it slides up, never fades its own opacity', () => {
  const sheet = readFileSync(new URL('../VoiceSheet.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(sheet, /opacity: rise/);
  assert.match(sheet, /translateY: rise\.interpolate/);
});
