// A02: the switches each build profile sets, and the demo-switch build guard.
// Run: node --experimental-strip-types --test src/__tests__/a02_build_profile_switches.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const eas = JSON.parse(readFileSync(join(root, 'eas.json'), 'utf8'));
const profiles = eas.build;

const LOCATION_ON = [
  'EXPO_PUBLIC_SAFETY_SESSION_V1',
  'EXPO_PUBLIC_GO1B_GPS',
  'EXPO_PUBLIC_TRUSTED_CIRCLE_RECIPIENT',
  'EXPO_PUBLIC_TRUSTED_CIRCLE_V2',
  'EXPO_PUBLIC_GUARDIAN_SHARE',
];

function sourceText() {
  let out = '';
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '__tests__' || name.startsWith('.')) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|js)$/.test(name)) out += readFileSync(p, 'utf8');
    }
  };
  walk(join(root, 'src'));
  walk(join(root, 'app'));
  out += readFileSync(join(root, 'app.config.js'), 'utf8');
  return out;
}
const code = sourceText();

test('every build profile has an env block', () => {
  for (const name of ['development', 'internal_qa', 'closed_testing', 'production']) {
    assert.ok(profiles[name]?.env, `${name} has no env block`);
  }
});

test('env names are public switches, values are strings, and the code reads each one', () => {
  for (const [name, p] of Object.entries(profiles)) {
    for (const [k, v] of Object.entries(p.env)) {
      assert.match(k, /^EXPO_PUBLIC_[A-Z0-9_]+$/, `${name}.${k}`);
      assert.equal(typeof v, 'string', `${name}.${k} must be a string`);
      assert.ok(code.includes(`process.env.${k}`), `${name}.${k} is not read anywhere in the app`);
    }
  }
});

test('no secret-looking names or values in eas.json', () => {
  const text = JSON.stringify(profiles);
  assert.doesNotMatch(text, /KEY|SECRET|TOKEN|PASSWORD|AIza/i);
});

test('location switches are on in the three builds people test with', () => {
  for (const name of ['development', 'internal_qa', 'closed_testing']) {
    for (const k of LOCATION_ON) assert.equal(profiles[name].env[k], 'true', `${name}.${k}`);
  }
});

test('demo switch is off in every profile', () => {
  for (const [name, p] of Object.entries(profiles)) {
    assert.equal(p.env.EXPO_PUBLIC_HEADOUT_DEMO, 'false', name);
  }
});

test('QA builds send nothing real', () => {
  for (const name of ['development', 'internal_qa']) {
    const e = profiles[name].env;
    assert.equal(e.EXPO_PUBLIC_OUTBOUND_MODE, 'simulate', name);
    assert.equal(e.EXPO_PUBLIC_OUTBOUND_PROFILE, 'internal_qa', name);
    assert.equal(e.EXPO_PUBLIC_ALERT_SIMULATION_MODE, 'true', name);
  }
});

test('A02 does not decide real sending for closed_testing or production (owner decision X23)', () => {
  for (const name of ['closed_testing', 'production']) {
    const e = profiles[name].env;
    for (const k of ['EXPO_PUBLIC_OUTBOUND_MODE', 'EXPO_PUBLIC_OUTBOUND_PROFILE', 'EXPO_PUBLIC_ALERT_SIMULATION_MODE']) {
      assert.equal(e[k], undefined, `${name}.${k} must stay unset here`);
    }
  }
});

function loadConfig(extra) {
  const env = { PATH: process.env.PATH, ...extra };
  try {
    execFileSync(process.execPath, ['-e',
      "const c=require('./app.config.js'); if (typeof c==='function') c({config:{}});"],
      { cwd: root, env, stdio: 'pipe' });
    return 'ok';
  } catch (e) {
    return String(e.stderr || e.message);
  }
}

test('build guard: demo switch allowed only with the internal_qa profile', () => {
  assert.equal(loadConfig({ EXPO_PUBLIC_HEADOUT_DEMO: 'true', EXPO_PUBLIC_OUTBOUND_PROFILE: 'internal_qa' }), 'ok');
  assert.equal(loadConfig({ EXPO_PUBLIC_HEADOUT_DEMO: 'true' }), 'ok'); // nothing set = internal_qa
  for (const extra of [
    { EXPO_PUBLIC_OUTBOUND_PROFILE: 'closed_testing' },
    { EXPO_PUBLIC_OUTBOUND_PROFILE: 'production' },
    { EXPO_PUBLIC_OUTBOUND_MODE: 'live' },
    { EXPO_PUBLIC_OUTBOUND_MODE: 'live', EXPO_PUBLIC_OUTBOUND_PROFILE: 'sms_only' },
  ]) {
    const out = loadConfig({ EXPO_PUBLIC_HEADOUT_DEMO: 'true', ...extra });
    assert.match(out, /EXPO_PUBLIC_HEADOUT_DEMO is "true"/, JSON.stringify(extra));
  }
});

test('build guard: demo switch off never blocks a build', () => {
  for (const v of ['false', '']) {
    assert.equal(loadConfig({ EXPO_PUBLIC_HEADOUT_DEMO: v, EXPO_PUBLIC_OUTBOUND_MODE: 'live', EXPO_PUBLIC_OUTBOUND_PROFILE: 'production' }), 'ok');
  }
});
