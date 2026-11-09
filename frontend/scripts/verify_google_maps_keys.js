#!/usr/bin/env node
/**
 * Google Maps client-key configuration audit — review Task 1 (frontend half).
 *
 * Reports presence of the three client-side Maps keys + the Places
 * autocomplete pilot flag, then does one live reachability check against
 * the Maps JavaScript API loader using the web key. Never prints key
 * values — only presence, length, and the loader's pass/fail response.
 *
 * Android/iOS SDK keys are consumed at native-build time (see
 * app.config.js) and can only be fully verified by an actual Preview/
 * Production build on a device — this script can only confirm they're
 * present and non-placeholder, not that they work.
 *
 * Usage (from frontend/):
 *   node scripts/verify_google_maps_keys.js
 *
 * Exit codes: 0 = web key check passed or was skipped, 1 = web key is set
 * but the loader rejected it.
 */

function isPlaceholder(key) {
  return !key || key.trim() === '' || key.toUpperCase().includes('PLACEHOLDER');
}

function keyState(value) {
  return isPlaceholder(value) ? '(unset / placeholder)' : `set (${value.length} chars)`;
}

async function checkWebKey(key) {
  const url = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places`;
  const resp = await fetch(url);
  const body = await resp.text();
  if (resp.status !== 200) {
    return { ok: false, msg: `HTTP ${resp.status} from loader` };
  }
  // Google always returns 200 for this endpoint; a bad/restricted key embeds
  // an error inside the returned JS instead of an HTTP error code.
  if (/InvalidKeyMapError|RefererNotAllowedMapError|ApiNotActivatedMapError/.test(body)) {
    const match = body.match(/(InvalidKeyMapError|RefererNotAllowedMapError|ApiNotActivatedMapError)/);
    return { ok: false, msg: `loader rejected key — ${match[1]}` };
  }
  if (/BillingNotEnabledMapError/.test(body)) {
    return { ok: false, msg: 'loader rejected key — billing not enabled' };
  }
  return { ok: true, msg: 'OK — loader accepted the key' };
}

async function main() {
  const androidKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';
  const iosKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY || '';
  const webKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY || '';
  const placesFlag = process.env.EXPO_PUBLIC_PLACES_AUTOCOMPLETE_V1 === 'true';

  console.log('─── Client-side key presence (values never printed) ───');
  console.log(`  EXPO_PUBLIC_GOOGLE_MAPS_API_KEY       ${keyState(androidKey)}`);
  console.log(`  EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY   ${keyState(iosKey)}`);
  console.log(`  EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY   ${keyState(webKey)}`);
  console.log('─── Feature flag ───');
  console.log(`  EXPO_PUBLIC_PLACES_AUTOCOMPLETE_V1    ${placesFlag}`);

  let failures = 0;

  console.log('─── Live reachability check ───');
  if (!isPlaceholder(webKey)) {
    const { ok, msg } = await checkWebKey(webKey);
    console.log(`  Maps JavaScript API (web key)         ${ok ? '✅' : '❌'} ${msg}`);
    if (!ok) failures += 1;
  } else {
    console.log('  Maps JavaScript API (web key)          skipped — key unset or placeholder');
  }

  console.log('─── Not checkable from here ───');
  console.log('  Android/iOS SDK keys require an actual native build on a device (Task 6).');
  console.log('  Per-key restrictions (package+cert / bundle ID / HTTP referrer) and billing');
  console.log('  budget alerts live in Google Cloud Console — check there directly.');

  console.log(failures ? `─── FAIL — ${failures} configured key(s) rejected ───` : '─── PASS ───');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error('─── FAIL —', err.message, '───');
  process.exit(1);
});
