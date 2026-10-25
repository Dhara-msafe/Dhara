/**
 * codePhraseHelpers.ts
 *
 * Pure, platform-independent helpers shared between codePhraseStore.ts and
 * the D1-V tests.  No native imports — safe to run in Node with
 * --experimental-strip-types.
 *
 * PRIVACY CONTRACT: These helpers perform normalization and boolean conflict
 * detection only.  They never receive or store raw phrase text beyond the
 * duration of a single call.
 */

/**
 * Normalise a phrase for comparison.
 * Mirrors the exact transformation used in codePhraseMatcher (trim + lower)
 * so the conflict gate and the live-intercept gate always agree.
 */
export function normalizePhrase(p: string): string {
  return p.trim().toLowerCase();
}

/**
 * Returns true if two non-empty phrases are identical after normalisation.
 * Empty-string (or whitespace-only) inputs never conflict — no phrase !== any phrase.
 */
export function phrasesConflict(a: string, b: string): boolean {
  if (!a.trim() || !b.trim()) return false;
  return normalizePhrase(a) === normalizePhrase(b);
}
