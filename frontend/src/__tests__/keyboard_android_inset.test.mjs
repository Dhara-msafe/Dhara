/**
 * Android keyboard inset — the client's 23 Nov report.
 *
 * Nine screens wrapped their content in React Native's KeyboardAvoidingView
 * with `behavior={Platform.OS === 'ios' ? 'padding' : undefined}`. On Android
 * `undefined` makes the component a no-op, so the keyboard covered the field
 * being typed in. The app runs edge to edge, so the window no longer resizes
 * for the keyboard either, and nothing caught it.
 *
 * Behind EXPO_PUBLIC_UI_INPUT_INSET (default OFF), those screens render
 * the keyboard-controller KeyboardAvoidingView that the Ask tab already uses.
 *
 * Source-level tests, qaModeBanner.test.mjs convention.
 * Run with: node --test src/__tests__/keyboard_android_inset.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');

const flags = read('src', 'uiV22Flags.ts');
const wrapper = read('src', 'components', 'KeyboardSafeView.tsx');

/** The screens this PR converted, with the behaviour each one needs. */
const CONVERTED = [
  [['app', 'fir-draft', 'index.tsx'], 'translate-with-padding'],
  [['app', '(tabs)', 'lookup.tsx'], 'padding'],
  [['app', 'ipc-bns-lookup.tsx'], 'padding'],
  [['app', 'missing', 'interview.tsx'], 'padding'],
  [['app', 'missing', 'attachments.tsx'], 'padding'],
  [['app', 'notetaker', 'index.tsx'], 'padding'],
  [['app', 'notetaker', 'consultation', 'new.tsx'], 'padding'],
  [['app', 'voter-roll', 'form.tsx'], 'padding'],
  [['app', 'intake', '[token].tsx'], 'padding'],
];

test('flag defaults OFF', () => {
  assert.match(
    flags,
    /export const UI_INPUT_INSET = process\.env\.EXPO_PUBLIC_UI_INPUT_INSET === 'true';/,
  );
});

test('with the flag off the wrapper renders exactly the old component and props', () => {
  assert.match(wrapper, /if \(!UI_INPUT_INSET\)/);
  // the old, broken-on-Android props are kept deliberately, so off is a true
  // rollback rather than a third behaviour
  assert.match(wrapper, /RNKeyboardAvoidingView[\s\S]*behavior=\{Platform\.OS === 'ios' \? 'padding' : undefined\}/);
  assert.match(wrapper, /from 'react-native-keyboard-controller'/);
});

test('the wrapper is presentation only', () => {
  for (const banned of ['fetch(', 'AsyncStorage', 'useRouter', 'router.', 'api', 'onSubmit']) {
    assert.ok(!wrapper.includes(banned), `KeyboardSafeView should not reference ${banned}`);
  }
});

for (const [parts, behavior] of CONVERTED) {
  const name = parts.join('/');

  test(`${name} uses KeyboardSafeView, not the raw component`, () => {
    const src = read(...parts);
    assert.ok(
      !src.includes('KeyboardAvoidingView'),
      `${name} still references KeyboardAvoidingView directly`,
    );
    assert.match(src, /<KeyboardSafeView/);
    assert.match(src, /<\/KeyboardSafeView>/);
    assert.match(src, /import \{ KeyboardSafeView \} from '@\/src\/components\/KeyboardSafeView';/);
  });

  test(`${name} asks for behavior="${behavior}"`, () => {
    const src = read(...parts);
    assert.ok(
      src.includes(`behavior="${behavior}"`),
      `${name} should pass behavior="${behavior}"`,
    );
  });
}

test('no screen is left with the no-op Android behavior', () => {
  // The exception is the wrapper itself, which keeps it for the flag-off path.
  const noop = "behavior={Platform.OS === 'ios' ? 'padding' : undefined}";
  for (const [parts] of CONVERTED) {
    assert.ok(!read(...parts).includes(noop), `${parts.join('/')} still has the no-op behavior`);
  }
});

test('the Ask tab is untouched and still on keyboard-controller', () => {
  const ask = read('app', '(tabs)', 'index.tsx');
  assert.match(ask, /import \{ KeyboardAvoidingView \} from 'react-native-keyboard-controller';/);
  assert.match(ask, /behavior="translate-with-padding"/);
});

test('the location DestinationPicker is deliberately left alone', () => {
  // Same defect, but it sits in Sindhu's live location work (A10, A28).
  // Converting it here would collide; it is reported to that chat instead.
  const picker = read('src', 'women', 'DestinationPicker.tsx');
  assert.ok(picker.includes('KeyboardAvoidingView'), 'DestinationPicker was changed; it should not be');
});
