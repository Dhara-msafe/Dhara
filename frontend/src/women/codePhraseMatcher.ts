/**
 * codePhraseMatcher.ts — Item C
 *
 * Deterministic, pure utility. No side effects, no logging, no network calls.
 *
 * Canonicalization rules (MUST REMAIN IDENTICAL TO codePhraseHelpers.normalizePhrase,
 * exact, in order):
 *   1. Unicode NFC normalization.
 *   2. Trim leading/trailing whitespace.
 *   3. Lowercase.
 *   4. Strip non-letter / non-number / non-mark / non-whitespace characters
 *      using Unicode-aware regex (\p{L}\p{N}\p{M} with u flag) so non-ASCII
 *      scripts (Hindi, Arabic, etc.) are preserved correctly.
 *   5. Collapse runs of whitespace to a single space.
 *
 * SYNC NOTE: This private `normalize` function is intentionally a copy of
 * codePhraseHelpers.normalizePhrase.  They MUST produce identical output for
 * all inputs (enforced by test CP-39 in codePhraseGate.test.mjs).  The
 * duplication avoids a runtime import chain that breaks Node's ESM resolver in
 * test and linting environments while the production Metro/Babel bundler handles
 * it transparently.
 *
 * Documented test cases for "blue moon":
 *   "blue moon"           → "blue moon"  MATCH
 *   "Blue Moon"           → "blue moon"  MATCH
 *   "blue moon!"          → "blue moon"  MATCH  (trailing ! stripped)
 *   "blue moon?"          → "blue moon"  MATCH  (trailing ? stripped)
 *   "blue-moon"           → "bluemoon"   NO MATCH (hyphen removed, no space added)
 *   "the blue moon"       → "the blue moon"  NO MATCH (extra word)
 *   "blue moons"          → "blue moons"  NO MATCH (plural)
 *   "blue"                → "blue"  NO MATCH (substring)
 *   ""                    → early-return false  NO MATCH
 *
 * NO fuzzy, semantic, substring, embedding or LLM matching is used.
 */

function normalize(s: string): string {
  return s
    .normalize('NFC')
    .trim()
    .toLowerCase()
    // Unicode-aware: keep letters (all scripts), numbers, combining marks, spaces.
    // This preserves Devanagari, Arabic, CJK, etc. while stripping punctuation.
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, '')
    .replace(/\s+/g, ' ');
}

export function isCodePhraseMatch(input: string, stored: string): boolean {
  if (!input || !stored) return false;
  return normalize(input) === normalize(stored);
}
