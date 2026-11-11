/**
 * B-02 — release preflight (the 4th D-01 item).
 *
 * release_preflight.mjs is plain Node/ESM with no react-native dependency,
 * so (like app.config.js) it can be imported and actually executed here —
 * real behavioral coverage, not a source-wiring check.
 *
 * Run with: node --test scripts/__tests__/release_preflight.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPreflight } from '../release_preflight.mjs';

function tmpAppJson(version) {
  const dir = mkdtempSync(join(tmpdir(), 'preflight-test-'));
  const path = join(dir, 'app.json');
  writeFileSync(path, JSON.stringify({ expo: { version } }), 'utf8');
  return path;
}

function okCount(checks) {
  return checks.filter((c) => c.ok).length;
}
function failNames(checks) {
  return checks.filter((c) => !c.ok).map((c) => c.name);
}

test('a fully correct release environment passes every check', () => {
  const appJson = tmpAppJson('1.0.0');
  const checks = runPreflight(
    { EXPO_PUBLIC_OUTBOUND_PROFILE: 'production', EXPO_PUBLIC_OUTBOUND_MODE: 'live', ADMIN_KEY: 'a-real-unique-secret-9f3k' },
    appJson,
  );
  assert.equal(okCount(checks), checks.length, `expected all to pass, failed: ${failNames(checks)}`);
});

test('closed_testing is also an accepted release profile (not just production)', () => {
  const appJson = tmpAppJson('1.0.0');
  const checks = runPreflight(
    { EXPO_PUBLIC_OUTBOUND_PROFILE: 'closed_testing', EXPO_PUBLIC_OUTBOUND_MODE: 'live', ADMIN_KEY: 'a-real-unique-secret-9f3k' },
    appJson,
  );
  assert.ok(checks.find((c) => c.name === 'outbound-profile-set').ok);
});

test('no profile set at all fails (must not silently default to internal_qa for a release)', () => {
  const appJson = tmpAppJson('1.0.0');
  const checks = runPreflight({ EXPO_PUBLIC_OUTBOUND_MODE: 'live', ADMIN_KEY: 'a-real-unique-secret-9f3k' }, appJson);
  assert.ok(failNames(checks).includes('outbound-profile-set'));
});

test('internal_qa profile is explicitly refused (this is not a release)', () => {
  const appJson = tmpAppJson('1.0.0');
  const checks = runPreflight(
    { EXPO_PUBLIC_OUTBOUND_PROFILE: 'internal_qa', EXPO_PUBLIC_OUTBOUND_MODE: 'live', ADMIN_KEY: 'a-real-unique-secret-9f3k' },
    appJson,
  );
  assert.ok(failNames(checks).includes('outbound-profile-not-qa'));
});

test('master switch not live fails, even with a real profile (would silently simulate for real users)', () => {
  const appJson = tmpAppJson('1.0.0');
  const checks = runPreflight(
    { EXPO_PUBLIC_OUTBOUND_PROFILE: 'production', EXPO_PUBLIC_OUTBOUND_MODE: 'simulate', ADMIN_KEY: 'a-real-unique-secret-9f3k' },
    appJson,
  );
  assert.ok(failNames(checks).includes('outbound-mode-live'));
});

test('a "-qa" suffixed version fails for a release (mirrors app.config.js\'s build check, catches it earlier)', () => {
  const appJson = tmpAppJson('1.0.0-qa');
  const checks = runPreflight(
    { EXPO_PUBLIC_OUTBOUND_PROFILE: 'production', EXPO_PUBLIC_OUTBOUND_MODE: 'live', ADMIN_KEY: 'a-real-unique-secret-9f3k' },
    appJson,
  );
  assert.ok(failNames(checks).includes('version-not-qa-suffixed'));
});

test('an empty ADMIN_KEY fails (confirm it is actually intended before shipping)', () => {
  const appJson = tmpAppJson('1.0.0');
  const checks = runPreflight(
    { EXPO_PUBLIC_OUTBOUND_PROFILE: 'production', EXPO_PUBLIC_OUTBOUND_MODE: 'live', ADMIN_KEY: '' },
    appJson,
  );
  assert.ok(failNames(checks).includes('admin-key-set'));
});

test('a weak/placeholder ADMIN_KEY fails', () => {
  const appJson = tmpAppJson('1.0.0');
  for (const weak of ['test', 'changeme', 'admin', 'ADMIN']) {
    const checks = runPreflight(
      { EXPO_PUBLIC_OUTBOUND_PROFILE: 'production', EXPO_PUBLIC_OUTBOUND_MODE: 'live', ADMIN_KEY: weak },
      appJson,
    );
    assert.ok(failNames(checks).includes('admin-key-not-weak'), `"${weak}" should be rejected as weak`);
  }
});
