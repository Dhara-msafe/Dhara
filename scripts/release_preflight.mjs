#!/usr/bin/env node
/**
 * B-02 — release preflight (the 4th D-01 item: "Internal QA builds simulate
 * emergency calls (QA MODE banner, `-qa` version name, build check, release
 * preflight)").
 *
 * This is a human-run gate, separate from and earlier than app.config.js's
 * own build check: it's meant to be run BEFORE kicking off a
 * closed_testing/production build at all, so a misconfiguration is caught
 * with a clear message instead of surfacing later as a cryptic build
 * failure, or — worse — not being caught at all and shipping broken.
 *
 * Run with:  node scripts/release_preflight.mjs
 * Exits non-zero (refuses to proceed) on any failed check.
 *
 * Intentionally narrow: it checks the handful of settings that, if wrong,
 * either (a) make a real release silently behave like a QA build (nothing
 * actually dials/sends for a real user) or (b) ship a real release with
 * admin access either disabled or guessable. It does not replace a human
 * release checklist, CI, or QA sign-off.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const VALID_PROFILES = ['internal_qa', 'closed_testing', 'production'];

const WEAK_ADMIN_KEYS = new Set([
  'test', 'test_admin', 'admin', 'changeme', 'change_me', 'password',
  'secret', 'admin123', '123456', 'default', 'placeholder', '',
]);

function fail(checks, name, detail) {
  checks.push({ name, ok: false, detail });
}
function pass(checks, name, detail) {
  checks.push({ name, ok: true, detail });
}

export function runPreflight(env = process.env, appJsonPath = join(REPO_ROOT, 'frontend', 'app.json')) {
  const checks = [];

  // ── 1. Outbound profile must be an explicit, real release profile ───────
  const rawProfile = env.EXPO_PUBLIC_OUTBOUND_PROFILE || '';
  if (!VALID_PROFILES.includes(rawProfile)) {
    fail(checks, 'outbound-profile-set',
      `EXPO_PUBLIC_OUTBOUND_PROFILE is "${rawProfile || '(unset)'}" — a release build must set it explicitly to ` +
      `"closed_testing" or "production". Left unset (or invalid), outbound.ts's own fallback would quietly resolve ` +
      `it to "internal_qa" (unless the master switch is live), which simulates every dial/SMS/share.`);
  } else if (rawProfile === 'internal_qa') {
    fail(checks, 'outbound-profile-not-qa',
      `EXPO_PUBLIC_OUTBOUND_PROFILE is "internal_qa" — this is a QA build, not a release. Refusing to preflight it ` +
      `as one.`);
  } else {
    pass(checks, 'outbound-profile-set', `EXPO_PUBLIC_OUTBOUND_PROFILE = "${rawProfile}"`);
  }

  // ── 2. Outbound master switch must be live for a real release ───────────
  const mode = env.EXPO_PUBLIC_OUTBOUND_MODE || '';
  if (mode !== 'live') {
    fail(checks, 'outbound-mode-live',
      `EXPO_PUBLIC_OUTBOUND_MODE is "${mode || '(unset)'}", not "live". With the profile set to closed_testing/` +
      `production but the master switch not live, shouldDispatch() is false for every channel — the dialler, SMS ` +
      `and share would ALL silently simulate for real users, who would see nothing happen when they tap Call.`);
  } else {
    pass(checks, 'outbound-mode-live', 'EXPO_PUBLIC_OUTBOUND_MODE = "live"');
  }

  // ── 3. App version must not carry a leftover "-qa" suffix ───────────────
  let baseVersion = '';
  try {
    baseVersion = JSON.parse(readFileSync(appJsonPath, 'utf8'))?.expo?.version || '';
  } catch (e) {
    fail(checks, 'version-readable', `Could not read/parse ${appJsonPath}: ${e.message}`);
  }
  if (baseVersion) {
    if (/-qa$/i.test(baseVersion.trim())) {
      fail(checks, 'version-not-qa-suffixed',
        `app.json's version "${baseVersion}" already carries a "-qa" suffix. A closed_testing/production release ` +
        `must not look like an internal QA build (app.config.js's own build check will also refuse this at build ` +
        `time — this just catches it earlier).`);
    } else {
      pass(checks, 'version-not-qa-suffixed', `app.json version "${baseVersion}" has no "-qa" suffix`);
    }
  }

  // ── 4. Backend ADMIN_KEY must be set and not an obviously weak value ────
  const adminKey = (env.ADMIN_KEY || '').trim();
  if (!adminKey) {
    fail(checks, 'admin-key-set',
      `ADMIN_KEY is unset/empty. The backend's check_admin_key() disables every admin endpoint (503) when this is ` +
      `empty — safe by default, but confirm that's actually intended for this release (if any admin tooling is ` +
      `needed post-launch, it won't work until this is set).`);
  } else if (WEAK_ADMIN_KEYS.has(adminKey.toLowerCase())) {
    fail(checks, 'admin-key-not-weak',
      `ADMIN_KEY is set to an obviously weak/placeholder value. A real release must use a strong, unique secret — ` +
      `not a word from a common wordlist.`);
  } else {
    pass(checks, 'admin-key-not-weak', 'ADMIN_KEY is set and is not an obvious placeholder');
  }

  return checks;
}

function main() {
  const checks = runPreflight();
  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) {
    console.log(`${c.ok ? '✅' : '❌'} ${c.name} — ${c.detail}`);
  }
  if (failed.length > 0) {
    console.error(`\nRelease preflight FAILED: ${failed.length} check(s) did not pass. Not safe to release.`);
    process.exitCode = 1;
  } else {
    console.log('\nRelease preflight PASSED. (This does not replace QA sign-off or on-device testing.)');
  }
}

// Only run as a CLI when invoked directly (not when imported by a test).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
