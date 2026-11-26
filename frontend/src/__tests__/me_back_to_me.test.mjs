// 26 Nov 2026 (Vivek): any screen opened from a Me row goes Back to Me
// (also after a reload); opened from elsewhere it goes back where it came
// from; pages one level deeper step back one level. SOS is untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => readFileSync(path.join(root, p), 'utf8');

const helper = () => {
  const src = read('src/meBack.ts').replace(/^type [^\n]*\n/m, '').replace(/export /g, '')
    .replace(/\(router: BackRouter\)/, '(router)').replace(/\(router: BackRouter, from: [^,]*, otherwise: \(\) => void\)/, '(router, from, otherwise)');
  return new Function(`${src}; return { backToMe, backFromMe };`)();
};
const fakeRouter = (history) => { const log = []; return { log, canGoBack: () => history, back: () => log.push('back'), replace: h => log.push('replace ' + h) }; };

test('from Me: back when there is history, otherwise straight to Me', () => {
  const { backFromMe } = helper();
  let r = fakeRouter(true); backFromMe(r, 'me', () => r.log.push('other')); assert.deepEqual(r.log, ['back']);
  r = fakeRouter(false); backFromMe(r, 'me', () => r.log.push('other')); assert.deepEqual(r.log, ['replace /(tabs)/me']);
  r = fakeRouter(false); backFromMe(r, ['me'], () => r.log.push('other')); assert.deepEqual(r.log, ['replace /(tabs)/me']);
});

test('not from Me: the screen keeps its own rule', () => {
  const { backFromMe } = helper();
  const r = fakeRouter(true); backFromMe(r, undefined, () => r.log.push('other')); assert.deepEqual(r.log, ['other']);
  const r2 = fakeRouter(true); backFromMe(r2, 'home', () => r2.log.push('other')); assert.deepEqual(r2.log, ['other']);
});

test('every Me row says it was opened from Me', () => {
  const me = read('app/(tabs)/me.tsx');
  for (const r of ['/edit-profile', '/women/trusted-circle', '/family-journey', '/alerts', '/settings/data-privacy', '/language', '/state', '/(tabs)/settings', '/(tabs)/history', '/(tabs)/saved'])
    assert.ok(me.includes(`'${r}?from=me'`), `${r} row lacks ?from=me`);
  assert.match(me, /router\.push\('\/edit-profile\?from=me' as any\)/, 'avatar too');
});

test('screens whose fallback was not Me now honour from=me; State is never stuck', () => {
  assert.match(read('app/settings/data-privacy.tsx'), /onBack=\{\(\) => backFromMe\(router, from, /);
  assert.match(read('app/language.tsx'), /onBack=\{\(\) => backFromMe\(router, from, /);
  const st = read('app/state.tsx');
  assert.match(st, /else backFromMe\(router, params\.from, \(\) => backToMe\(router\)\)/);
  assert.doesNotMatch(st, /else router\.back\(\);/);
  // the shared title row's default Back: previous screen, else Me
  assert.match(read('src/ui/PageTitleRow.tsx'), /router\.canGoBack\(\) \? router\.back\(\) : router\.replace\('\/\(tabs\)\/me'\)/);
});
