import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const src = readFileSync(new URL('../AutoHeader.tsx', import.meta.url), 'utf8');
const routes = [...src.matchAll(/'(\/[a-z\-\/]+)'/g)].map((m) => m[1]).filter((r) => r !== '/');
const fileFor = (r: string) => {
  const base = new URL(`../../../app${r}`, import.meta.url).pathname;
  return [base + '.tsx', base + '/index.tsx', base + '/[token].tsx'].filter(existsSync);
};

test('every auto-header route is a real screen', () => {
  assert.ok(routes.length >= 10);
  for (const r of routes) {
    const dir = new URL(`../../../app${r}`, import.meta.url).pathname;
    assert.ok(fileFor(r).length > 0 || existsSync(dir), `no screen for ${r}`);
  }
});

test('auto-header screens do not pad the top edge themselves', () => {
  for (const r of routes) {
    for (const f of fileFor(r)) {
      const s = readFileSync(f, 'utf8');
      for (const m of s.matchAll(/<SafeAreaView\b[^>]*>/g)) {
        const tag = m[0];
        const edges = /edges=\{\[([^\]]*)\]\}/.exec(tag);
        assert.ok(edges, `${f}: <SafeAreaView> needs explicit edges (no top)`);
        assert.ok(!/'top'/.test(edges[1]), `${f}: <SafeAreaView> must not include the top edge`);
      }
    }
  }
});
