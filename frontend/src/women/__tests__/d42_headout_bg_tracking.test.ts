/**
 * D-42 live tracking (flag EXPO_PUBLIC_HEADOUT_BG_TRACKING, default OFF).
 * Pure-logic tests against the real module (expo/react-native stubbed) plus
 * source-wiring checks for the hard conditions:
 *   disclosure BEFORE any OS ask · per-journey opt-in · auto-stop on
 *   safe/stop-sharing/timeout · visible notification · Family Journey
 *   untouched · A12 storage unchanged (uploads reuse the existing endpoint).
 *
 * Run: node --experimental-strip-types --import ./src/voice/core/__tests__/ts-resolve.mjs \
 *        --test src/women/__tests__/d42_headout_bg_tracking.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

register('data:text/javascript,' + encodeURIComponent(`
const STUBS = {
  'react-native': 'export const Platform = { OS: "android" };',
  '@react-native-async-storage/async-storage': 'const m = new Map(); export default { async getItem(k) { return m.has(k) ? m.get(k) : null; }, async setItem(k, v) { m.set(k, String(v)); }, async removeItem(k) { m.delete(k); } };',
  'expo-location': 'export const Accuracy = { High: 4 }; export async function hasStartedLocationUpdatesAsync() { return false; } export async function stopLocationUpdatesAsync() {} export async function startLocationUpdatesAsync() {} export async function requestForegroundPermissionsAsync() { return { status: "denied" }; } export async function requestBackgroundPermissionsAsync() { return { status: "denied" }; }',
  'expo-task-manager': 'export function defineTask(name, fn) { globalThis.__definedTasks = (globalThis.__definedTasks || []).concat(name); }',
};
export async function resolve(specifier, context, next) {
  if (specifier in STUBS) return { url: 'stub:' + specifier, shortCircuit: true };
  if (specifier === '@/src/utils/storage') return { url: 'stub-storage:', shortCircuit: true };
  if (specifier === '@/src/auth') return { url: 'stub-auth:', shortCircuit: true };
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url.startsWith('stub:')) return { format: 'module', source: STUBS[url.slice(5)], shortCircuit: true };
  if (url === 'stub-storage:') return { format: 'module', source: 'export const storage = { async secureGet() { return null; } };', shortCircuit: true };
  if (url === 'stub-auth:') return { format: 'module', source: 'export const API_BASE = "https://example.test";', shortCircuit: true };
  return next(url, context);
}`));

process.env.EXPO_PUBLIC_HEADOUT_BG_TRACKING = 'true';
const mod = await import('../headOutBgTracking');

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

test('the background task is registered at module load (app-start import path exists)', () => {
  assert.ok(((globalThis as any).__definedTasks ?? []).includes(mod.BG_TASK));
  assert.match(read('app/_layout.tsx'), /import "@\/src\/women\/headOutBgTracking";/);
});

test('no disclosure, no tracking — and no OS permission ask', async () => {
  const r = await mod.startJourneyBgTracking({ journeyToken: 't', expectedCheckinAt: null, disclosureAgreed: false });
  assert.equal(r, 'no_disclosure');
});

test('a denied OS permission is reported, never swallowed', async () => {
  const r = await mod.startJourneyBgTracking({ journeyToken: 't', expectedCheckinAt: null, disclosureAgreed: true });
  assert.equal(r, 'fg_denied'); // the stub denies the first (foreground) ask
});

test('timeout: the task self-stops past the journey deadline + grace', () => {
  const stopAt = mod.computeAutoStopAt('2026-11-26T10:00:00.000Z', '2026-11-26T09:00:00.000Z');
  assert.equal(stopAt, new Date(Date.parse('2026-11-26T10:00:00.000Z') + mod.AUTO_STOP_GRACE_MS).toISOString());
  assert.equal(mod.shouldAutoStop({ autoStopAt: stopAt }, '2026-11-26T10:44:59.000Z'), false);
  assert.equal(mod.shouldAutoStop({ autoStopAt: stopAt }, '2026-11-26T10:45:00.000Z'), true);
  assert.equal(mod.shouldAutoStop(null, '2026-11-26T10:00:00.000Z'), true, 'no journey context = stop');
  assert.equal(mod.shouldAutoStop({ autoStopAt: 'garbage' }, '2026-11-26T10:00:00.000Z'), true);
});

test('uploads reuse the existing endpoint shape (A07 source=gps, true capture age); nothing new is stored', () => {
  const body = mod.buildLocationBody(
    { coords: { latitude: 17.4, longitude: 78.5, accuracy: 12 }, timestamp: Date.parse('2026-11-26T10:00:00Z') },
    Date.parse('2026-11-26T10:00:40Z'),
  );
  assert.deepEqual(body, { lat: 17.4, lng: 78.5, accuracy: 12, area: '', source: 'gps', age_seconds: 40 });
  const src = read('src/women/headOutBgTracking.ts');
  assert.match(src, /\/api\/journey\/status\/\$\{ctx\.journeyToken\}\/location/);
  assert.equal((src.match(/API_BASE\}\/api\//g) || []).length, 1, 'exactly one endpoint — no new storage path');
});

test('hard conditions wired on the active screen; Family Journey untouched', () => {
  const idx = read('app/women/head-out/index.tsx');
  // Disclosure BEFORE OS ask: the Allow button opens the disclosure when offered…
  assert.match(idx, /if \(bgTrackingOffered\) setShowBgDisclosure\(true\);\s*\n\s*else setLocationConsentGiven\(true\);/);
  // …and only Agree reaches the permission asks, with the per-journey flag.
  assert.match(idx, /disclosureAgreed: true,/);
  // Auto-stop on safe, stop-sharing, and reconcile on open/expiry.
  assert.match(idx, /setSafeConfirmed\(true\);.*\n\s*void stopJourneyBgTracking\(\);/);
  assert.match(idx, /setSharingRevoked\(true\);\s*\n\s*void stopJourneyBgTracking\(\);/);
  assert.match(idx, /reconcileBgTracking\(expired \? null : \(journeyToken \?\? null\)\)/);
  // The disclosure names the Play-required clause, and the service notification is visible and honest.
  assert.match(read('src/women/BgTrackingDisclosure.tsx'), /collects location data/);
  assert.match(read('src/women/BgTrackingDisclosure.tsx'), /even when the\s*\n?\s*app is closed or not in use/);
  const svc = read('src/women/headOutBgTracking.ts');
  assert.match(svc, /notificationTitle: 'DHARA — journey sharing is on'/);
  // Family Journey: no file under app/family* or src/family* references this module.
  for (const fam of ['app/family-journey.tsx', 'app/family-journey/index.tsx']) {
    try { assert.doesNotMatch(readFileSync(join(root, fam), 'utf8'), /headOutBgTracking|BgTrackingDisclosure/); }
    catch (e: any) { if (e.code !== 'ENOENT') throw e; }
  }
});

test('flag defaults OFF and the native config is in place for a rebuild', () => {
  const env = read('.env.example');
  assert.match(env, /^EXPO_PUBLIC_HEADOUT_BG_TRACKING=$/m);
  const app = JSON.parse(read('app.json'));
  const perms: string[] = app.expo.android.permissions;
  for (const p of ['android.permission.ACCESS_BACKGROUND_LOCATION', 'android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_LOCATION']) {
    assert.ok(perms.includes(p), p);
  }
  const loc = app.expo.plugins.find((x: any) => Array.isArray(x) && x[0] === 'expo-location')[1];
  assert.equal(loc.isAndroidBackgroundLocationEnabled, true);
  assert.equal(loc.isIosBackgroundLocationEnabled, false, 'iOS stays off — separate ticket');
});
