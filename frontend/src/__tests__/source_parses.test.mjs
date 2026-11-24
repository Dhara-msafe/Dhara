/**
 * Every app and src file must actually parse.
 *
 * Why this exists: on 23 Nov a JSX comment was placed as the first thing
 * inside a parenthesised `&&` expression —
 *
 *   {onAttach && (
 *     {/* ... *\/}
 *     <Pressable ... />
 *   )}
 *
 * — which is an object literal, not a comment, so app/fir-draft/index.tsx
 * stopped compiling. It reached the branch tip and sat there, because every
 * other test in this folder reads source as TEXT. A file that cannot be
 * parsed still satisfies a string match, so 693 tests passed over a screen
 * that could not be built.
 *
 * This test closes that hole: it hands every tracked .ts/.tsx file to the
 * TypeScript parser and fails on any syntax error. It does not type-check —
 * `tsc --noEmit` does that — it only answers "is this still a valid file".
 *
 * Run with: node --test src/__tests__/source_parses.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const frontend = join(here, '..', '..');
const ts = createRequire(import.meta.url)('typescript');

/** Tracked source files, so generated and ignored output never reaches this. */
function trackedSources() {
  const out = execFileSync(
    'git',
    ['ls-files', 'app', 'src'],
    { cwd: frontend, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l === '' ? false : ['.ts', '.tsx'].includes(extname(l)))
    .filter((l) => !l.endsWith('.d.ts'));
}

/** Syntax diagnostics only — no type checking, no module resolution. */
function syntaxErrors(relPath) {
  const source = readFileSync(join(frontend, relPath), 'utf8');
  const { diagnostics } = ts.transpileModule(source, {
    fileName: relPath,
    reportDiagnostics: true,
    compilerOptions: {
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      isolatedModules: true,
    },
  });
  return (diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
}

const FILES = trackedSources();

test('there are source files to check', () => {
  assert.ok(FILES.length > 100, `expected the app to have many source files, found ${FILES.length}`);
});

test('every tracked app and src file parses', () => {
  const broken = [];
  for (const rel of FILES) {
    for (const d of syntaxErrors(rel)) {
      const where = d.file && typeof d.start === 'number'
        ? (() => {
            const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
            return `${rel}:${line + 1}:${character + 1}`;
          })()
        : rel;
      broken.push(`${where} — ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
    }
  }
  assert.deepEqual(
    broken,
    [],
    `These files do not parse, so they cannot be built:\n  ${broken.join('\n  ')}`,
  );
});

test('the screen that caused this test still parses', () => {
  // Named on purpose: it is the client-facing FIR draft screen, and the one
  // the 23 Nov break landed in.
  assert.deepEqual(syntaxErrors('app/fir-draft/index.tsx').length, 0);
});
