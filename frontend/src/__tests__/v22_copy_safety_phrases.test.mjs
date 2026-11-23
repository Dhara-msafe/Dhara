/**
 * v2.2 copy correction — Safety phrases (screen-manifest id 35, "Copy corrected").
 * change_class: "Copy correction" only — NOT a visual reskin; the dark
 * "Shield mode" mockup (SafetyPhrases.dc.html) is out of scope for this batch,
 * same as Silent alert and Guardian share (manifest overrides the mockup).
 *
 * COPY_AND_CAPABILITY_AUDIT.csv flags blanket "end-to-end encrypted" /
 * "everything stays on your device" claims: they must be removed unless they
 * match the approved privacy policy, because the live notice elsewhere
 * describes cloud storage. This screen had exactly that unqualified claim
 * ("Stored only on this phone, encrypted.") sitting next to the already-
 * correct, qualified wording used elsewhere in the same file. Fixed to match.
 *
 * Run with: node --experimental-strip-types --test src/__tests__/v22_copy_safety_phrases.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const screen = readFileSync(join(root, 'app', 'women', 'code-phrase.tsx'), 'utf8');

test('no blanket "encrypted" claim remains', () => {
  assert.doesNotMatch(screen, /encrypt/i);
});

test('SOS phrase note uses the qualified, accurate storage wording', () => {
  assert.match(screen, /Stored in OS-protected device storage \(authenticated users\) or device memory only \(guest\)\./);
});

test('the matching qualified wording already used for the Privacy phrase note is untouched', () => {
  assert.match(screen, /Stored in OS-protected device storage \(authenticated users\) or device memory only \(guest\)\.\s*\n\s*Phrase matching happens entirely on this phone/);
});
