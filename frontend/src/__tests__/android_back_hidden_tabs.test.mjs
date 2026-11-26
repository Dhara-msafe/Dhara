// 26 Nov 2026 (Vivek): on Android, the phone's own Back on the hidden-tab
// screens (Settings, Chat history, Saved, Lawyer Mode) went to Home. It now
// goes where the on-screen arrow goes. Runs the real hook with a fake
// BackHandler and focus effect.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => readFileSync(path.join(root, p), 'utf8');

function loadHook(os) {
  const listeners = [];
  let cleanup = null;
  const deps = {
    useRef: v => ({ current: v }),
    useCallback: f => f,
    Platform: { OS: os },
    BackHandler: { addEventListener: (ev, fn) => { listeners.push({ ev, fn }); return { remove: () => listeners.splice(listeners.findIndex(l => l.fn === fn), 1) }; } },
    useFocusEffect: f => { cleanup = f(); },
  };
  const src = read('src/useAndroidBack.ts')
    .replace(/^import[^\n]*\n/gm, '').replace(/export function/, 'function')
    .replace('(onBack: () => void)', '(onBack)').replace('return undefined;', 'return undefined;');
  const hook = new Function(...Object.keys(deps), `${src}; return useAndroidBack;`)(...Object.values(deps));
  return { hook, listeners, blur: () => cleanup && cleanup() };
}

test('Android: Back runs the screen\'s own target and stops the tab default', () => {
  const { hook, listeners, blur } = loadHook('android');
  const went = []; hook(() => went.push('me'));
  assert.equal(listeners.length, 1); assert.equal(listeners[0].ev, 'hardwareBackPress');
  assert.equal(listeners[0].fn(), true, 'handled, so the tab does not go to Home');
  assert.deepEqual(went, ['me']);
  blur(); assert.equal(listeners.length, 0, 'removed when the screen loses focus');
});

test('iPhone and web: nothing is registered', () => {
  for (const os of ['ios', 'web']) { const { hook, listeners } = loadHook(os); hook(() => {}); assert.equal(listeners.length, 0); }
});

test('the four hidden-tab screens send Android Back where their arrow goes', () => {
  for (const f of ['history', 'saved', 'settings']) {
    const src = read(`app/(tabs)/${f}.tsx`);
    assert.match(src, /useAndroidBack\(\(\) => router\.navigate\(tabBackTarget\(from\) as any\)\);/, f);
    assert.match(src, /onBack=\{\(\) => router\.navigate\(tabBackTarget\(from\) as any\)\}/, `${f}: arrow uses the same target`);
  }
  const adv = read('app/(tabs)/advocate.tsx');
  assert.match(adv, /useAndroidBack\(\(\) => router\.navigate\('\/\(tabs\)\/me' as any\)\);/);
  assert.ok(adv.indexOf('useAndroidBack(') < adv.indexOf('if (!ADVOCATE_MODE_ENABLED)'), 'hook runs before the early return');
});
