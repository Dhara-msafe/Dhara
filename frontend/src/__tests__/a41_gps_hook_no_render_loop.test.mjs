// A41: useJourneyGPS must start GPS watching once, not on every render.
// Runs the real hook against a tiny stand-in for React and expo-location.
// Run: node --test src/__tests__/a41_gps_hook_no_render_loop.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(root, 'src/hooks/useJourneyGPS.ts'), 'utf8');
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

const sameDeps = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

/** Minimal hook runtime: enough of useState/useRef/useCallback/useEffect to
 *  count effect runs and state-driven re-renders. */
function makeHarness({ os }) {
  const slots = []; let i = 0; let pending = []; let dirty = false;
  const counts = { perm: 0, current: 0, watch: 0, removed: 0, effectRuns: 0 };
  const React = {
    useState(init) {
      const k = i++;
      if (!(k in slots)) slots[k] = { v: init };
      const slot = slots[k];
      const set = (u) => {
        const next = typeof u === 'function' ? u(slot.v) : u;
        if (!Object.is(next, slot.v)) { slot.v = next; dirty = true; }
      };
      return [slot.v, set];
    },
    useRef(init) { const k = i++; if (!(k in slots)) slots[k] = { current: init }; return slots[k]; },
    useCallback(fn, deps) {
      const k = i++;
      if (!(k in slots) || !sameDeps(slots[k].deps, deps)) slots[k] = { fn, deps };
      return slots[k].fn;
    },
    useEffect(fn, deps) {
      const k = i++; const prev = slots[k];
      if (!prev || !sameDeps(prev.deps, deps)) {
        pending.push(() => {
          prev?.cleanup?.();
          if (deps.length === 2) counts.effectRuns++;   // the start/stop effect
          slots[k] = { deps, cleanup: fn() };
        });
      }
    },
  };
  const Location = {
    Accuracy: { Balanced: 3 },
    async getForegroundPermissionsAsync() { counts.perm++; return { status: 'granted', canAskAgain: true }; },
    async requestForegroundPermissionsAsync() { return { status: 'granted', canAskAgain: true }; },
    async getCurrentPositionAsync() { counts.current++; return { coords: { latitude: 12.9, longitude: 77.6, accuracy: 10 }, timestamp: Date.now() }; },
    async watchPositionAsync() { counts.watch++; return { remove() { counts.removed++; } }; },
    async reverseGeocodeAsync() { return [{ city: 'Test City' }]; },
  };
  const mods = {
    'react': React,
    'react-native': { Platform: { OS: os } },
    'expo-location': Location,
    '@/src/auth': { useAuth: () => ({ token: 't', user: { id: 'u1' } }) },   // new user object each render, like a real context can give
    '@/src/apiBase': { API_BASE: 'http://test.invalid' },
    '@/src/safety/locationCache': { cacheLocation: async () => {} },
    '@/src/safety/locationUploadBody': { buildLocationUploadBody: (x) => x },
  };
  const module = { exports: {} };
  vm.runInNewContext(js, {
    module, exports: module.exports, Date, Number, JSON, Promise,
    require: (n) => { if (!(n in mods)) throw new Error('unmocked import ' + n); return mods[n]; },
    fetch: async () => ({ ok: true }),
  });
  const { useJourneyGPS } = module.exports;

  /** Render once, run effects, and keep re-rendering while state changes.
   *  Throws like React does if it never settles. */
  function render(token, enabled) {
    let state; let loops = 0;
    do {
      if (++loops > 50) throw new Error('Maximum update depth exceeded');
      dirty = false; i = 0; pending = [];
      state = useJourneyGPS(token, enabled, () => {});   // inline callback: new every render
      for (const run of pending) run();
    } while (dirty);
    return state;
  }
  const settle = () => new Promise((r) => setTimeout(r, 20));
  return { render, counts, settle };
}

test('web: enabling GPS settles instead of looping, and reports web as unavailable', () => {
  const h = makeHarness({ os: 'web' });
  const s = h.render('tok', true);
  assert.equal(s.error, 'GPS not available in web preview');
  assert.equal(s.tracking, false);
  assert.equal(h.counts.effectRuns, 1);
  for (let n = 0; n < 30; n++) h.render('tok', true);
  assert.equal(h.counts.effectRuns, 1, 'effect ran again on a plain re-render');
});

test('android: 30 re-renders start permission + watcher exactly once', async () => {
  const h = makeHarness({ os: 'android' });
  h.render('tok', true);
  await h.settle();
  for (let n = 0; n < 30; n++) { h.render('tok', true); await Promise.resolve(); }
  await h.settle();
  assert.equal(h.counts.effectRuns, 1);
  assert.equal(h.counts.perm, 1);
  assert.equal(h.counts.current, 1);
  assert.equal(h.counts.watch, 1);
  assert.equal(h.counts.removed, 0, 'watcher was stopped while the journey was still on');
});

test('android: watcher still stops when the journey ends, and restarts for a new journey', async () => {
  const h = makeHarness({ os: 'android' });
  h.render('tok', true); await h.settle();
  h.render('tok', false); await h.settle();
  assert.equal(h.counts.removed, 1);
  h.render('tok2', true); await h.settle();
  assert.equal(h.counts.watch, 2);
  assert.equal(h.counts.effectRuns, 3);
});

test('source: the start/stop effect depends only on enabled and journeyToken', () => {
  assert.match(src, /\}, \[enabled, journeyToken\]\);/);
  assert.doesNotMatch(src, /\[enabled, journeyToken, requestPermission, handlePosition\]/);
});
