// Shared stand-in for React + expo-location that runs the REAL useJourneyGPS
// hook in plain Node (used by the A41 and A10 tests).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const transpile = (rel) => ts.transpileModule(readFileSync(join(root, rel), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
export const hookSource = readFileSync(join(root, 'src/hooks/useJourneyGPS.ts'), 'utf8');
const js = transpile('src/hooks/useJourneyGPS.ts');
const retryJs = transpile('src/safety/locationUploadRetry.ts');
const bodyJs = transpile('src/safety/locationUploadBody.ts');
function loadPure(code, Date) {
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, Date, Number, JSON, Set, Math, Infinity });
  return module.exports;
}

const sameDeps = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

/** Minimal hook runtime: enough of useState/useRef/useCallback/useEffect to
 *  count effect runs and state-driven re-renders. */
export function makeHarness({ os, fetchImpl }) {
  // Controllable clock, shared by the hook and the pure modules.
  const clock = { t: 1_800_000_000_000 };
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(clock.t); else super(...a); }
    static now() { return clock.t; }
  }
  let onPosition = null;
  const current = { impl: fetchImpl };
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
    async getCurrentPositionAsync() { counts.current++; return { coords: { latitude: 12.9, longitude: 77.6, accuracy: 10 }, timestamp: clock.t }; },
    async watchPositionAsync(_opts, cb) { onPosition = cb; counts.watch++; return { remove() { counts.removed++; } }; },
    async reverseGeocodeAsync() { return [{ city: 'Test City' }]; },
  };
  // Fake of the persisted queue store (same surface the hook uses).
  const store = { queue: [] };
  let seq = 0;
  const queueStore = {
    getState: () => ({ queue: store.queue, enqueue: (e) => { store.queue = [...store.queue, { ...e, id: 'q' + (++seq) }]; }, clearAll: () => { store.queue = []; } }),
    setState: (p) => { Object.assign(store, typeof p === 'function' ? p(store) : p); },
  };
  const timers = [];
  const sent = [];
  const mods = {
    '@/src/safety/locationUploadQueue': { useLocationUploadQueue: queueStore },
    '@/src/safety/locationUploadRetry': loadPure(retryJs, FakeDate),
    'react': React,
    'react-native': { Platform: { OS: os } },
    'expo-location': Location,
    '@/src/auth': { useAuth: () => ({ token: 't', user: { id: 'u1' } }) },   // new user object each render, like a real context can give
    '@/src/apiBase': { API_BASE: 'http://test.invalid' },
    '@/src/safety/locationCache': { cacheLocation: async () => {} },
    '@/src/safety/locationUploadBody': loadPure(bodyJs, FakeDate),
  };
  const module = { exports: {} };
  vm.runInNewContext(js, {
    module, exports: module.exports, Date: FakeDate, Number, JSON, Promise,
    require: (n) => { if (!(n in mods)) throw new Error('unmocked import ' + n); return mods[n]; },
    setInterval: (fn, ms) => { const t = { fn, ms, on: true }; timers.push(t); return t; },
    clearInterval: (t) => { if (t) t.on = false; },
    fetch: async (url, init) => {
      const call = { url, body: JSON.parse(init.body) };
      sent.push(call);
      return (current.impl ?? (async () => ({ status: 200, json: async () => ({ ok: true }) })))(call);
    },
  });
  const { useJourneyGPS } = module.exports;

  /** Render once, run effects, and keep re-rendering while state changes.
   *  Throws like React does if it never settles. */
  function render(token, enabled, keepRetryingHeld = false, onJourneyClosed) {
    let state; let loops = 0;
    do {
      if (++loops > 50) throw new Error('Maximum update depth exceeded');
      dirty = false; i = 0; pending = [];
      // inline callback and options object: new on every render, like the real screen
      state = useJourneyGPS(token, enabled, () => {}, { keepRetryingHeld, onJourneyClosed });
      for (const run of pending) run();
    } while (dirty);
    return state;
  }
  const settle = () => new Promise((r) => setTimeout(r, 20));
  /** Fire every live interval timer once (the 30 s retry). */
  const tick = async () => { for (const t of timers) if (t.on) t.fn(); await settle(); };
  /** A new GPS reading from the watcher, taken `agoMs` before the clock's now. */
  const emit = async (lat, lng, agoMs = 0) => {
    onPosition({ coords: { latitude: lat, longitude: lng, accuracy: 12 }, timestamp: clock.t - agoMs });
    await settle();
  };
  const setNet = (impl) => { current.impl = impl; };
  return { clock, emit, setNet, render, counts, settle, tick, sent, store, Location, liveTimers: () => timers.filter((t) => t.on).length };
}

