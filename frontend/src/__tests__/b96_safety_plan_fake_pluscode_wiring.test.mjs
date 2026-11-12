/**
 * B-96 — Safety Plan showed a fake emergency Plus Code when GPS was off.
 *
 * Reported: with GPS off, the Safety Plan screen showed "EMERGENCY PLUS
 * CODE DEMO 7M5237MC+37" under "Share this code with emergency services".
 * That code is src/safety/locationCache.ts's hardcoded Chennai-city-centre
 * fallback (cachedLoc.source === 'demo'), returned whenever there is no
 * real GPS/server fix cached -- not the user's actual location. The old UI
 * only flagged this with a small cosmetic "Demo" badge while still
 * offering it as a shareable, copyable emergency code.
 *
 * The app already has the correct guard for this exact danger elsewhere:
 * app/women/head-out/index.tsx's prepareAlertSMS explicitly checks
 * `cached.source !== 'demo'` before including a Plus Code in an emergency
 * SMS, with the comment "a fabricated coordinate in an emergency SMS could
 * misdirect first responders". The Safety Plan screen never got the same
 * guard -- this fix brings it in line.
 *
 * Source-level wiring check (same convention as chatVoiceWiring.test.mjs):
 * safety-plan.tsx imports react-native and can't run directly in plain
 * Node, so this asserts on the real source text.
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

const planSrc = readFileSync(join(__dirname, '../../app/women/safety-plan.tsx'), 'utf8');
const headOutSrc = readFileSync(join(__dirname, '../../app/women/head-out/index.tsx'), 'utf8');
const cacheSrc = readFileSync(join(__dirname, '../safety/locationCache.ts'), 'utf8');

console.log('\n── B-96 — no fabricated Plus Code shown when GPS is off ────────');

test('locationCache.ts documents the demo fallback as a non-real fixture (sanity check on the premise)', () => {
  assert.ok(cacheSrc.includes("source:    'demo'"));
  assert.ok(/Demo fallback.*Chennai city centre/s.test(cacheSrc) || cacheSrc.includes('Chennai city centre'));
});

test('the Plus Code card is no longer rendered at all when cachedLoc.source is \'demo\'', () => {
  const idx = planSrc.indexOf('{/* ── F0-B: Plus Code emergency card ──');
  const cardGuard = planSrc.slice(idx, idx + 1200);
  assert.ok(cardGuard.includes("cachedLoc && cachedLoc.source !== 'demo' && ("));
});

test('a plain "location not available" notice is shown instead, with no code and no "share this" copy', () => {
  assert.ok(planSrc.includes("cachedLoc && cachedLoc.source === 'demo' && ("));
  assert.ok(planSrc.includes('Location not available'));
  assert.ok(planSrc.includes('Turn on GPS to get your emergency Plus Code'));
  // The fallback notice block must not itself render a plusCode value or
  // the copy-to-clipboard affordance -- confirm by scoping to that block.
  const idx = planSrc.indexOf("cachedLoc && cachedLoc.source === 'demo' && (");
  const end = planSrc.indexOf(')}', idx);
  const block = planSrc.slice(idx, end);
  assert.ok(!block.includes('cachedLoc.plusCode'));
  assert.ok(!block.includes('handleCopyPlusCode'));
  assert.ok(!block.includes('Share this code with emergency services'));
});

test('the stale cosmetic "Demo" badge is gone (superseded by not rendering the code at all)', () => {
  assert.ok(!planSrc.includes("cachedLoc.source === 'demo' &&") || !planSrc.includes('styles.demoBadge'));
  assert.ok(!planSrc.includes('demoBadge:'));
});

console.log('\n── Consistency with the already-fixed emergency-SMS path ───────');

test('head-out/index.tsx\'s prepareAlertSMS still omits the Plus Code for a demo-sourced location (the guard this fix mirrors)', () => {
  const idx = headOutSrc.indexOf('const prepareAlertSMS');
  const body = headOutSrc.slice(idx, idx + 1200);
  assert.ok(body.includes("cached.source !== 'demo'"));
});

console.log(`\n${'═'.repeat(60)}`);
console.log(`  ${passed} passed   ${failed} failed   ${passed + failed} total`);
console.log('═'.repeat(60));
if (failed > 0) process.exit(1);
