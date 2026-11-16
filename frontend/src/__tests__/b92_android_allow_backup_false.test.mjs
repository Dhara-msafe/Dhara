/**
 * B-92 (D-26, decided 13 Nov): Android's auto-backup must be OFF.
 *
 * By default Android (`android:allowBackup`, which defaults to `true` when
 * unset) lets the OS back up and restore app private storage via Auto
 * Backup / adb backup -- including anything DHARA writes to AsyncStorage or
 * its SQLite/file sandbox (draft notices, Women's Shield data, session
 * tokens). D-26 decided this must be turned off for this app. The fix is a
 * one-line Expo config addition: `android.allowBackup: false` in app.json,
 * which the Expo `AllowBackup` config-plugin reads to write
 * `android:allowBackup="false"` into the generated AndroidManifest.xml at
 * prebuild (see node_modules/@expo/config-plugins/build/android/
 * AllowBackup.js — `getAllowBackup` defaults to `true` when the key is
 * absent, so leaving it unset is the bug, not just an explicit `true`).
 *
 * This test checks two things:
 *  1. app.json itself sets android.allowBackup to false (the actual fix).
 *  2. app.config.js's dynamic config (which spreads ...config.android on
 *     top of app.json's android block) does not strip or override it --
 *     app.config.js only ever *adds* package/googleServicesFile/maps config
 *     under android, so this is a regression guard against someone later
 *     replacing the android block wholesale instead of spreading it.
 *
 * Run with: node --experimental-strip-types --test src/__tests__/b92_android_allow_backup_false.test.mjs
 * (run from the frontend/ directory)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const APP_JSON_PATH = require.resolve('../../app.json');
const CONFIG_PATH = require.resolve('../../app.config.js');

function loadAppJson() {
  return JSON.parse(readFileSync(APP_JSON_PATH, 'utf8'));
}

function loadConfigFn() {
  delete require.cache[CONFIG_PATH];
  return require(CONFIG_PATH);
}

function runConfig(appJson) {
  const savedMapsAndroid = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  const savedMapsIos = process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY;
  try {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'dummy-key-for-tests';
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY = 'dummy-key-for-tests';
    const configFn = loadConfigFn();
    return configFn({ config: appJson.expo, platform: 'android' });
  } finally {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = savedMapsAndroid;
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY = savedMapsIos;
  }
}

test('app.json sets android.allowBackup to false', () => {
  const appJson = loadAppJson();
  assert.equal(appJson.expo.android.allowBackup, false);
});

test('app.config.js (the actual config Expo/EAS builds from) preserves allowBackup: false', () => {
  const appJson = loadAppJson();
  const result = runConfig(appJson);
  assert.equal(
    result.android.allowBackup,
    false,
    'app.config.js must not drop allowBackup when it spreads/overrides the android block',
  );
});
