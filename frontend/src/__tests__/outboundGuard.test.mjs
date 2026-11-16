// QA Outbound Guard — static bypass scan + fail-closed mode resolution.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Was hardcoded to '/app/frontend' — the original Emergent container's fixed
// checkout path. That made this test (the one static check that would catch
// a dialler/SMS/share call bypassing src/outbound.ts anywhere under app/ or
// src/) silently fail with ENOENT in any other checkout location, including
// this one. Resolved relative to this file instead, like every other test
// in this folder already does.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const GUARD = join(ROOT, 'src/outbound.ts');
const FORBIDDEN = [/\bLinking\.openURL\s*\(/, /\bsendSMSAsync\s*\(/, /\bShare\.share\s*\(/];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p);
  }
  return out;
}

test('no direct dialler / SMS / share calls outside src/outbound.ts', () => {
  const offenders = [];
  for (const f of [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'src'))]) {
    if (f === GUARD) continue;
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (FORBIDDEN.some(re => re.test(line))) offenders.push(`${f.replace(ROOT + '/', '')}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [], `Route these through src/outbound.ts:\n${offenders.join('\n')}`);
});

const src = readFileSync(GUARD, 'utf8');

test('live only on the exact string "live" (missing/misspelt => simulate)', () => {
  assert.ok(src.includes("process.env.EXPO_PUBLIC_OUTBOUND_MODE === 'live'"));
  const resolve = v => v === 'live';
  for (const v of [undefined, '', 'LIVE', 'Live', ' live', 'true', 'prod', 'simulate']) assert.equal(resolve(v), false, String(v));
  assert.equal(resolve('live'), true);
});

test('every dispatch entry point checks shouldDispatch() before calling the OS', () => {
  for (const fn of ['openExternal', 'composeSms', 'shareExternal']) {
    const body = src.slice(src.indexOf(`function ${fn}`));
    const guardAt = body.indexOf('shouldDispatch');
    const callAt = Math.min(...['Linking.openURL(', 'sendSMSAsync(', 'Share.share('].map(s => body.indexOf(s)).filter(i => i >= 0));
    assert.ok(guardAt >= 0 && guardAt < callAt, `${fn} must check shouldDispatch first`);
  }
  assert.ok(src.includes("Simulated — nothing sent"));
  // shouldDispatch can only go live when the master switch is live (profile restricts, never enables).
  assert.ok(/OUTBOUND_LIVE\s*&&\s*channelDecision\(channel\)\s*===\s*'live'/.test(src));
});

test('dispatch URL classification', () => {
  const grab = (name) => { const m = src.match(new RegExp(`const ${name} = (/.*/i);`)); return m ? eval(m[1]) : null; };
  const dial = grab('DIALLER_SCHEME'), sms = grab('SMS_SCHEME'), share = grab('SHARE_SCHEME'), host = grab('SHARE_HOST');
  const isD = u => dial.test(u) || sms.test(u) || share.test(u) || host.test(u);
  for (const u of ['tel:112', 'TEL:181', 'sms:+919000000001?body=x', 'smsto:1', 'mailto:a@b.c', 'whatsapp://send?text=x', 'https://wa.me/91900', 'intent://x']) assert.ok(isD(u), u);
  for (const u of ['https://maps.google.com/?q=1,2', 'https://voters.eci.gov.in', 'https://indiacode.nic.in/x']) assert.ok(!isD(u), u);
  // channel routing: tel → dialler, sms → sms, the rest → external_share.
  assert.ok(dial.test('tel:112') && !sms.test('tel:112'));
  assert.ok(sms.test('sms:1') && !dial.test('sms:1'));
});
