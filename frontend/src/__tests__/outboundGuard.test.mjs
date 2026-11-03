// QA Outbound Guard — static bypass scan + fail-closed mode resolution.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/app/frontend';
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

test('every dispatch entry point checks OUTBOUND_LIVE before calling the OS', () => {
  for (const fn of ['openExternal', 'composeSms', 'shareExternal']) {
    const body = src.slice(src.indexOf(`function ${fn}`));
    const guardAt = body.indexOf('OUTBOUND_LIVE');
    const callAt = Math.min(...['Linking.openURL(', 'sendSMSAsync(', 'Share.share('].map(s => body.indexOf(s)).filter(i => i >= 0));
    assert.ok(guardAt >= 0 && guardAt < callAt, `${fn} must check OUTBOUND_LIVE first`);
  }
  assert.ok(src.includes("Simulated — nothing sent"));
});

test('dispatch URL classification', () => {
  const m = src.match(/const DISPATCH_SCHEME = (\/.*\/i);/); const h = src.match(/const DISPATCH_HOST = (\/.*\/i);/);
  const scheme = eval(m[1]); const host = eval(h[1]);
  const isD = u => scheme.test(u) || host.test(u);
  for (const u of ['tel:112', 'TEL:181', 'sms:+919000000001?body=x', 'smsto:1', 'mailto:a@b.c', 'whatsapp://send?text=x', 'https://wa.me/91900', 'intent://x']) assert.ok(isD(u), u);
  for (const u of ['https://maps.google.com/?q=1,2', 'https://voters.eci.gov.in', 'https://indiacode.nic.in/x']) assert.ok(!isD(u), u);
});
