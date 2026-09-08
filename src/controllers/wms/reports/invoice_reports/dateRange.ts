function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDDMMYYYY(d: Date): string {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * Given any date (invoice date, job date, txn date — whichever
 * represents "the selected month"), returns the first and last
 * calendar day of that date's month as Date objects.
 *
 * Example: input 6 September 2026 ->
 *   { from: 1 Sept 2026, to: 30 Sept 2026 }
 *
 * Returns null if dateLike is missing or unparsable, so callers can
 * fall back to something else (or an empty string) instead of
 * crashing or printing "Invalid Date".
 */
export function getMonthBounds(
  dateLike: string | Date | null | undefined
): { from: Date; to: Date } | null {
  if (!dateLike) return null;
  const date = typeof dateLike === "string" ? new Date(dateLike) : dateLike;
  if (isNaN(date.getTime())) return null;

  const year = date.getFullYear();
  const month = date.getMonth();

  const from = new Date(year, month, 1);
  const to = new Date(year, month + 1, 0); // day 0 of next month = last day of this month

  return { from, to };
}

/**
 * Returns a "DD/MM/YYYY - DD/MM/YYYY" label spanning the full
 * calendar month that the given date falls in. Returns "" if the
 * date is missing/unparsable.
 *
 * This is what gets used as the invoice's "Invoice Period" whenever
 * an explicit period wasn't passed in directly.
 */
export function getMonthPeriodLabel(dateLike: string | Date | null | undefined): string {
  const bounds = getMonthBounds(dateLike);
  if (!bounds) return "";
  return `${formatDDMMYYYY(bounds.from)} - ${formatDDMMYYYY(bounds.to)}`;
}