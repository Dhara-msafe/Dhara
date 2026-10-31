/**
 * codePhraseHelpers.ts
 *
 * Pure, platform-independent helpers shared between codePhraseStore.ts,
 * codePhraseMatcher.ts, and tests.  No native imports — safe to run in
 * Node with --experimental-strip-types.
 *
 * PRIVACY CONTRACT: These helpers perform normalization and boolean conflict
 * detection only.  They never receive or store raw phrase text beyond the
 * duration of a single call.
 *
 * NORMALIZATION CONTRACT (shared with codePhraseMatcher):
 *   1. Unicode NFC normalization (canonicalises composed/decomposed forms,
 *      maps Unicode apostrophe variants such as U+2019 → composed form).
 *   2. Trim leading/trailing whitespace.
 *   3. Lowercase.
 *   4. Strip non-letter / non-number / non-mark / non-whitespace characters
 *      using Unicode-aware regex (\p{L}\p{N}\p{M} with u flag) — preserves
 *      Devanagari, Arabic, CJK etc. while removing punctuation (including
 *      question marks, apostrophes, hyphens, commas, em-dashes).
 *   5. Collapse runs of whitespace to a single space.
 *
 * Examples:
 *   "Did you feed the cat today?"  → "did you feed the cat today"
 *   "  Blue Umbrella  "            → "blue umbrella"
 *   "Can\u2019t you see?"          → "cant you see"   (smart apostrophe gone)
 *   "blue-moon"                    → "bluemoon"       (hyphen removed, no space)
 */

/**
 * Normalise a phrase for comparison or conflict detection.
 * Identical algorithm used in codePhraseMatcher — both sides MUST stay in sync.
 */
export function normalizePhrase(p: string): string {
  return p
    .normalize('NFC')
    .trim()
    .toLowerCase()
    // Unicode-aware: keep letters (all scripts), numbers, combining marks, spaces.
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, '')
    .replace(/\s+/g, ' ');
}

/**
 * Returns true if two non-empty phrases are identical after normalisation.
 * Empty-string (or whitespace-only) inputs never conflict — no phrase !== any phrase.
 */
export function phrasesConflict(a: string, b: string): boolean {
  if (!a.trim() || !b.trim()) return false;
  return normalizePhrase(a) === normalizePhrase(b);
}

