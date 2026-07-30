export function normalizeToMMDDYYYY(input: string, fieldName = "date"): string {
  if (!input || typeof input !== "string") {
    throw new Error(`${fieldName} is missing or invalid`);
  }

  const trimmed = input.trim();

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${month}-${day}-${year}`;
  }

  // Case 2: DD-MM-YYYY or MM-DD-YYYY or with slashes (2 or 4 digit year separated by - or /)
  const partsMatch = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (partsMatch) {
    let [, a, b, year] = partsMatch;
    const aNum = Number(a), bNum = Number(b);

    let month: string, day: string;
    if (aNum > 12 && bNum <= 12) {
      day = a; month = b;
    } else {
      month = a; day = b;
    }
    return `${month.padStart(2, "0")}-${day.padStart(2, "0")}-${year}`;
  }

  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) {
    const month = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    const year = d.getUTCFullYear();
    return `${month}-${day}-${year}`;
  }

  throw new Error(`${fieldName} "${input}" is not a recognizable date format`);
}