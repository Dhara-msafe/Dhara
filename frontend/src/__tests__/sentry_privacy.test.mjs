/**
 * Crash reporting must never carry what the user typed.
 *
 * DHARA is used to write "my husband hit me", to store evidence and to enter
 * a locker PIN. Sentry's defaults would carry much of that off the device:
 * breadcrumbs record console output and navigation parameters, HTTP
 * breadcrumbs can carry request bodies, replay and screenshots record the
 * screen, sendDefaultPii attaches IP and identity.
 *
 * These assertions are the privacy contract. If one fails, do not relax it —
 * the setting it guards was turned off for a reason.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');

const sentry = read('src', 'observability', 'sentry.ts');
const layout = read('app', '_layout.tsx');
const pkg = JSON.parse(read('package.json'));
const eas = JSON.parse(read('eas.json'));

test('off unless a DSN is set and the flag is exactly "true"', () => {
  assert.match(sentry, /const DSN = process\.env\.EXPO_PUBLIC_SENTRY_DSN \?\? '';/);
  assert.match(sentry, /ENABLED = process\.env\.EXPO_PUBLIC_SENTRY_ENABLED === 'true' && DSN\.length > 0;/);
  assert.match(sentry, /if \(!ENABLED\) return;/);
});

test('no DSN is committed to the repo', () => {
  // a Sentry DSN looks like https://<key>@<org>.ingest.sentry.io/<project>
  assert.ok(!/ingest\.sentry\.io/.test(sentry), 'a DSN must live in Secrets, never here');
  for (const profile of Object.values(eas.build ?? {})) {
    const env = profile.env ?? {};
    assert.ok(!('EXPO_PUBLIC_SENTRY_DSN' in env), 'the DSN must not be in eas.json');
  }
});

const MUST_BE_OFF = [
  ['sendDefaultPii', /sendDefaultPii: false/, 'IP address and user identity'],
  ['attachScreenshot', /attachScreenshot: false/, 'a picture of the screen'],
  ['attachViewHierarchy', /attachViewHierarchy: false/, 'the view tree, which contains text'],
  ['replaysSessionSampleRate', /replaysSessionSampleRate: 0/, 'session replay'],
  ['replaysOnErrorSampleRate', /replaysOnErrorSampleRate: 0/, 'replay on error'],
  ['maxBreadcrumbs', /maxBreadcrumbs: 0/, 'console and navigation trails'],
  ['enableCaptureFailedRequests', /enableCaptureFailedRequests: false/, 'request bodies'],
  ['enableAutoPerformanceTracing', /enableAutoPerformanceTracing: false/, 'traced URLs'],
  ['tracesSampleRate', /tracesSampleRate: 0/, 'performance traces'],
  ['enableAutoSessionTracking', /enableAutoSessionTracking: false/, 'a usage feed'],
];

for (const [option, re, why] of MUST_BE_OFF) {
  test(`${option} is off — it would send ${why}`, () => {
    assert.match(sentry, re);
  });
}

test('breadcrumbs are dropped at the source too', () => {
  assert.match(sentry, /beforeBreadcrumb: \(\) => null,/);
});

test('beforeSend strips identity, request data, messages and exception text', () => {
  assert.match(sentry, /beforeSend: scrubEvent,/);
  for (const line of [
    /delete event\.user;/,
    /delete event\.server_name;/,
    /delete event\.request\.data;/,
    /delete event\.request\.cookies;/,
    /delete event\.request\.headers;/,
    /if \(value\.value\) value\.value = SCRUBBED;/,
    /if \(event\.message\) event\.message = SCRUBBED;/,
    /event\.breadcrumbs = \[\];/,
  ]) assert.match(sentry, line);
});

test('URLs keep the path but lose the query string', () => {
  assert.match(sentry, /return q === -1 \? url : `\$\{url\.slice\(0, q\)\}\?\$\{SCRUBBED\}`;/);
});

test('it is initialised before the first render', () => {
  assert.match(layout, /import \{ initCrashReporting \} from "@\/src\/observability\/sentry";/);
  assert.match(layout, /^initCrashReporting\(\);$/m);
});

test('the SDK is a real dependency, pinned', () => {
  const v = pkg.dependencies['@sentry/react-native'];
  assert.ok(v, '@sentry/react-native should be in dependencies');
  assert.match(v, /^\d+\.\d+\.\d+$/, 'pin it exactly — a native SDK should not float');
});

test('no build profile turns it on yet', () => {
  // Legal has to name the processor in the privacy notice first.
  for (const [name, profile] of Object.entries(eas.build ?? {})) {
    const on = (profile.env ?? {}).EXPO_PUBLIC_SENTRY_ENABLED;
    assert.notEqual(on, 'true', `${name} must not enable crash reporting yet`);
  }
});
