/**
 * codePhraseMatcher.ts — Item C
 *
 * Deterministic, pure utility for comparing user input against the stored
 * code phrase. No side effects, no logging, no network calls.
 *
 * Rules:
 *   - Case-insensitive after trimming both sides.
 *   - Punctuation stripped so typed/spoken variations match cleanly
 *     ("Can you bring the blue umbrella?" matches "Can you bring the blue umbrella").
 *   - A blank phrase NEVER matches anything (empty string ≠ wildcard).
 */

function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // strip punctuation / special chars
    .replace(/\s+/g, ' ');   // collapse runs of whitespace
}

/**
 * Returns true iff the user's typed/spoken input matches the stored phrase
 * after normalisation. Both sides must be non-empty.
 */
export function isCodePhraseMatch(input: string, stored: string): boolean {
  if (!input || !stored) return false;
  return normalize(input) === normalize(stored);
}
