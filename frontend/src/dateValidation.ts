/**
 * S1-5: Client-side mirror of the backend's `_date_validation_error`
 * (fir_engine.py). Gives the citizen instant feedback — no round trip —
 * when they type an impossible calendar date (e.g. 31/02/2026) or a date
 * in the future, before the message is even sent.
 *
 * Only flags a structured D/M/Y-style numeric pattern. Free narrative
 * ("last Monday", "Diwali week") has no such pattern and is passed through
 * untouched for the backend's LLM extractor to interpret — the server is
 * still the final authority and re-validates every value independently.
 */
export function dateValidationError(text: string): string | null {
  const match = text.trim().match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/);
  if (!match) return null;

  const d = parseInt(match[1], 10);
  const mo = parseInt(match[2], 10);
  let y = parseInt(match[3], 10);
  if (y < 100) y += 2000;

  const parsed = new Date(y, mo - 1, d);
  const isCalendarValid =
    parsed.getFullYear() === y && parsed.getMonth() === mo - 1 && parsed.getDate() === d;
  if (!isCalendarValid) {
    return 'That date doesn\'t look valid — please check the day and month (e.g. 15/03/2026).';
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  parsed.setHours(0, 0, 0, 0);
  if (parsed.getTime() > today.getTime()) {
    return 'That date is in the future — the incident date can\'t be after today. Please re-check (e.g. 15/03/2026).';
  }

  return null;
}
