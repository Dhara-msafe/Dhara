import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const tabBar = readFileSync(new URL('../components/AppTabBar.tsx', import.meta.url), 'utf8');
const sosPill = readFileSync(new URL('../components/dhara/SosPill.tsx', import.meta.url), 'utf8');

test('AppTabBar tabs already meet the 48px minimum (52px) — no change needed', () => {
  assert.match(tabBar, /tab: \{ flex: 1, minHeight: 52,/);
});

test('AppTabBar keeps exactly the 4 real-app tabs (Home, Rights, My files, Me) plus the Ask mic', () => {
  assert.match(tabBar, /name: 'home',\s*key: 'nav\.home'/);
  assert.match(tabBar, /name: 'rights',\s*key: 'nav\.rights'/);
  assert.match(tabBar, /name: 'myfiles',\s*key: 'nav\.myfiles'/);
  assert.match(tabBar, /name: 'me',\s*key: 'nav\.me'/);
  assert.match(tabBar, /testID="tab-ask"/);
});

test('SOS pill is already 48px tall — no change needed', () => {
  assert.match(sosPill, /sos: \{[^}]*height: 48,/);
});

test('Quick exit pill is already 48px tall — no change needed', () => {
  assert.match(sosPill, /qe: \{[^}]*height: 48,/);
});

test('the nav Chip here is distinct from the consent Status chip (out of scope, belongs to S13)', () => {
  // Sanity check: this Chip takes an icon/label, not a consent state.
  assert.match(sosPill, /export function Chip\(\{ icon, label, onPress, light \}/);
  assert.doesNotMatch(sosPill, /Agreed|Not given|Withdrawn/);
});
