/**
 * Voice fix (owner GO, 22 Nov): Women's Shield quiet is transient, stale
 * Shield-written Quiet is migrated away, Quick exit silences until the next
 * tap, and the Settings switch "Voice: read answers aloud" drives the gate.
 * Keeps: no surprise voice on first run, no voice inside Women's Shield,
 * explicit tap = consent (#114).
 *
 * Loads the REAL src/voice/speechGate.ts (fresh copy per scenario via a query
 * string) with react-native and an in-memory AsyncStorage stubbed.
 * Run: node --experimental-strip-types --import ./src/voice/core/__tests__/ts-resolve.mjs \
 *        --test src/voice/__tests__/speechGateShieldTransient.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

(globalThis as any).__store = new Map<string, string>();
register('data:text/javascript,' + encodeURIComponent(`
const STUBS = {
  'react-native': 'export const Platform = { OS: "android" }; export const AppState = { addEventListener() { return { remove() {} }; } };',
  '@react-native-async-storage/async-storage': 'const m = globalThis.__store; export default { async getItem(k) { return m.has(k) ? m.get(k) : null; }, async setItem(k, v) { m.set(k, String(v)); }, async removeItem(k) { m.delete(k); } };',
};
export async function resolve(specifier, context, next) {
  if (specifier in STUBS) return { url: 'stub:' + specifier, shortCircuit: true };
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url.startsWith('stub:')) return { format: 'module', source: STUBS[url.slice(5)], shortCircuit: true };
  return next(url, context);
}`));

process.env.EXPO_PUBLIC_VOICE_COMPANION_ENABLED = 'true';
const store: Map<string, string> = (globalThis as any).__store;
const here = dirname(fileURLToPath(import.meta.url));
let n = 0;
/** A fresh gate module (module state reset), as on an app restart. */
async function freshGate() {
  n += 1;
  const g = await import(`../speechGate.ts?run=${n}`);
  await g.initSpeechGate();
  return g;
}

test('migration: a stale Quiet written by the old Women\'s Shield code is cleared on start', async () => {
  store.clear();
  store.set('dhara_voice_quiet', 'true');          // old Shield wrote this; no source marker
  store.set('dhara_voice_pref_known', 'true');
  const g = await freshGate();
  await new Promise(r => setTimeout(r, 0));        // let the removeItem settle
  assert.equal(g.isQuiet(), false);
  assert.equal(store.has('dhara_voice_quiet'), false);
  assert.equal(g.canSpeakNow(), true);
});

test('migration keeps a Quiet the USER chose in Settings', async () => {
  store.clear();
  store.set('dhara_voice_quiet', 'true');
  store.set('dhara_voice_quiet_source', 'user');
  store.set('dhara_voice_pref_known', 'true');
  const g = await freshGate();
  assert.equal(g.isQuiet(), true);
  assert.equal(g.canSpeakNow(), false);
});

test('Women\'s Shield: blocks while there, nothing saved, previous state restored on leave', async () => {
  store.clear();
  store.set('dhara_voice_pref_known', 'true');
  const g = await freshGate();
  assert.equal(g.canSpeakNow(), true);
  await g.enterWomensShield();
  assert.equal(g.canSpeakNow(), false);
  assert.equal(store.get('dhara_voice_quiet'), undefined, 'the Shield must never persist Quiet');
  g.leaveWomensShield();
  assert.equal(g.canSpeakNow(), true);
  // and an app restart after a visit still has voice on
  const g2 = await freshGate();
  assert.equal(g2.canSpeakNow(), true);
});

test('Women\'s Shield scope is reference-counted (hub -> /women/* in either order never opens the gate)', async () => {
  store.clear();
  store.set('dhara_voice_pref_known', 'true');
  const g = await freshGate();
  await g.enterWomensShield();   // hub focus
  await g.enterWomensShield();   // sub-screen focus arrives before hub blur
  g.leaveWomensShield();         // hub blur
  assert.equal(g.canSpeakNow(), false, 'still on a Shield screen');
  g.leaveWomensShield();
  assert.equal(g.canSpeakNow(), true);
  g.leaveWomensShield();         // extra leave never goes negative
  await g.enterWomensShield();
  assert.equal(g.canSpeakNow(), false);
});

test('route helper covers the hub and every /women/* screen, nothing else', async () => {
  const g = await freshGate();
  for (const p of ['/women-shield', '/women/silent-alert', '/women/head-out', '/women/head-out/destination'])
    assert.equal(g.isWomensShieldRoute(p), true, p);
  for (const p of ['/', '/women', '/womens-help', '/settings', null, undefined])
    assert.equal(g.isWomensShieldRoute(p as any), false, String(p));
});

test('Quick exit: nothing speaks until the next explicit tap; nothing saved', async () => {
  store.clear();
  store.set('dhara_voice_pref_known', 'true');
  const g = await freshGate();
  g.noteQuickExit();
  assert.equal(g.canSpeakNow(), false);
  assert.equal(store.get('dhara_voice_quiet'), undefined);
  g.noteSpeakIntent();           // explicit tap
  assert.equal(g.canSpeakNow(), true);
});

test('Settings switch drives the same gate and persists as the user\'s choice', async () => {
  store.clear();
  const g = await freshGate();
  assert.equal(g.isVoiceReadAloudOn(), false, 'first run: not on until the user chooses');
  await g.setVoiceReadAloud(false);
  assert.equal(g.canSpeakNow(), false);
  assert.equal(store.get('dhara_voice_quiet'), 'true');
  assert.equal(store.get('dhara_voice_quiet_source'), 'user');
  await g.setVoiceReadAloud(true);
  assert.equal(g.isVoiceReadAloudOn(), true);
  assert.equal(g.canSpeakNow(), true);
  assert.equal(store.get('dhara_voice_pref_known'), 'true', 'switching on is a speaking choice');
});

test('kept: no surprise voice on first run; explicit tap = consent (#114)', async () => {
  store.clear();
  const g = await freshGate();
  assert.equal(g.canSpeakNow(), false);
  g.noteSpeakIntent();
  assert.equal(g.canSpeakNow(), true);
});

test('wiring: root layout scopes by route; Shield hub no longer writes Quiet; both Quick exits note it; dialog names Settings', () => {
  const root = join(here, '..', '..', '..');
  const read = (p: string) => readFileSync(join(root, p), 'utf8');
  const layout = read('app/_layout.tsx');
  assert.match(layout, /const inWomensShieldRoute = isWomensShieldRoute\(pathname\);/);
  assert.match(layout, /void enterWomensShield\(\);\s*\n\s*return \(\) => leaveWomensShield\(\);/);
  const hub = read('app/women-shield.tsx');
  assert.doesNotMatch(hub, /enterWomensShield\(/);
  assert.match(hub, /noteQuickExit\(\);/);
  assert.match(read('src/components/dhara/SosPill.tsx'), /noteQuickExit\(\); router\.replace\('\/\(tabs\)\/home'\)/);
  const gateSrc = read('src/voice/speechGate.ts');
  assert.match(gateSrc, /turn on "Voice: read answers aloud" in Settings/);
  assert.doesNotMatch(read('app/(tabs)/index.tsx'), /Turn voice back on/);
  assert.doesNotMatch(read('app/fir-draft/index.tsx'), /turn voice back on/);
  const settings = read('app/(tabs)/settings.tsx');
  assert.match(settings, /testID="voice-read-aloud-switch"/);
  assert.match(settings, /onValueChange=\{\(v\) => \{ setVoiceOn\(v\); void setVoiceReadAloud\(v\); \}\}/);
});
