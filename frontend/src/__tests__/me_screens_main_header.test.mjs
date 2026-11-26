// 26 Nov 2026 (Vivek): screens opened from Me (Edit profile, Trusted Circle,
// Family Journey, Notifications, and Language when signed in) show the shared
// DHARA header; their own navy title bar becomes a light title row under it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => readFileSync(path.join(root, p), 'utf8');
const auto = read('src/ui/AutoHeader.tsx');

test('Me screens are on the shared-header list', () => {
  for (const r of ['/edit-profile', '/women/trusted-circle', '/alerts', '/family-journey']) {
    assert.ok(auto.includes(`'${r}'`), `${r} missing from AUTO_HEADER_ROUTES`);
  }
});

test('Language gets the header only when signed in (first launch unchanged)', () => {
  assert.match(auto, /AUTO_HEADER_SIGNED_IN: readonly string\[\] = \['\/language'\]/);
  assert.match(auto, /if \(signedIn && AUTO_HEADER_SIGNED_IN\.some/);
  assert.match(auto, /return autoHeaderFor\(pathname, !!token\)/);
  assert.doesNotMatch(auto.slice(0, auto.indexOf('AUTO_HEADER_SIGNED_IN')), /'\/language'/);
});

test('title bars step down to a light row under the shared header', () => {
  const sh = read('src/components/dhara/ScreenHeader.tsx');
  assert.match(sh, /if \(useAutoHeaderShown\(\)\) \{[\s\S]{0,200}testID="screen-title-row"/);
  const fj = read('src/familyJourney/ui.tsx');
  assert.match(fj, /if \(useAutoHeaderShown\(\)\) \{[\s\S]{0,200}testID="fj-title-row"/);
  // the light rows carry no SOS of their own (the header has it)
  const lightSh = sh.slice(sh.indexOf('if (useAutoHeaderShown())'), sh.indexOf('  return (', sh.indexOf('if (useAutoHeaderShown())') + 30));
  assert.doesNotMatch(lightSh, /SosPill112/);
});

test('these screens do not pad the top themselves', () => {
  const lang = read('app/language.tsx');
  assert.match(lang, /<SafeAreaView style=\{\[styles\.safe, \{ paddingTop: insets\.top \}\]\} edges=\{\['bottom', 'left', 'right'\]\}/);
  const det = read('app/alerts/[id].tsx');
  for (const m of det.matchAll(/<SafeAreaView\b[^>]*>/g)) assert.match(m[0], /edges=\{\['bottom'\]\}/);
});
