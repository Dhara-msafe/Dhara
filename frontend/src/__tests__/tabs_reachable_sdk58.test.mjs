// 26 Nov 2026 (Vivek): from Expo SDK 58, expo-router redirects any visit to
// an `href: null` tab to the first tab (Home). Ask (index), Settings, Chat
// history, Saved, Advocates, Discover, lookup, voter roll and complaints are
// button-less tab screens, so they must be declared WITHOUT href:null, and
// the custom tab bar must keep drawing only its fixed buttons.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => readFileSync(path.join(root, p), 'utf8');
const layout = read('app/(tabs)/_layout.tsx');
const code = layout.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

test('no tab screen is declared with href: null', () => {
  assert.doesNotMatch(code, /href\s*:\s*null/);
});

test('every button-less tab screen is still declared', () => {
  for (const name of ['index', 'complaints', 'discover', 'lookup', 'voter-roll', 'saved', 'advocate', 'settings', 'history'])
    assert.match(code, new RegExp(`<Tabs\\.Screen name="${name}" options=\\{noTabButton\\} />`), name);
});

test('the bottom bar still draws only its fixed buttons', () => {
  const bar = read('src/components/AppTabBar.tsx');
  const slots = [...bar.matchAll(/\{ name: '([a-z]+)',/g)].map(m => m[1]);
  assert.deepEqual(slots, ['home', 'rights', 'myfiles', 'me']);
  assert.doesNotMatch(bar, /state\.routes\.map\(/, 'bar must not draw a button per route');
});

test('the installed expo-router still redirects href:null tabs (why this matters)', () => {
  let src;
  try { src = read('node_modules/expo-router/build/standard-navigation/useVisibleTabsWithRedirect.js'); } catch { return; }
  assert.match(src, /options\?\.hidden !== true/);
});

test('no screen imports navigation hooks from @react-navigation (SDK 58 has no navigation object there)', () => {
  const ask = read('app/(tabs)/index.tsx');
  assert.doesNotMatch(ask, /from '@react-navigation\//);
  assert.match(ask, /import \{[^}]*\buseIsFocused\b[^}]*\} from 'expo-router';/);
});
