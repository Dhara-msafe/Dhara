// B-83 (14 Nov 2026): the Data & Privacy screen's "Download my data" button
// used to POST to /api/user/data-export — a stub that only logged the
// request and always showed "We'll email your data export within 24 hours",
// even though nothing was ever emailed and no file was ever produced.
//
// The fix points this button at the same real, working export the app
// already has at Settings -> My Data (GET /api/user/my-data/export, written
// to a temp file and shared via expo-sharing / a web Blob download), instead
// of the dead stub, and removes the now-false "emailed" promise.
//
// These are source-wiring checks (readFileSync + regex) rather than executed
// component tests, matching this repo's existing *.test.mjs convention for
// React Native screens whose imports (expo-router, react-native, etc.) can't
// be loaded in plain Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenPath = path.join(__dirname, '..', '..', 'app', 'settings', 'data-privacy.tsx');
const myDataPath = path.join(__dirname, '..', '..', 'app', 'my-data.tsx');
const src = readFileSync(screenPath, 'utf8');
const myDataSrc = readFileSync(myDataPath, 'utf8');

test('data-privacy.tsx no longer calls the dead POST /api/user/data-export stub', () => {
  assert.ok(
    !src.includes("/api/user/data-export'") && !src.includes('/api/user/data-export`'),
    'handleDownload should not call the stub endpoint anymore',
  );
});

test('data-privacy.tsx calls the real, working export endpoint', () => {
  assert.match(src, /\/api\/user\/my-data\/export/);
});

test('data-privacy.tsx no longer promises an email that is never sent', () => {
  assert.ok(
    !src.includes("We'll email your data export within 24 hours"),
    'the canned "emailed within 24 hours" copy must be removed since no email is ever sent',
  );
});

test('data-privacy.tsx writes the export to a temp file and shares it on native, like my-data.tsx does', () => {
  assert.match(src, /from 'expo-file-system'/);
  assert.match(src, /from 'expo-sharing'/);
  assert.match(src, /Sharing\.isAvailableAsync\(/);
  assert.match(src, /Sharing\.shareAsync\(/);
  assert.match(src, /tempFile\.delete\(\)/);
});

test('data-privacy.tsx handles web via a Blob download, matching my-data.tsx', () => {
  assert.match(src, /Platform\.OS === 'web'/);
  assert.match(src, /new Blob\(\[jsonStr\]/);
  assert.match(src, /URL\.createObjectURL\(/);
});

test('handleDownload is still wired to the download button', () => {
  assert.match(src, /onPress=\{handleDownload\}/);
});

test('reference: my-data.tsx export flow is unchanged (the pattern being mirrored)', () => {
  assert.match(myDataSrc, /\/api\/user\/my-data\/export/);
  assert.match(myDataSrc, /Sharing\.shareAsync\(/);
});
