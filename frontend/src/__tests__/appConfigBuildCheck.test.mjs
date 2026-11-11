/**
 * B-02 (partial — the "build check" + "-qa version name" piece of D-01).
 *
 * D-01: "Internal QA builds simulate emergency calls (QA MODE banner, `-qa`
 * version name, build check, release preflight)." Before this fix, only the
 * dialler/SMS/share simulation itself existed (outbound.ts) and, as of B-06,
 * the on-screen banner — nothing ever appended "-qa" to the shipped version,
 * and nothing refused a build whose version and EXPO_PUBLIC_OUTBOUND_PROFILE
 * disagreed. Release preflight is tracked separately and is not part of
 * this fix.
 *
 * app.config.js is plain CommonJS (no react-native import), so unlike most
 * of this repo's frontend logic it can be required and actually executed
 * here — this is real behavioral coverage, not a source-wiring check.
 *
 * Run with: node --test src/__tests__/appConfigBuildCheck.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CONFIG_PATH = require.resolve('../../app.config.js');

const OUTBOUND_ENV_KEYS = ['EXPO_PUBLIC_OUTBOUND_PROFILE', 'EXPO_PUBLIC_OUTBOUND_MODE'];

function loadConfigFn() {
  delete require.cache[CONFIG_PATH];
  return require(CONFIG_PATH);
}

/** Runs app.config.js's exported function with a clean outbound-flag
 * environment (plus the given overrides) and dummy Maps keys, so the
 * unrelated placeholder-key guard never fires in these tests. */
function run({ env = {}, version = '1.0.0', platform = 'android' } = {}) {
  const savedMapsAndroid = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  const savedMapsIos = process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY;
  const savedOutbound = {};
  for (const k of OUTBOUND_ENV_KEYS) savedOutbound[k] = process.env[k];

  try {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'dummy-key-for-tests';
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY = 'dummy-key-for-tests';
    for (const k of OUTBOUND_ENV_KEYS) delete process.env[k];
    Object.assign(process.env, env);

    const configFn = loadConfigFn();
    return configFn({ config: { version }, platform });
  } finally {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = savedMapsAndroid;
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY = savedMapsIos;
    for (const k of OUTBOUND_ENV_KEYS) {
      if (savedOutbound[k] === undefined) delete process.env[k];
      else process.env[k] = savedOutbound[k];
    }
  }
}

test('no profile set (defaults to internal_qa, matching outbound.ts) -> "-qa" is appended automatically', () => {
  const result = run({ env: {}, version: '1.0.0' });
  assert.equal(result.version, '1.0.0-qa');
});

test('EXPO_PUBLIC_OUTBOUND_PROFILE=internal_qa -> "-qa" is appended, and not doubled if already present', () => {
  let result = run({ env: { EXPO_PUBLIC_OUTBOUND_PROFILE: 'internal_qa' }, version: '1.0.0' });
  assert.equal(result.version, '1.0.0-qa');
  result = run({ env: { EXPO_PUBLIC_OUTBOUND_PROFILE: 'internal_qa' }, version: '1.0.0-qa' });
  assert.equal(result.version, '1.0.0-qa', 'must not become 1.0.0-qa-qa');
});

test('EXPO_PUBLIC_OUTBOUND_PROFILE=closed_testing -> version passes through unchanged', () => {
  const result = run({ env: { EXPO_PUBLIC_OUTBOUND_PROFILE: 'closed_testing' }, version: '1.2.3' });
  assert.equal(result.version, '1.2.3');
});

test('EXPO_PUBLIC_OUTBOUND_PROFILE=production -> version passes through unchanged', () => {
  const result = run({ env: { EXPO_PUBLIC_OUTBOUND_PROFILE: 'production' }, version: '1.2.3' });
  assert.equal(result.version, '1.2.3');
});

test('EXPO_PUBLIC_OUTBOUND_MODE=live with no explicit profile resolves to production (mirrors outbound.ts) -> unchanged', () => {
  const result = run({ env: { EXPO_PUBLIC_OUTBOUND_MODE: 'live' }, version: '1.2.3' });
  assert.equal(result.version, '1.2.3');
});

test('build check: refuses a production build whose version still carries "-qa"', () => {
  assert.throws(
    () => run({ env: { EXPO_PUBLIC_OUTBOUND_PROFILE: 'production' }, version: '1.0.0-qa' }),
    /Refusing production build.*"-qa"/s,
  );
});

test('build check: refuses a closed_testing build whose version still carries "-qa"', () => {
  assert.throws(
    () => run({ env: { EXPO_PUBLIC_OUTBOUND_PROFILE: 'closed_testing' }, version: '1.0.0-qa' }),
    /Refusing closed_testing build.*"-qa"/s,
  );
});

test('build check is case-insensitive on the "-qa" suffix', () => {
  assert.throws(
    () => run({ env: { EXPO_PUBLIC_OUTBOUND_PROFILE: 'production' }, version: '1.0.0-QA' }),
    /Refusing production build/,
  );
});
