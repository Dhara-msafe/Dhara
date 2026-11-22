/**
 * Voice fix (owner, 22 Nov; first made on the Emergent VM, brought to GitHub
 * here). With EXPO_PUBLIC_VOICE_COMPANION_ENABLED=true nothing in the app
 * ever marked the speaking preference as known, so canSpeakNow() returned
 * false ('preference_unknown') for EVERY answer and the APK showed "Voice is
 * off" on each Listen tap. noteSpeakIntent() — called only on an explicit
 * user tap — now records the preference (the tap IS the consent to hear
 * voice), in memory and in AsyncStorage.
 *
 * Loads the REAL src/voice/speechGate.ts with react-native and AsyncStorage
 * stubbed by a test-local loader hook.
 * Run: node --experimental-strip-types --import ./src/voice/core/__tests__/ts-resolve.mjs \
 *        --test src/voice/__tests__/speechGatePrefKnown.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// Stub the two native modules speechGate.ts imports.
(globalThis as any).__asyncStorageWrites = [] as Array<[string, string]>;
register('data:text/javascript,' + encodeURIComponent(`
const STUBS = {
  'react-native': 'export const Platform = { OS: "android" }; export const AppState = { addEventListener() { return { remove() {} }; } };',
  '@react-native-async-storage/async-storage': 'export default { async getItem() { return null; }, async setItem(k, v) { globalThis.__asyncStorageWrites.push([k, v]); } };',
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
const gate = await import('../speechGate');

test('flag on: before any tap the gate blocks (preference unknown) — the APK bug', () => {
  assert.equal(gate.VOICE_COMPANION_ENABLED, true);
  assert.equal(gate.canSpeakNow(), false);
});

test("after noteSpeakIntent() the gate is no longer blocked by 'preference_unknown'", () => {
  gate.noteSpeakIntent();
  assert.equal(gate.canSpeakNow(), true);
});

test('the preference is persisted, so it survives an app restart', () => {
  const writes: Array<[string, string]> = (globalThis as any).__asyncStorageWrites;
  assert.ok(writes.some(([k, v]) => k === 'dhara_voice_pref_known' && v === 'true'), JSON.stringify(writes));
});

test("Women's Shield quiet still blocks, and a later tap does not override it", async () => {
  await gate.enterWomensShield();
  assert.equal(gate.canSpeakNow(), false);
  gate.noteSpeakIntent();
  assert.equal(gate.canSpeakNow(), false, 'a tap must not lift Women\'s Shield quiet');
  gate.leaveWomensShield();
  // Quiet stays on after leaving (persisted, by design) — still blocked.
  assert.equal(gate.isQuiet(), true);
  assert.equal(gate.canSpeakNow(), false);
});
