/**
 * B-100 (14 Nov 2026): a bare `toLocaleDateString()` call (no locale
 * argument) resolves to whatever locale the JS engine *thinks* it is
 * running in -- not necessarily the device's own region setting. On some
 * Hermes builds that falls back to en-US (month-first, e.g. "11/14/2026")
 * regardless of the device's actual locale, so a few screens showed dates
 * month-first while the rest of the app (which always passes an explicit
 * locale/options to toLocaleDateString) correctly shows them day-first.
 *
 * formatDateDMY builds the day-first string directly from the Date
 * object's own fields instead of going through Intl/locale resolution, so
 * it is guaranteed day-first (DD/MM/YYYY, DHARA's house convention)
 * regardless of engine or device locale.
 */
export function formatDateDMY(input: string | number | Date | null | undefined): string {
  if (input == null) return '';
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * B-100 follow-up (24 Nov 2026): day-first date with a 12-hour time, for
 * lists that show when something happened (Chat history). Built from the
 * Date's own fields like formatDateDMY, so it never comes out month-first:
 * "20/11/2026, 3:30 PM".
 */
export function formatDateTimeDMY(input: string | number | Date | null | undefined): string {
  const date = formatDateDMY(input);
  if (!date) return '';
  const d = input instanceof Date ? input : new Date(input as string | number);
  const h24 = d.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${date}, ${h12}:${mins} ${h24 < 12 ? 'AM' : 'PM'}`;
}
