/**
 * S1-7: Claims-audit copy helper for citation cards.
 *
 * `verified_at` on a citation is NOT always a date — most of the legal
 * corpus stores a real `YYYY-MM-DD` hand-verification date, but a couple of
 * `chat_router.py` paths inject a text label into the same field
 * ("Judicial Ruling", "Sourced from Government of India"). This helper
 * tells the two apart so the UI never renders a nonsensical string like
 * "Text last checked Judicial Ruling".
 */

const STALE_THRESHOLD_DAYS = 90;

/** True only if the string is a real, parseable YYYY-MM-DD style date. */
export function isVerifiedDate(value: string | null | undefined): boolean {
  if (!value) return false;
  const parsed = new Date(value);
  // Reject non-date labels ("Judicial Ruling", etc.) which `Date` would
  // otherwise silently fail to parse into "Invalid Date".
  return !isNaN(parsed.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(value.trim());
}

/**
 * Copy for the small text shown next to each citation chip.
 * - Real date  → "Text last checked 2026-06-01"
 * - Text label → the label as-is, unprefixed (e.g. "Judicial Ruling")
 */
export function verifiedLabel(value: string | null | undefined): string {
  if (!value) return '';
  return isVerifiedDate(value) ? `Text last checked ${value}` : value;
}

/**
 * True if the citation's verified_at is a real date older than 90 days.
 * Always false for non-date labels (no reliable way to judge staleness).
 */
export function isStale(value: string | null | undefined): boolean {
  if (!isVerifiedDate(value as string)) return false;
  const parsed = new Date(value as string);
  const ageMs = Date.now() - parsed.getTime();
  return ageMs > STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
}

export const STALE_WARNING_TEXT = 'May be outdated — last checked over 90 days ago';
