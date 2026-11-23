import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const header = readFileSync(new URL('../components/dhara/ScreenHeader.tsx', import.meta.url), 'utf8');
const flags = readFileSync(new URL('../uiV22Flags.ts', import.meta.url), 'utf8');

test('ScreenHeader imports the S2 flag', () => {
  assert.match(header, /import \{ UI_V22_S2 \} from '\.\.\/\.\.\/uiV22Flags';/);
});

test('UI_V22_S2 is declared and reads its own env var', () => {
  assert.match(flags, /export const UI_V22_S2 = process\.env\.EXPO_PUBLIC_UI_V22_S2 === 'true';/);
});

test('back button is 48px with the flag on, exact ternary', () => {
  assert.match(
    header,
    /back: \{ width: UI_V22_S2 \? 48 : 40, height: UI_V22_S2 \? 48 : 40, alignItems: 'center', justifyContent: 'center' \}/
  );
});

test('flag off keeps the original 40px back button (reversibility)', () => {
  assert.match(header, /: 40, height: UI_V22_S2 \? 48 : 40/);
});

test('back button keeps its accessibility label and testID either way', () => {
  assert.match(header, /testID="screen-back"/);
  assert.match(header, /accessibilityLabel="Go back"/);
});
