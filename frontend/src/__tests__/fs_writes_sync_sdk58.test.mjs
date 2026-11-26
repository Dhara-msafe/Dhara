// 26 Nov 2026 (Vivek): expo-file-system 58 turned File.write / FileHandle.
// writeBytes / readBytes / File.copy / File.move into background jobs that
// return a Promise. Code written for SDK 55 called them and carried on
// (play the audio, share the export, move the write position, close the
// file) before the data was on disk. Every such call must either use the
// *Sync form or be awaited.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const walk = d => readdirSync(d).flatMap(n => { const p = path.join(d, n); return statSync(p).isDirectory() ? (n === '__tests__' || n === 'node_modules' ? [] : walk(p)) : /\.(ts|tsx)$/.test(n) ? [p] : []; });
const files = [...walk(path.join(root, 'app')), ...walk(path.join(root, 'src'))]
  .filter(f => /from 'expo-file-system';/.test(readFileSync(f, 'utf8')));

test('the app still uses the new expo-file-system API somewhere (guard is live)', () => {
  assert.ok(files.length >= 10, `only ${files.length} files`);
});

test('no file save, read, copy or move runs in the background without being awaited', () => {
  const bad = [];
  for (const f of files) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      if (/^\s*\*/.test(line)) return;
      const m = code.match(/([A-Za-z_][\w]*)\.(write|writeBytes|readBytes|copy|move)\s*(?:as [^)]*\))?\(/) || code.match(/\(([A-Za-z_][\w]*)\.(write|writeBytes|readBytes|copy|move) as /);
      if (!m) return;
      if (/writer$|stream$/i.test(m[1])) return;               // web/streams writers return promises on purpose
      if (/\bawait\b|\.then\(|\.catch\(|\bvoid\b|\breturn\b/.test(code)) return;
      bad.push(`${path.relative(root, f)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(bad, []);
});

test('the read-aloud, Evidence Locker and export saves use the immediate form', () => {
  const r = p => readFileSync(path.join(root, p), 'utf8');
  assert.equal((r('src/women/evidenceChunkedCrypto.ts').match(/dstHandle\.writeBytesSync\(/g) || []).length, 6);
  assert.match(r('src/women/evidenceStore.ts'), /file\.writeSync\(cipherBytes\)/);
  assert.match(r('app/(tabs)/index.tsx'), /file\.writeSync\(b64, \{ encoding: 'base64' \}\)/);
  assert.match(r('app/my-data.tsx'), /tempFile\.writeSync\(jsonStr\)/);
  assert.match(r('app/settings/data-privacy.tsx'), /tempFile\.writeSync\(jsonStr\)/);
});
