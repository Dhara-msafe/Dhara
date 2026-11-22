/**
 * B-99 — SOS button missing on the Ask/chat screen ("/").
 *
 * Reported: no header SOS and no sidebar "SOS - Emergency" on the Ask
 * screen, even though every other screen has them.
 *
 * Root cause: app/(tabs)/_layout.tsx's `onHome` (gates the persistent
 * SosPill overlay) and src/components/dhara/DesktopFrame.tsx's `isHome`
 * (gates the top-bar SOS button and sidebar "SOS · Emergency" link) both
 * matched pathname === '/(tabs)' and pathname === '/' as "Home" -- but
 * those two paths are the (tabs) route GROUP's own index route, which is
 * the Ask/chat screen (app/(tabs)/index.tsx), not Home. Home is a
 * separate screen, app/(tabs)/home.tsx, reachable only at '/home' /
 * '/(tabs)/home'. src/components/AppTabBar.tsx's raised gold mic button
 * confirms this: it navigates to router.push({ pathname: '/(tabs)', ... })
 * to open the Ask screen -- the exact path that was being treated as Home.
 *
 * This is a source-level wiring check (same convention as
 * chatVoiceWiring.test.mjs, nearestHelp.logic.test.mjs): both files import
 * react-native/expo-router and can't be executed directly in plain Node,
 * so this asserts on the real source text instead of re-implementing the
 * routing logic.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); console.log(`  ✅  ${label}`); passed++; }
  catch (e) { console.log(`  ❌  ${label}\n      ${e.message}`); failed++; }
}

const layoutSrc = readFileSync(join(__dirname, '../../app/(tabs)/_layout.tsx'), 'utf8');
const desktopFrameSrc = readFileSync(join(__dirname, '../components/dhara/DesktopFrame.tsx'), 'utf8');
const tabBarSrc = readFileSync(join(__dirname, '../components/AppTabBar.tsx'), 'utf8');

console.log('\n── B-99 — Ask screen is no longer misidentified as Home ────────');

test('AppTabBar\'s raised Ask mic button navigates to \'/(tabs)\' (confirms this IS the Ask screen\'s own path)', () => {
  assert.ok(/router\.push\(\{\s*pathname:\s*'\/\(tabs\)'/.test(tabBarSrc));
});

test('_layout.tsx\'s onHome no longer matches \'/(tabs)\' or bare \'/\' (the Ask screen\'s paths)', () => {
  const idx = layoutSrc.indexOf('const onHome =');
  const line = layoutSrc.slice(idx, layoutSrc.indexOf(';', idx) + 1);
  assert.ok(!line.includes("'/(tabs)'"), 'onHome must not treat \'/(tabs)\' as Home');
  assert.ok(!/pathname === '\/'(?!\w)/.test(line), 'onHome must not treat bare \'/\' as Home');
});

test('_layout.tsx\'s onHome still matches the real Home screen paths', () => {
  const idx = layoutSrc.indexOf('const onHome =');
  const line = layoutSrc.slice(idx, layoutSrc.indexOf(';', idx) + 1);
  assert.ok(line.includes("'/(tabs)/home'"));
  assert.ok(line.includes("'/home'"));
});

test('the persistent SosPill is still gated by onHome (i.e. still shown everywhere except real Home)', () => {
  // Updated 22 Nov (UI_V22_ONE_SOS): the overlay also steps aside on screens
  // that carry their own SOS — but only with the flag on, and Ask then shows
  // one in its header row, so Ask always has exactly one SOS.
  assert.ok(layoutSrc.includes('{!onHome && !screenHasOwnSos && (') && layoutSrc.includes('<SosPill />'));
  assert.ok(/const screenHasOwnSos = UI_V22_ONE_SOS && \(onAsk \|\| onMe \|\| onSettings\);/.test(layoutSrc));
  const askSrc = readFileSync(join(__dirname, '../../app/(tabs)/index.tsx'), 'utf8');
  assert.ok(askSrc.includes('{UI_V22_ONE_SOS && <SosPill compact />}'), 'Ask must show its own SOS when the overlay steps aside');
});

console.log('\n── Same fix mirrored in the desktop web shell ───────────────────');

test('DesktopFrame.tsx\'s isHome no longer matches \'/(tabs)\' or bare \'/\'', () => {
  const idx = desktopFrameSrc.indexOf('const isHome =');
  const line = desktopFrameSrc.slice(idx, desktopFrameSrc.indexOf(';', idx) + 1);
  assert.ok(!line.includes("'/(tabs)'"), 'isHome must not treat \'/(tabs)\' as Home');
  assert.ok(!/pathname === '\/'(?!\w)/.test(line), 'isHome must not treat bare \'/\' as Home');
});

test('DesktopFrame.tsx\'s isHome still matches the real Home screen paths', () => {
  const idx = desktopFrameSrc.indexOf('const isHome =');
  const line = desktopFrameSrc.slice(idx, desktopFrameSrc.indexOf(';', idx) + 1);
  assert.ok(line.includes("'/(tabs)/home'"));
  assert.ok(line.includes("'/home'"));
});

test('the top-bar SOS button is still gated by isHome (shown everywhere except real Home, now including Ask)', () => {
  const idx = desktopFrameSrc.indexOf('accessibilityLabel="Open emergency help" style={styles.sosTop}');
  const slice = desktopFrameSrc.slice(Math.max(0, idx - 160), idx);
  // Updated 22 Nov: later v2.2 phases add more conditions (calm routes,
  // UI_V22_ONE_SOS); the B-99 point is that the gate is isHome, never '/'.
  assert.ok(/\{!isHome && /.test(slice));
});

test('the sidebar "SOS · Emergency" link is still gated by isHome', () => {
  const idx = desktopFrameSrc.indexOf('accessibilityLabel="Open emergency help" style={styles.sos}');
  const slice = desktopFrameSrc.slice(Math.max(0, idx - 120), idx);
  assert.ok(/!isHome/.test(slice));
});

console.log(`\n${'═'.repeat(60)}`);
console.log(`  ${passed} passed   ${failed} failed   ${passed + failed} total`);
console.log('═'.repeat(60));
if (failed > 0) process.exit(1);
